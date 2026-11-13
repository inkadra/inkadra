import {
  DEFAULT_VIDEO_SETTINGS,
  type UpdateVideoSettings,
  VIDEO_RUNGS,
  type VideoQuality,
  VideoRung,
  VideoRungMode,
  VideoSettings,
  type VideoLiveStatus,
  type VideoSettingsView,
  z,
} from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import { instanceSetting } from './db/schema.ts';
import { HttpError } from './http/errors.ts';
import type { Jobs } from './jobs.ts';
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
): Promise<VideoLiveStatus> {
  const saved = await readVideoEncoder(db);
  const locked = env.VIDEO_LIVE_MAX_SESSIONS !== undefined;
  const hardware = saved !== null && saved.backend !== 'software';
  const measured = hardware ? (saved.liveSessions ?? 0) : 0;
  const sessions = hardware ? (locked ? (env.VIDEO_LIVE_MAX_SESSIONS as number) : measured) : 0;
  const reason: VideoLiveStatus['reason'] = !hardware
    ? 'no-gpu'
    : locked && sessions === 0
      ? 'set-off'
      : sessions > 0
        ? null
        : saved.liveSpeed
          ? 'too-slow'
          : 'failed';
  return {
    available: sessions > 0,
    reason,
    sessions,
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
  const live = await liveStatus(db, env);
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
  // The admin can only lower what was measured; no GPU (or too slow) means no live playback.
  settings.live.maxSessions = Math.max(1, Math.min(value.live?.maxSessions ?? live.sessions, live.sessions));
  settings.live.perViewer = Math.min(settings.live.perViewer, settings.live.maxSessions);
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
  if (next.live.perViewer > next.live.maxSessions)
    return 'One viewer cannot have more sessions than the whole instance.';
  return null;
}

export async function saveVideoSettings(
  db: Database | Tx,
  env: VideoEnv,
  patch: UpdateVideoSettings,
): Promise<VideoSettings> {
  const { settings: current, locked, live } = await readVideoSettings(db, env);
  if (patch.live?.enabled && !live.available)
    throw new HttpError('conflict', 'Live playback needs GPU hardware encoding fast enough for it.');
  if (patch.live?.maxSessions !== undefined && patch.live.maxSessions > live.sessions)
    throw new HttpError(
      'bad_request',
      `At most ${live.sessions} live sessions at once: what this server measured at start.`,
    );
  if (
    (patch.quality !== undefined && locked.quality) ||
    (patch.rungs !== undefined && locked.rungs) ||
    (patch.live?.enabled !== undefined && locked.live)
  )
    throw new HttpError('forbidden', 'This setting is fixed by the server environment.');
  const next: VideoSettings = {
    ...current,
    ...(patch.quality ? { quality: patch.quality } : {}),
    ...(patch.playable ? { playable: patch.playable } : {}),
    rungs: { ...current.rungs, ...patch.rungs },
    live: { ...current.live, ...patch.live },
  };
  const why = invalidVideoSettings(next);
  if (why) throw new HttpError('bad_request', why);
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY));
  const value = {
    ...((row?.value ?? {}) as object),
    ...patch,
    ...(patch.rungs ? { rungs: next.rungs } : {}),
    ...(patch.live ? { live: next.live } : {}),
  };
  await db
    .insert(instanceSetting)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
  return (await readVideoSettings(db, env)).settings;
}

/** The copies settings of the worker, with the choices of the Video page applied. */
export function applyVideoSettings(base: ProxySettings, settings: VideoSettings): ProxySettings {
  return {
    ...base,
    quality: settings.quality as VideoQuality,
    rungs: VIDEO_RUNGS.filter((r) => settings.rungs[r] === 'stored'),
    playable: settings.playable,
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
  extra: { freeBytes: number | null; recipe: (quality: VideoQuality) => string; jobs?: Jobs },
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
  const recipe = extra.recipe(settings.quality);

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
  };
}
