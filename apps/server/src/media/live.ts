import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { ladderFor, VIDEO_RUNGS, type VideoRung, type VideoSettings } from '@inkadra/shared';
import type { asset } from '../db/schema.ts';
import { readAll, type Storage } from '../storage.ts';
import { encoderMemory, gpuDecodes, SOFTWARE_ENCODER, type VideoEncoder } from './hwaccel.ts';
import { ladderArgs, renditionCodecs, rungSide, shortSide } from './ladder.ts';
import { rungRate } from './quality.ts';
import { privateInput } from './scratch.ts';
import { limitedCommand, toolEnv } from './tools.ts';
import {
  DEFAULT_PROXY_SETTINGS,
  decodesOnGpu,
  mediaTools,
  type ProxySettings,
  sniffVideo,
  type VideoInfo,
} from './video.ts';

/**
 * Live playback (decision 0128): a rung that is not stored (yet) is encoded while someone
 * watches, two-second HLS segments of fragmented MP4 written by ffmpeg into a folder of the
 * session, in the process that answers the requests (the web role, or `all`). Adapted from
 * Immich's on-the-fly HLS: a session per viewer and video, a 30-minute lease renewed by every
 * request, ffmpeg started at the segment asked and started again on a seek out of its window or
 * a change of rung, paused when it runs 30 segments ahead and resumed under 15, folders removed
 * after 5 minutes of silence.
 */

/** Seconds of one segment: the keyframe interval of every copy, so live and stored rungs align. */
export const SEGMENT_S = 2;
const LEASE_MS = 30 * 60_000;
const IDLE_MS = 5 * 60_000;
const AHEAD_PAUSE = 30;
const AHEAD_RESUME = 15;
/** A segment asked this far past what ffmpeg wrote starts it again there (a seek). */
const WINDOW = 3;
/** How long a request waits for its segment. */
const SEGMENT_WAIT_MS = 30_000;
/** Source copies kept for live playback from a bucket: they are not downloaded per session. */
export const SOURCE_CACHE_BYTES = 20 * 1024 ** 3;

type AssetRow = typeof asset.$inferSelect;

/** The HLS media playlist of a live rung: every segment known from the duration alone. */
export function livePlaylist(durationMs: number, rung: VideoRung) {
  const seconds = durationMs / 1000;
  const count = Math.max(1, Math.ceil(seconds / SEGMENT_S - 1e-6));
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${SEGMENT_S}`,
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MAP:URI="${rung}/init.mp4"`,
  ];
  for (let n = 0; n < count; n++) {
    const length = n < count - 1 ? SEGMENT_S : seconds - SEGMENT_S * (count - 1);
    lines.push(`#EXTINF:${Math.max(0.001, length).toFixed(3)},`, `${rung}/seg-${n}.m4s`);
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

/** What a video row tells about its source, as the planners read it. */
export function rowInfo(row: AssetRow): VideoInfo {
  const media = row.mediaInfo;
  return {
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    videoCodec: row.videoCodec,
    audioCodec: row.audioCodec,
    frameRate: row.frameRate,
    pixelFormat: media?.pixelFormat ?? null,
    hdr: media?.hdr ?? null,
    bits: media?.bits ?? 8,
    interlaced: media?.interlaced ?? false,
    rotated: media?.rotated ?? false,
  };
}

/**
 * Whether this server can encode `row` in real time (decision 0128, measured on an Intel N100):
 * not a 4K source the CPU decodes (ProRes, DNx, 4:2:2: 0.97× with four threads), not a 4K HDR
 * source (tone mapping on the CPU: 0.59×), and without a GPU nothing past 1080.
 */
export function liveEligible(row: AssetRow, encoder: VideoEncoder | undefined) {
  if (row.kind !== 'video' || row.status !== 'ready' || !row.durationMs) return false;
  const info = rowInfo(row);
  const side = shortSide(info) ?? 0;
  if (!side) return false;
  if (side <= 1080) return true;
  if (!encoder || encoder.backend === 'software') return false;
  if (info.hdr) return false;
  return gpuDecodes(info.videoCodec, info.pixelFormat ?? 'yuv420p');
}

/**
 * The rungs of a video offered live: those not ready (made later, or never stored) among the
 * rungs the settings offer for its size; none when live playback is off or the source cannot
 * be encoded in real time here.
 */
export function liveRungs(
  row: AssetRow,
  ready: VideoRung[],
  settings: VideoSettings,
  encoder: VideoEncoder | undefined,
): VideoRung[] {
  if (!settings.live.enabled || !liveEligible(row, encoder)) return [];
  const offered = VIDEO_RUNGS.filter((r) => settings.rungs[r] !== 'off');
  const side = shortSide(rowInfo(row)) ?? 0;
  return ladderFor(offered, side).filter((r) => !ready.includes(r));
}

/** The master playlist entry of a live rung. */
export function liveVariant(row: AssetRow, rung: VideoRung, settings: ProxySettings) {
  const info = rowInfo(row);
  const side = rungSide(info, settings, rung);
  const ratio = (info.width ?? 16) / (info.height ?? 9);
  const width = ratio >= 1 ? Math.round((side * ratio) / 2) * 2 : side;
  const height = ratio >= 1 ? side : Math.round(side / ratio / 2) * 2;
  const rate = rungRate(settings.quality, side, info.frameRate);
  return {
    name: rung,
    width,
    height,
    bandwidth: rate.peak + 128_000,
    average: rate.target + 128_000,
    frameRate: info.frameRate,
    codecs: renditionCodecs(width, height, info.frameRate),
  };
}

interface Session {
  key: string;
  /** Who counts against the per-viewer limit: a person, or a share link with all its guests. */
  viewer: string;
  assetId: string;
  dir: string;
  lease: number;
  last: number;
  rung: VideoRung | null;
  /** First segment of the running ffmpeg, and the highest asked. */
  start: number;
  asked: number;
  child: ChildProcess | null;
  paused: boolean;
  release: (() => Promise<void>) | null;
  /** The local source and its sniffed container, once acquired. */
  source: string | null;
  container: string | null;
  /** Encoders tried for the running rung: GPU, GPU with CPU decoding, libx264. */
  attempt: number;
}

/** Who watches: one session per `id` and video; `group` shares the per-viewer limit. */
export interface LiveViewer {
  id: string;
  group: string;
}

export interface LiveLimits {
  maxSessions: number;
  perViewer: number;
}

export interface LiveDeps {
  storage: Storage;
  /** `DATA_DIR/tmp`: sessions under `live/`, bucket sources under `live-src/`. */
  tmpDir: string;
  encoder?: VideoEncoder;
  proxies?: ProxySettings;
  log?: { warn: (fields: Record<string, unknown>, message: string) => void };
}

/** Local copies of bucket sources, shared by sessions, least recently used first out. */
class SourceCache {
  private readonly entries = new Map<
    string,
    { path: string; bytes: number; used: number; users: number; ready: Promise<string> }
  >();
  constructor(
    private readonly deps: LiveDeps,
    private readonly limit = SOURCE_CACHE_BYTES,
  ) {}

  async acquire(row: AssetRow): Promise<{ path: string; release: () => Promise<void> }> {
    const { storage } = this.deps;
    if (!storage.copiesToLocal) {
      const copy = await storage.localCopy(row.storageKey, this.deps.tmpDir);
      return { path: copy.path, release: copy.done };
    }
    let entry = this.entries.get(row.id);
    if (!entry) {
      const dir = join(this.deps.tmpDir, 'live-src', row.id);
      const ready = mkdir(dir, { recursive: true })
        .then(() => storage.localCopy(row.storageKey, dir))
        .then((copy) => copy.path);
      entry = { path: '', bytes: row.size, used: Date.now(), users: 0, ready };
      this.entries.set(row.id, entry);
      ready.catch(() => this.entries.delete(row.id));
    }
    entry.users += 1;
    entry.used = Date.now();
    const current = entry;
    try {
      current.path = await current.ready;
    } catch (err) {
      current.users -= 1;
      throw err;
    }
    await this.evict();
    return {
      path: current.path,
      release: async () => {
        current.users = Math.max(0, current.users - 1);
        current.used = Date.now();
      },
    };
  }

  private async evict() {
    let total = [...this.entries.values()].reduce((sum, e) => sum + e.bytes, 0);
    const idle = [...this.entries.entries()]
      .filter(([, e]) => e.users === 0)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [id] of idle) {
      if (total <= this.limit) break;
      const entry = this.entries.get(id);
      this.entries.delete(id);
      total -= entry?.bytes ?? 0;
      await rm(join(this.deps.tmpDir, 'live-src', id), { recursive: true, force: true });
    }
  }
}

/** Sessions of live playback of this process. */
export class LiveSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly sources: SourceCache;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: LiveDeps,
    private readonly now = Date.now,
  ) {
    this.sources = new SourceCache(deps);
  }

  /** Starts the sweep and the back-pressure of running encodes (every two seconds). */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 2000);
    this.timer.unref?.();
    // Folders of a previous run of the process: nothing plays from them any more.
    void rm(join(this.deps.tmpDir, 'live'), { recursive: true, force: true });
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const s of [...this.sessions.values()]) await this.end(s);
  }

  /** Sessions open, by viewer, for the Server page and the limits. */
  count(viewer?: string) {
    return [...this.sessions.values()].filter((s) => !viewer || s.viewer === viewer).length;
  }

  /**
   * Keeps a session for `viewer` and this video, or opens one within the limits: the master
   * playlist offers live rungs only when this succeeds, so a viewer past the limits gets the
   * stored rungs, never an error.
   */
  reserve(who: LiveViewer, assetId: string, limits: LiveLimits) {
    const viewer = who.group;
    const key = `${who.id}\u0000${assetId}`;
    const existing = this.sessions.get(key);
    const now = this.now();
    if (existing) {
      existing.lease = now + LEASE_MS;
      existing.last = now;
      return true;
    }
    if (this.count() >= limits.maxSessions || this.count(viewer) >= limits.perViewer) return false;
    this.sessions.set(key, {
      key,
      viewer,
      assetId,
      dir: join(this.deps.tmpDir, 'live', `${assetId}-${Math.random().toString(36).slice(2, 10)}`),
      lease: now + LEASE_MS,
      last: now,
      rung: null,
      start: 0,
      asked: 0,
      child: null,
      paused: false,
      release: null,
      source: null,
      container: null,
      attempt: 0,
    });
    return true;
  }

  /**
   * The path of a file of a live rung (`init.mp4` or `seg-<n>.m4s`), once ffmpeg wrote it; null
   * when there is no session (past the limits, expired) or ffmpeg cannot make it.
   */
  async file(
    who: LiveViewer,
    row: AssetRow,
    rung: VideoRung,
    file: 'init' | number,
    limits: LiveLimits,
  ): Promise<string | null> {
    // A session that lapsed (a paused tab) opens again within the limits.
    if (!this.reserve(who, row.id, limits)) return null;
    const session = this.sessions.get(`${who.id}\u0000${row.id}`) as Session;
    const n = file === 'init' ? (session.rung === rung ? session.start : 0) : file;
    if (file !== 'init') session.asked = n;
    const written = session.rung === rung ? await this.highest(session) : -1;
    const running = session.child !== null && session.rung === rung;
    const inWindow =
      running && n >= session.start && n <= Math.max(written, session.start) + WINDOW;
    const name = file === 'init' ? 'init.mp4' : `seg-${n}.m4s`;
    if (file !== 'init' && session.rung === rung && (await exists(join(session.dir, name))))
      return join(session.dir, name);
    if (!inWindow) {
      session.attempt = 0;
      await this.run(session, row, rung, n);
    }
    return this.wait(session, name);
  }

  private async highest(session: Session) {
    const names = await readdir(session.dir).catch(() => [] as string[]);
    return names.reduce((max, f) => {
      const m = /^seg-(\d+)\.m4s$/.exec(f);
      return m ? Math.max(max, Number(m[1])) : max;
    }, -1);
  }

  private async wait(session: Session, name: string) {
    const path = join(session.dir, name);
    const until = this.now() + SEGMENT_WAIT_MS;
    let stopped = 0;
    while (this.now() < until) {
      if (await exists(path)) return path;
      // ffmpeg ended without it: give the next encoder of the chain a second to start.
      if (!session.child) {
        stopped = stopped || this.now();
        if (this.now() - stopped > 1500) return null;
      } else stopped = 0;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }

  /** Starts ffmpeg for `rung` at segment `n`, stopping the one before. */
  private async run(session: Session, row: AssetRow, rung: VideoRung, n: number) {
    await this.stop(session);
    const { ffmpeg } = await mediaTools();
    if (!ffmpeg) return;
    await rm(session.dir, { recursive: true, force: true });
    await mkdir(session.dir, { recursive: true });
    if (!session.source) {
      const source = await this.sources.acquire(row);
      session.release = source.release;
      session.source = source.path;
      const head = await readAll(
        await this.deps.storage.read(row.storageKey, { start: 0, end: 255 }),
      ).catch(() => new Uint8Array());
      session.container = sniffVideo(head);
    }
    // ffmpeg reads the source through a link of its own, as for stored copies (privateInput).
    const input = await privateInput(session.dir, session.source);
    const container = session.container;
    const settings = { ...(this.deps.proxies ?? DEFAULT_PROXY_SETTINGS), maxDurationS: 0 };
    const info = rowInfo(row);
    // The fallback chain of stored copies: the GPU, the GPU decoding on the CPU, libx264.
    const first = this.deps.encoder ?? SOFTWARE_ENCODER;
    const chain: VideoEncoder[] = [
      first,
      ...(first.backend !== 'software' && decodesOnGpu(first, info)
        ? [{ ...first, cpuDecode: true }]
        : []),
      ...(first.backend !== 'software' ? [SOFTWARE_ENCODER] : []),
    ];
    const encoder = chain[Math.min(session.attempt, chain.length - 1)] ?? SOFTWARE_ENCODER;
    const from = n * SEGMENT_S;
    const out = (path: string) => [
      '-avoid_negative_ts',
      'disabled',
      '-f',
      'hls',
      '-hls_time',
      String(SEGMENT_S),
      '-hls_segment_type',
      'fmp4',
      '-hls_flags',
      'temp_file+independent_segments',
      '-hls_playlist_type',
      'event',
      '-hls_fmp4_init_filename',
      'init.mp4',
      '-hls_segment_filename',
      join(session.dir, 'seg-%d.m4s'),
      '-start_number',
      String(n),
      path,
    ];
    const args = ladderArgs(
      input,
      [{ rung, path: join(session.dir, 'live.m3u8') }],
      info,
      settings,
      encoder,
      container,
      { from, output: out },
    ).filter((a, i, all) => !(a === '-progress' || all[i - 1] === '-progress' || a === '-nostats'));
    const [file, argv] = await limitedCommand(ffmpeg, args, {
      memoryBytes: encoderMemory(encoder, decodesOnGpu(encoder, info)),
      fileBytes: 4 * 1024 ** 3,
      nice: false,
    });
    const child = spawn(file, argv, { env: toolEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 2000) stderr += chunk;
    });
    child.on('close', (code) => {
      if (session.child !== child) return;
      session.child = null;
      if (code === 0 || code === null) return;
      this.deps.log?.warn(
        { assetId: row.id, rung, code, encoder: encoder.backend, stderr: stderr.slice(0, 500) },
        'live encoding stopped',
      );
      // Nothing written yet: the next encoder of the chain tries from the same segment.
      void this.highest(session).then((written) => {
        if (written >= n || session.attempt + 1 >= chain.length || !this.sessions.has(session.key))
          return;
        session.attempt += 1;
        return this.run(session, row, rung, n);
      });
    });
    session.child = child;
    session.rung = rung;
    session.start = n;
    session.asked = n;
    session.paused = false;
  }

  private async stop(session: Session) {
    const child = session.child;
    session.child = null;
    if (!child) return;
    if (session.paused) child.kill('SIGCONT');
    child.kill('SIGKILL');
  }

  private async end(session: Session) {
    this.sessions.delete(session.key);
    await this.stop(session);
    await session.release?.();
    session.release = null;
    await rm(session.dir, { recursive: true, force: true });
  }

  /** Ends idle sessions and paces running encodes against what is asked. */
  private async tick() {
    const now = this.now();
    for (const session of [...this.sessions.values()]) {
      if (now - session.last > IDLE_MS || now > session.lease) {
        await this.end(session);
        continue;
      }
      const child = session.child;
      if (!child) continue;
      const ahead = (await this.highest(session)) - session.asked;
      if (!session.paused && ahead > AHEAD_PAUSE) {
        child.kill('SIGSTOP');
        session.paused = true;
      } else if (session.paused && ahead < AHEAD_RESUME) {
        child.kill('SIGCONT');
        session.paused = false;
      }
      // The folder stays clear of the sweep of stale job folders.
      await utimes(session.dir, new Date(), new Date()).catch(() => {});
    }
  }
}

const exists = (path: string) =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
