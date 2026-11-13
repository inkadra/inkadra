import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { DEFAULT_VIDEO_SETTINGS } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import type { asset } from '../db/schema.ts';
import type { Storage } from '../storage.ts';
import type { VideoEncoder } from './hwaccel.ts';
import { LiveSessions, liveEligible, livePlaylist, liveRungs, liveVariant } from './live.ts';
import { DEFAULT_PROXY_SETTINGS } from './video.ts';

const row = (over: Partial<typeof asset.$inferSelect> = {}) =>
  ({
    id: 'a1',
    kind: 'video',
    status: 'ready',
    durationMs: 9_000,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    audioCodec: 'aac',
    frameRate: 25,
    mediaInfo: { hdr: null, bits: 8, pixelFormat: 'yuv420p', interlaced: false, rotated: false },
    ...over,
  }) as typeof asset.$inferSelect;
const qsv: VideoEncoder = { backend: 'qsv', label: '' };

describe('live playback', () => {
  it('lists two-second segments from the duration alone', () => {
    const text = livePlaylist(9_000, '720');
    expect(text).toContain('#EXT-X-TARGETDURATION:2');
    expect(text).toContain('#EXT-X-MAP:URI="720/init.mp4"');
    expect(text.match(/#EXTINF/g)).toHaveLength(5);
    expect(text).toContain('#EXTINF:1.000,\n720/seg-4.m4s');
    expect(text.trimEnd().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });

  it('encodes live only what the GPU decodes and encodes on its own (Matteo, 13 Nov)', () => {
    const uhd = { width: 3840, height: 2160 };
    expect(liveEligible(row(), qsv)).toBe(true);
    expect(liveEligible(row({ ...uhd, videoCodec: 'hevc' }), qsv)).toBe(true);
    // No GPU: never live, whatever the size.
    expect(liveEligible(row(), undefined)).toBe(false);
    expect(liveEligible(row(), { backend: 'software', label: '' })).toBe(false);
    // The card cannot decode it (ProRes, 4:2:2), or the CPU would have to (rotated, interlaced,
    // HDR tone mapping, a card left decoding on the CPU).
    expect(liveEligible(row({ ...uhd, videoCodec: 'prores' }), qsv)).toBe(false);
    const media = (over: object) => ({
      mediaInfo: {
        hdr: null,
        bits: 8,
        pixelFormat: 'yuv420p',
        interlaced: false,
        rotated: false,
        ...over,
      },
    });
    expect(liveEligible(row(media({ pixelFormat: 'yuv422p10le', bits: 10 })), qsv)).toBe(false);
    expect(liveEligible(row(media({ rotated: true })), qsv)).toBe(false);
    expect(liveEligible(row(media({ interlaced: true })), qsv)).toBe(false);
    expect(
      liveEligible(
        row({ videoCodec: 'hevc', ...media({ hdr: 'hlg', bits: 10, pixelFormat: 'yuv420p10le' }) }),
        qsv,
      ),
    ).toBe(false);
    expect(liveEligible(row(), { ...qsv, cpuDecode: true })).toBe(false);
    expect(liveEligible(row({ status: 'processing' }), qsv)).toBe(false);
  });

  it('offers live the rungs not ready yet, or never stored', () => {
    expect(liveRungs(row(), ['480'], DEFAULT_VIDEO_SETTINGS, qsv)).toEqual(['720', '1080']);
    const liveOnly = {
      ...DEFAULT_VIDEO_SETTINGS,
      rungs: { '480': 'stored', '720': 'stored', '1080': 'live', '2160': 'off' },
    } as const;
    expect(liveRungs(row(), ['480', '720'], liveOnly, qsv)).toEqual(['1080']);
    const off = {
      ...DEFAULT_VIDEO_SETTINGS,
      live: { ...DEFAULT_VIDEO_SETTINGS.live, enabled: false },
    };
    expect(liveRungs(row(), [], off, qsv)).toEqual([]);
  });

  it('describes a live rung for the master playlist', () => {
    expect(liveVariant(row(), '720', DEFAULT_PROXY_SETTINGS)).toEqual({
      name: '720',
      width: 1280,
      height: 720,
      bandwidth: 4_628_000,
      average: 3_128_000,
      frameRate: 25,
      codecs: 'avc1.64001f,mp4a.40.2',
    });
  });

  it('keeps sessions within the instance and per-viewer limits', async () => {
    const sessions = new LiveSessions({ storage: {} as never, tmpDir: '/unused' });
    const limits = { maxSessions: 2, perViewer: 1 };
    const anna = { id: 'user:anna', group: 'user:anna' };
    const guest = (n: number) => ({ id: `guest:${n}`, group: 'link:l1' });
    expect(sessions.reserve(anna, 'v1', limits)).toBe(true);
    // The same viewer and video: the same session.
    expect(sessions.reserve(anna, 'v1', limits)).toBe(true);
    expect(sessions.reserve(anna, 'v2', limits)).toBe(false);
    expect(sessions.reserve(guest(1), 'v1', limits)).toBe(true);
    // The link's guests share its limit; the instance is full anyway.
    expect(sessions.reserve(guest(2), 'v1', limits)).toBe(false);
    expect(sessions.count()).toBe(2);
    await sessions.close();
    expect(sessions.count()).toBe(0);
  });

  it('starts one ffmpeg for init.mp4 and seg-0 asked at once, and lets the source go', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'inkadra-live-'));
    const spawned: string[][] = [];
    const children: EventEmitter[] = [];
    const fake = ((_file: string, argv: string[]) => {
      spawned.push(argv);
      const child = Object.assign(new EventEmitter(), {
        stderr: null,
        kill: () => {
          setImmediate(() => child.emit('close', null));
          return true;
        },
      });
      children.push(child);
      // As ffmpeg: the init segment, then the first segment, a moment later.
      const dir = dirname(argv[argv.indexOf('-hls_segment_filename') + 1] as string);
      const start = argv[argv.indexOf('-start_number') + 1];
      setTimeout(async () => {
        await writeFile(join(dir, 'init.mp4'), 'i');
        await writeFile(join(dir, `seg-${start}.m4s`), 's');
      }, 30);
      return child as unknown as ChildProcess;
    }) as unknown as typeof spawn;
    const storage = {
      copiesToLocal: true,
      async localCopy(_key: string, dir: string) {
        const path = join(dir, 'source.mov');
        await writeFile(path, 'x');
        return { path, done: async () => {} };
      },
      async read() {
        return Readable.from([Buffer.alloc(16)]);
      },
    } as unknown as Storage;
    const sessions = new LiveSessions({
      storage,
      tmpDir,
      encoder: qsv,
      ffmpeg: 'ffmpeg',
      spawn: fake,
      folder: 'p1',
    });
    const who = { id: 'user:anna', group: 'user:anna' };
    const limits = { maxSessions: 2, perViewer: 1 };
    const video = row({ storageKey: 'originals/a1', size: 1000 });
    const [init, first] = await Promise.all([
      sessions.file(who, video, '720', 'init', limits),
      sessions.file(who, video, '720', 0, limits),
    ]);
    expect(init).toMatch(/init\.mp4$/);
    expect(first).toMatch(/seg-0\.m4s$/);
    expect(spawned).toHaveLength(1);
    expect(sessions.sources.users('a1')).toBe(1);
    await sessions.close();
    expect(sessions.sources.users('a1')).toBe(0);
  });

  it('clears its own folders at start and only stale ones of other processes', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'inkadra-live-'));
    const folder = (parent: string, name: string) => join(tmpDir, parent, name);
    for (const parent of ['live', 'live-src'])
      for (const name of ['p1', 'other', 'gone'])
        await mkdir(folder(parent, name), { recursive: true });
    const old = new Date(Date.now() - 60 * 60_000);
    for (const parent of ['live', 'live-src']) await utimes(folder(parent, 'gone'), old, old);
    const sessions = new LiveSessions({ storage: {} as never, tmpDir, folder: 'p1' });
    await sessions.start();
    await sessions.close();
    // Its own (a previous run): gone. Another replica's, touched recently: kept. A dead one: gone.
    expect((await readdir(join(tmpDir, 'live'))).sort()).toEqual(['other']);
    expect((await readdir(join(tmpDir, 'live-src'))).sort()).toEqual(['other']);
  });

  it('removes a failed copy, and goes back under the cache limit as sessions end', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'inkadra-live-'));
    const storage = {
      copiesToLocal: true,
      async localCopy(key: string, dir: string) {
        await writeFile(join(dir, 'partial'), 'x');
        if (key === 'broken') throw new Error('bucket unreachable');
        const path = join(dir, 'source.mov');
        await writeFile(path, 'x');
        return { path, done: async () => {} };
      },
    } as unknown as Storage;
    const sessions = new LiveSessions({ storage, tmpDir, folder: 'p1', cacheBytes: 15 });
    const root = join(tmpDir, 'live-src', 'p1');
    await expect(
      sessions.sources.acquire(row({ id: 'b', storageKey: 'broken', size: 10 })),
    ).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(await readdir(root)).toEqual([]);
    const a = await sessions.sources.acquire(row({ id: 'a', storageKey: 'a', size: 10 }));
    const b = await sessions.sources.acquire(row({ id: 'c', storageKey: 'c', size: 10 }));
    // Both in use: over the limit for now.
    expect((await readdir(root)).sort()).toEqual(['a', 'c']);
    await a.release();
    expect(await readdir(root)).toEqual(['c']);
    await b.release();
  });
});
