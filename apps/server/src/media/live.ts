import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  ladderFor,
  VIDEO_RUNGS,
  type VideoNoLive,
  type VideoRung,
  type VideoSettings,
} from '@inkadra/shared';
import type { asset } from '../db/schema.ts';
import { trackTool } from '../monitor/children.ts';
import { readAll, type Storage } from '../storage.ts';
import { encoderMemory, type VideoEncoder } from './hwaccel.ts';
import { ladderArgs, renditionCodecs, rungSide, shortSide } from './ladder.ts';
import { rungRate } from './quality.ts';
import { privateInput } from './scratch.ts';
import { ffmpegError, keepTail, limitedCommand, toolEnv } from './tools.ts';
import {
  DEFAULT_PROXY_SETTINGS,
  decodesOnGpu,
  liveDecodable,
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
/**
 * Folders of another process (a replica sharing DATA_DIR, or a run that died) untouched this
 * long are removed: a running process touches its own every two seconds.
 */
const STALE_PROCESS_MS = 10 * 60_000;

/** This process's folder under `live/` and `live-src/`: replicas may share DATA_DIR. */
export const processFolder = () => `${hostname()}-${process.pid}`;

type AssetRow = typeof asset.$inferSelect;
/** The columns the live rules read: enough for the Video page to apply them without whole rows. */
export type LiveRow = Pick<
  AssetRow,
  | 'kind'
  | 'status'
  | 'durationMs'
  | 'width'
  | 'height'
  | 'videoCodec'
  | 'audioCodec'
  | 'frameRate'
  | 'mediaInfo'
>;

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
export function rowInfo(row: LiveRow): VideoInfo {
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
 * Whether this server can encode `row` in real time (decision 0128): a ready video with a
 * duration that the GPU decodes and encodes on its own (liveDecodable). Measured on an Intel
 * N100: ProRes UHD decoded on the CPU 0.97×, 4K HDR tone mapped on the CPU 0.59×.
 */
export function liveEligible(row: LiveRow, encoder: VideoEncoder | undefined) {
  if (row.kind !== 'video' || row.status !== 'ready' || !row.durationMs) return false;
  const info = rowInfo(row);
  if (!(shortSide(info) ?? 0)) return false;
  return liveDecodable(encoder, info);
}

/**
 * Why live playback, on and on a GPU here, never takes this video (decision 0128), or null.
 * The same rules as liveDecodable, named for the card: "ProRes: niente al volo".
 */
export function liveBlocker(row: AssetRow, encoder: VideoEncoder | undefined): VideoNoLive | null {
  if (!encoder || encoder.backend === 'software' || row.kind !== 'video') return null;
  const info = rowInfo(row);
  if (liveDecodable(encoder, info)) return null;
  const codec = info.videoCodec ?? '';
  if (codec === 'prores') return 'prores';
  if (codec === 'dnxhd') return 'dnx';
  if (info.hdr) return 'hdr';
  if (info.interlaced) return 'interlaced';
  if (/4[24]4|422/.test(info.pixelFormat ?? '')) return 'chroma';
  if (info.rotated) return 'rotated';
  return 'codec';
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

/**
 * The HLS output of a live session: fMP4 segments of SEGMENT_S seconds from `n`, in `dir`.
 * The init segment is a bare name: ffmpeg writes it next to the playlist, after the playlist's
 * last '/'. An absolute path there doubles the folder and fails with ENOENT (exit 254); a
 * Windows path has no '/', so the playlist is given with forward slashes.
 */
export const liveOutput = (dir: string, n: number) => (path: string) => [
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
  join(dir, 'seg-%d.m4s'),
  '-start_number',
  String(n),
  path.replaceAll('\\', '/'),
];

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
  /**
   * The ffmpeg being started, for `rung` from segment `n`: requests that arrive meanwhile (the
   * player asks init.mp4 and seg-0 at once) wait for it instead of starting another.
   */
  starting: { rung: VideoRung; n: number; done: Promise<void> } | null;
  ended: boolean;
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
  /**
   * `DATA_DIR/tmp`: sessions under `live/<process>/`, bucket sources under
   * `live-src/<process>/` (processFolder).
   */
  tmpDir: string;
  encoder?: VideoEncoder;
  proxies?: ProxySettings;
  log?: { warn: (fields: Record<string, unknown>, message: string) => void };
  /** Tests: another process folder, cache size, ffmpeg and spawn. */
  folder?: string;
  cacheBytes?: number;
  ffmpeg?: string;
  spawn?: typeof spawn;
}

/** Local copies of bucket sources, shared by sessions, least recently used first out. */
export class SourceCache {
  private readonly entries = new Map<
    string,
    { path: string; bytes: number; used: number; users: number; ready: Promise<string> }
  >();
  constructor(
    private readonly deps: LiveDeps,
    /** `live-src/<process>`: this process's copies only. */
    readonly root: string,
    private readonly limit = SOURCE_CACHE_BYTES,
  ) {}

  /** Sessions using the copy of `assetId` (tests and the Server page). */
  users(assetId: string) {
    return this.entries.get(assetId)?.users ?? 0;
  }

  async acquire(row: AssetRow): Promise<{ path: string; release: () => Promise<void> }> {
    const { storage } = this.deps;
    if (!storage.copiesToLocal) {
      const copy = await storage.localCopy(row.storageKey, this.deps.tmpDir);
      return { path: copy.path, release: copy.done };
    }
    let entry = this.entries.get(row.id);
    if (!entry) {
      const dir = join(this.root, row.id);
      const ready = mkdir(dir, { recursive: true })
        .then(() => storage.localCopy(row.storageKey, dir))
        .then((copy) => copy.path);
      entry = { path: '', bytes: row.size, used: Date.now(), users: 0, ready };
      this.entries.set(row.id, entry);
      // A failed copy leaves nothing behind: neither the entry nor what it wrote.
      ready.catch(async () => {
        this.entries.delete(row.id);
        await rm(dir, { recursive: true, force: true });
      });
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
        // After a spike of sessions the cache goes back under its limit as they end.
        await this.evict();
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
      await rm(join(this.root, id), { recursive: true, force: true });
    }
  }
}

/** Sessions of live playback of this process. */
export class LiveSessions {
  private readonly sessions = new Map<string, Session>();
  readonly sources: SourceCache;
  private timer: ReturnType<typeof setInterval> | null = null;
  private swept = 0;
  /** `live/<process>`: the session folders of this process. */
  private readonly root: string;

  constructor(
    private readonly deps: LiveDeps,
    private readonly now = Date.now,
  ) {
    const folder = deps.folder ?? processFolder();
    this.root = join(deps.tmpDir, 'live', folder);
    this.sources = new SourceCache(
      deps,
      join(deps.tmpDir, 'live-src', folder),
      deps.cacheBytes ?? SOURCE_CACHE_BYTES,
    );
  }

  /** Starts the sweep and the back-pressure of running encodes (every two seconds). */
  async start() {
    if (this.timer) return;
    // This process's folders of a previous run (same host and pid, as in a container that
    // restarted): nothing plays from them any more, and the cache starts empty.
    await rm(this.root, { recursive: true, force: true });
    await rm(this.sources.root, { recursive: true, force: true });
    await this.sweep();
    this.timer = setInterval(() => void this.tick(), 2000);
    this.timer.unref?.();
  }

  /**
   * Folders of other processes nobody touched for STALE_PROCESS_MS: replicas that stopped. A
   * live replica touches its own on every tick, so its sessions and sources are never taken.
   */
  async sweep(now = Date.now()) {
    for (const parent of ['live', 'live-src']) {
      const dir = join(this.deps.tmpDir, parent);
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const path = join(dir, name);
        if (path === this.root || path === this.sources.root) continue;
        const info = await stat(path).catch(() => null);
        if (!info?.isDirectory() || now - info.mtimeMs < STALE_PROCESS_MS) continue;
        await rm(path, { recursive: true, force: true });
      }
    }
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
      dir: join(this.root, `${assetId}-${Math.random().toString(36).slice(2, 10)}`),
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
      starting: null,
      ended: false,
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
    const name = file === 'init' ? 'init.mp4' : `seg-${n}.m4s`;
    if (file !== 'init' && session.rung === rung && (await exists(join(session.dir, name))))
      return join(session.dir, name);
    // From here to `session.starting` nothing awaits: two requests at once start one ffmpeg.
    const pending = session.starting;
    if (pending && pending.rung === rung && n >= pending.n && n <= pending.n + WINDOW) {
      await pending.done;
    } else {
      const running = session.child !== null && session.rung === rung;
      const inWindow =
        running && n >= session.start && n <= Math.max(written, session.start) + WINDOW;
      if (!inWindow) await this.begin(session, row, rung, n);
    }
    // ffmpeg creates the init segment empty and fills it with the first segment: it is whole
    // once that one is there.
    if (file === 'init') {
      const first = await this.wait(session, `seg-${session.start}.m4s`);
      return first ? join(session.dir, 'init.mp4') : null;
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
      // ffmpeg ended without it: a second of grace for the last writes, then give up.
      if (!session.child) {
        stopped = stopped || this.now();
        if (this.now() - stopped > 1500) return null;
      } else stopped = 0;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }

  /** Starts ffmpeg once for `rung` at `n`, after any start still under way in the session. */
  private async begin(session: Session, row: AssetRow, rung: VideoRung, n: number) {
    const before = session.starting?.done ?? Promise.resolve();
    const done = before
      .then(() => this.run(session, row, rung, n))
      .catch((err) => {
        this.deps.log?.warn(
          { assetId: row.id, rung, err: String(err) },
          'live encoding not started',
        );
      });
    const mine = { rung, n, done };
    session.starting = mine;
    await done;
    if (session.starting === mine) session.starting = null;
  }

  /** Starts ffmpeg for `rung` at segment `n`, stopping the one before. */
  private async run(session: Session, row: AssetRow, rung: VideoRung, n: number) {
    await this.stop(session);
    if (session.ended) return;
    const ffmpeg = this.deps.ffmpeg ?? (await mediaTools()).ffmpeg;
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
    if (session.ended) return;
    // ffmpeg reads the source through a link of its own, as for stored copies (privateInput).
    const input = await privateInput(session.dir, session.source);
    const container = session.container;
    const settings = { ...(this.deps.proxies ?? DEFAULT_PROXY_SETTINGS), maxDurationS: 0 };
    const info = rowInfo(row);
    // The GPU only: no CPU decoding, no libx264 (not real time). If it fails, the request
    // answers 503 and the player keeps to the stored rungs or the original.
    const encoder = this.deps.encoder;
    if (!encoder || encoder.backend === 'software') return;
    const from = n * SEGMENT_S;
    const out = liveOutput(session.dir, n);
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
    const child = (this.deps.spawn ?? spawn)(file, argv, {
      env: toolEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    trackTool(child, ffmpeg, [row.filename, `${rung}p live`]);
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = keepTail(stderr, chunk);
    });
    child.on('close', (code) => {
      if (session.child !== child) return;
      session.child = null;
      if (code === 0 || code === null) return;
      this.deps.log?.warn(
        { assetId: row.id, rung, code, encoder: encoder.backend, stderr: ffmpegError(stderr) },
        'live encoding stopped',
      );
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
    session.ended = true;
    // A start under way finishes first, so its ffmpeg and its source are let go here too.
    await session.starting?.done;
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
    // This process's roots stay clear of the sweep of other replicas.
    for (const root of [this.root, this.sources.root])
      await utimes(root, new Date(), new Date()).catch(() => {});
    if (now - this.swept > 60_000) {
      this.swept = now;
      await this.sweep();
    }
  }
}

const exists = (path: string) =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
