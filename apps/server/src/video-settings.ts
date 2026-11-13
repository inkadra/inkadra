import {
  DEFAULT_VIDEO_SETTINGS,
  type UpdateVideoSettings,
  VIDEO_RUNGS,
  type VideoLiveStatus,
  type VideoQuality,
  VideoRung,
  VideoRungCustom,
  VideoRungMode,
  VideoSettings,
  type VideoSettingsView,
  z,
} from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import { instanceSetting } from './db/schema.ts';
import { HttpError } from './http/errors.ts';
import type { Jobs } from './jobs.ts';
import type { VideoEncoder } from './media/hwaccel.ts';
import { QUALITY_VALUES, rungRate, VIDEO_QUALITIES } from './media/quality.ts';
import type { Recipes } from './media/ladder.ts';
import { readVideoEncoder } from './media/encoder-setting.ts';
import type { ProxySettings } from './media/video.ts';
import { countNeeding, readBackfill } from './video-backfill.ts';

type Reader = Pick<Database, 'select' | 'execute'>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** What may be stored: any part of the settings, each part checked. */
const Stored = z.object({
  quality: VideoSettings.shape.quality.optional().catch(undefined),
  rungs: z.partialRecord(VideoRung, VideoRungMode).optional().catch(undefined),
  playable: VideoSettings.shape.playable.optional().catch(undefined),
  live: VideoSettings.shape.live.partial().optional().catch(undefined),
  custom: z.partialRecord(VideoRung, VideoRungCustom).optional().catch(undefined),
});

/** Key of the video settings in `instance_setting` (decision 0128). */
const KEY = 'video';

export type VideoEnv = Pick<
  Config,
  'VIDEO_QUALITY' | 'VIDEO_RENDITIONS' | 'VIDEO_LIVE' | 'VIDEO_LIVE_MAX_SESSIONS' | 'VIDEO_PROXIES'
>;

/** The rungs VIDEO_RENDITIONS names as stored, every other off. */
export function envRungs(list: VideoRung[]): Record<VideoRung, VideoRungMode> {
  return Object.fromEntries(
    VIDEO_RUNGS.map((r) => [r, list.includes(r) ? 'stored' : 'off']),
  ) as Record<VideoRung, VideoRungMode>;
}

/** The stored choices over the defaults, with the server environment winning where it is set. */
/**
 * Whether live playback can run here (decision 0128): only on the GPU the worker found, with
 * the sessions it measured at start (or VIDEO_LIVE_MAX_SESSIONS) as the most there can be.
 */
export async function liveStatus(
  db: Pick<Database, 'select'>,
  env: Pick<VideoEnv, 'VIDEO_LIVE_MAX_SESSIONS'>,
  /** What the admin set in Advanced, over the measurement; undefined: the measurement. */
  chosen?: number,
): Promise<VideoLiveStatus> {
  const saved = await readVideoEncoder(db);
  const locked = env.VIDEO_LIVE_MAX_SESSIONS !== undefined;
  const hardware = saved !== null && saved.backend !== 'software';
  const measured = hardware ? (saved.liveSessions ?? 0) : null;
  const sessions = hardware ? (env.VIDEO_LIVE_MAX_SESSIONS ?? chosen ?? measured ?? 0) : 0;
  const reason: VideoLiveStatus['reason'] = !hardware
    ? 'no-gpu'
    : sessions > 0
      ? null
      : locked || chosen === 0
        ? 'set-off'
        : saved.liveSpeed
          ? 'too-slow'
          : 'failed';
  return {
    available: sessions > 0,
    reason,
    sessions,
    measured,
    speed: hardware ? (saved.liveSpeed ?? null) : null,
    measuredAt: hardware && saved.measuredAt ? saved.measuredAt : null,
    locked,
  };
}

/** The stored choices over the defaults, with the server environment winning where it is set. */
export async function readVideoSettings(
  db: Pick<Database, 'select'>,
  env: VideoEnv,
): Promise<{
  settings: VideoSettings;
  locked: VideoSettingsView['locked'];
  live: VideoLiveStatus;
}> {
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY));
  const stored = Stored.safeParse(row?.value ?? {});
  const value = stored.success ? stored.data : {};
  const live = await liveStatus(db, env, value.live?.maxSessions);
  const settings: VideoSettings = {
    ...DEFAULT_VIDEO_SETTINGS,
    ...(value.quality ? { quality: value.quality } : {}),
    ...(value.playable ? { playable: value.playable } : {}),
    rungs: { ...DEFAULT_VIDEO_SETTINGS.rungs, ...value.rungs },
    live: { ...DEFAULT_VIDEO_SETTINGS.live, ...value.live },
  };
  if (env.VIDEO_QUALITY) settings.quality = env.VIDEO_QUALITY;
  if (env.VIDEO_RENDITIONS) settings.rungs = envRungs(env.VIDEO_RENDITIONS);
  if (env.VIDEO_LIVE !== undefined) settings.live = { ...settings.live, enabled: env.VIDEO_LIVE };
  // The measurement, or what the admin set in Advanced (more is allowed, with a warning), or
  // VIDEO_LIVE_MAX_SESSIONS; no GPU means no live playback at all.
  settings.live.maxSessions = live.sessions;
  settings.live.perViewer = Math.min(settings.live.perViewer, Math.max(1, live.sessions));
  if (value.custom && Object.keys(value.custom).length > 0) settings.custom = value.custom;
  if (!live.available) settings.live.enabled = false;
  // A rung set to live only, with live playback off, is kept on disk: it plays all the same.
  if (!settings.live.enabled)
    for (const r of VIDEO_RUNGS) if (settings.rungs[r] === 'live') settings.rungs[r] = 'stored';
  return {
    settings,
    locked: {
      quality: env.VIDEO_QUALITY !== undefined,
      rungs: env.VIDEO_RENDITIONS !== undefined,
      live: env.VIDEO_LIVE !== undefined,
    },
    live,
  };
}

/** The settings of the Video page through a ten-second cache: every playlist reads them. */
export function cachedVideoSettings(db: Pick<Database, 'select'>, env: VideoEnv) {
  let kept: { at: number; value: Promise<VideoSettings> } | null = null;
  return () => {
    if (!kept || Date.now() - kept.at > 10_000) {
      const value = readVideoSettings(db, env).then((r) => r.settings);
      kept = { at: Date.now(), value };
      value.catch(() => {
        kept = null;
      });
    }
    return kept.value;
  };
}

/** Why `next` cannot be saved, or null. */
export function invalidVideoSettings(next: VideoSettings): string | null {
  const on = VIDEO_RUNGS.filter((r) => next.rungs[r] !== 'off');
  if (on.length === 0) return 'Keep at least one resolution.';
  if (!next.live.enabled && on.some((r) => next.rungs[r] === 'live'))
    return 'A resolution only encoded while watched needs live playback on.';
  if (next.live.maxSessions > 0 && next.live.perViewer > next.live.maxSessions)
    return 'One viewer cannot have more sessions than the whole instance.';
  return null;
}

export async function saveVideoSettings(
  db: Database | Tx,
  env: VideoEnv,
  patch: UpdateVideoSettings,
): Promise<VideoSettings> {
  const { settings: current, locked, live } = await readVideoSettings(db, env);
  if (patch.live?.enabled && !live.available && live.reason === 'no-gpu')
    throw new HttpError('conflict', 'Live playback needs GPU hardware encoding.');
  if (
    (patch.quality !== undefined && locked.quality) ||
    (patch.rungs !== undefined && locked.rungs) ||
    (patch.live?.enabled !== undefined && locked.live) ||
    (patch.live?.maxSessions !== undefined && live.locked)
  )
    throw new HttpError('forbidden', 'This setting is fixed by the server environment.');
  const quality = patch.quality ?? current.quality;
  const custom = { ...current.custom };
  for (const rung of VIDEO_RUNGS) {
    if (!patch.custom || !(rung in patch.custom)) continue;
    const given = patch.custom[rung];
    if (!given || Object.keys(given).length === 0) delete custom[rung];
    else custom[rung] = given;
  }
  const why = invalidCustom(quality, custom);
  if (why) throw new HttpError('bad_request', why);
  const { maxSessions, ...liveRest } = patch.live ?? {};
  const next: VideoSettings = {
    ...current,
    quality,
    ...(patch.playable ? { playable: patch.playable } : {}),
    rungs: { ...current.rungs, ...patch.rungs },
    live: {
      ...current.live,
      ...liveRest,
      maxSessions:
        maxSessions === null ? (live.measured ?? 0) : (maxSessions ?? current.live.maxSessions),
    },
  };
  const reason = invalidVideoSettings(next);
  if (reason) throw new HttpError('bad_request', reason);
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY));
  const before = (row?.value ?? {}) as Record<string, unknown>;
  const storedLive = { ...((before.live as Record<string, unknown>) ?? {}), ...liveRest };
  // Ripristina: back to the measurement, which a new test may change.
  if (maxSessions === null) delete storedLive.maxSessions;
  else if (maxSessions !== undefined) storedLive.maxSessions = maxSessions;
  const value = {
    ...before,
    ...(patch.quality ? { quality: patch.quality } : {}),
    ...(patch.playable ? { playable: patch.playable } : {}),
    ...(patch.rungs ? { rungs: next.rungs } : {}),
    live: storedLive,
    custom,
  };
  await db
    .insert(instanceSetting)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
  return (await readVideoSettings(db, env)).settings;
}

/**
 * Why the custom values of the rungs cannot be saved, or null: the peak at least the target,
 * either given or the preset's (the bounds themselves are checked by the schema).
 */
export function invalidCustom(
  quality: VideoQuality,
  custom: Partial<Record<VideoRung, VideoRungCustom>>,
) {
  for (const rung of VIDEO_RUNGS) {
    const c = custom[rung];
    if (!c) continue;
    const preset = rungRate(quality, Number(rung), 25);
    const target = c.target ?? preset.target;
    const peak = c.peak ?? preset.peak;
    if (peak < target)
      return `The peak bitrate of ${rung}p (${peak}) must be at least its target (${target}).`;
  }
  return null;
}

/** The values of each preset for each rung on `backend`, as the Advanced fields start from. */
export function presetValues(backend: VideoEncoder['backend'] | undefined) {
  const param =
    backend === 'nvenc'
      ? 'cq'
      : backend === 'qsv' || backend === 'vaapi'
        ? 'globalQuality'
        : 'crf';
  const values = Object.fromEntries(
    VIDEO_QUALITIES.map((q) => [
      q,
      Object.fromEntries(
        VIDEO_RUNGS.map((r) => {
          const rate = rungRate(q, Number(r), 25);
          return [r, { target: rate.target, peak: rate.peak, quality: QUALITY_VALUES[q][param] }];
        }),
      ),
    ]),
  ) as Record<VideoQuality, Record<VideoRung, { target: number; peak: number; quality: number }>>;
  const qualityParam: 'crf' | 'cq' | 'global_quality' =
    param === 'globalQuality' ? 'global_quality' : param;
  return { qualityParam, values };
}

/** The copies settings of the worker, with the choices of the Video page applied. */
export function applyVideoSettings(base: ProxySettings, settings: VideoSettings): ProxySettings {
  return {
    ...base,
    quality: settings.quality as VideoQuality,
    rungs: VIDEO_RUNGS.filter((r) => settings.rungs[r] === 'stored'),
    playable: settings.playable,
    ...(settings.custom ? { custom: settings.custom } : {}),
  };
}

/** Minutes of video by the rung of their shorter side, for the estimates of the Video page. */
export async function videoLibrary(db: Reader): Promise<VideoSettingsView['library']> {
  const rows = await db.execute<{ side: string; minutes: string; fast: string; videos: string }>(
    sql`select case
          when least(width, height) > 1080 then '2160'
          when least(width, height) > 720 then '1080'
          when least(width, height) > 480 then '720'
          else '480' end as side,
        (sum(duration_ms) / 60000.0)::text as minutes,
        (sum(case when frame_rate > 30.5 then duration_ms else 0 end) / 60000.0)::text as fast,
        count(*)::text as videos
      from asset
      where kind = 'video' and status = 'ready' and duration_ms is not null
        and width is not null and height is not null
      group by 1`,
  );
  return VIDEO_RUNGS.map((side) => {
    const r = rows.find((x) => x.side === side);
    return {
      side,
      minutes: Number(r?.minutes ?? 0),
      fastMinutes: Number(r?.fast ?? 0),
      videos: Number(r?.videos ?? 0),
    };
  });
}

/**
 * The Video page (decision 0128): the settings, what the environment fixes, the encoder the
 * worker found, the queue, the library and the space the copies take.
 */
export async function videoSettingsView(
  db: Reader,
  config: VideoEnv & Pick<Config, 'VIDEO_PROXY_CONCURRENCY'>,
  extra: {
    freeBytes: number | null;
    recipe: (settings: VideoSettings) => Recipes;
    jobs?: Jobs;
  },
): Promise<VideoSettingsView> {
  const { settings, locked, live } = await readVideoSettings(db, config);
  const saved = await readVideoEncoder(db);
  const [counts] = await db.execute<{
    queued: string;
    processing: string;
    copies: string;
    speed: string | null;
  }>(sql`select
      (select count(*) from asset where proxy_status = 'queued')::text as queued,
      (select count(*) from asset where proxy_status = 'processing')::text as processing,
      ((select coalesce(sum(bytes), 0) from asset_variant where size = 'proxy')
        + (select coalesce(sum(bytes), 0) from asset_rendition))::text as copies,
      (select (sum(a.duration_ms)::float / nullif(sum(r.encode_ms), 0))::text
        from asset_rendition r join asset a on a.id = r.asset_id
        where r.status = 'ready' and r.encode_ms > 0 and a.duration_ms > 0
          and r.created_at > now() - interval '30 days') as speed`);
  const recipe = extra.recipe(settings);

  const hardware = saved && saved.backend !== 'software';
  return {
    settings,
    locked,
    enabled: config.VIDEO_PROXIES && saved !== null,
    encoder: saved && {
      label: saved.label,
      backend: saved.backend,
      tuning: saved.tuning ?? null,
      av1: saved.codecs?.includes('av1') ?? false,
      requested: saved.requested,
      concurrency: config.VIDEO_PROXY_CONCURRENCY ?? (hardware ? 2 : 1),
    },
    queue: { queued: Number(counts?.queued ?? 0), processing: Number(counts?.processing ?? 0) },
    library: await videoLibrary(db),
    copiesBytes: Number(counts?.copies ?? 0),
    freeBytes: extra.freeBytes,
    outdated: await countNeeding(db, 'outdated', recipe),
    speed: counts?.speed ? Number(counts.speed) : null,
    backfill: await readBackfill(db, extra.jobs),
    liveStatus: live,
    benchmark: await readBenchmark(db),
    ...(() => {
      const preset = presetValues(saved?.backend);
      return { presetValues: preset.values, qualityParam: preset.qualityParam };
    })(),
  };
}

// A new measurement asked from the page (Advanced, decision 0128) ---------------------------

const BENCH_KEY = 'video-benchmark';
/** A measurement still "running" after this long died with its worker: another may start. */
export const BENCH_STALE_MS = 10 * 60_000;

export async function readBenchmark(db: Pick<Database, 'select'>, now = Date.now()) {
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, BENCH_KEY));
  const value = (row?.value ?? {}) as { running?: boolean; startedAt?: string };
  const startedAt = typeof value.startedAt === 'string' ? value.startedAt : null;
  const running =
    value.running === true && startedAt !== null && now - Date.parse(startedAt) < BENCH_STALE_MS;
  return { running, startedAt };
}

async function writeBenchmark(db: Pick<Database, 'insert'>, running: boolean, startedAt: string) {
  const value = { running, startedAt };
  await db
    .insert(instanceSetting)
    .values({ key: BENCH_KEY, value })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
}

/**
 * Queues the detection of the encoder and the live benchmark on the worker, as at its start.
 * One at a time: 409 while one runs.
 */
export async function startBenchmark(db: Database | Tx, jobs: Jobs) {
  if (!jobs.runVideoBenchmark) throw new HttpError('conflict', 'This server makes no video copies.');
  if ((await readBenchmark(db)).running)
    throw new HttpError('conflict', 'A performance test is already running.');
  await writeBenchmark(db, true, new Date().toISOString());
  await jobs.runVideoBenchmark();
}

/** Runs the measurement (on the worker) and marks it done, whatever happens. */
export async function runBenchmark(db: Database, measure: () => Promise<unknown>) {
  const { startedAt } = await readBenchmark(db);
  try {
    await measure();
  } finally {
    await writeBenchmark(db, false, startedAt ?? new Date().toISOString());
  }
}
