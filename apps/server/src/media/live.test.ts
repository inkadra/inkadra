import { DEFAULT_VIDEO_SETTINGS } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import type { asset } from '../db/schema.ts';
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

  it('keeps sources the hardware cannot encode in real time for stored copies', () => {
    expect(liveEligible(row(), undefined)).toBe(true);
    const uhd = { width: 3840, height: 2160 };
    expect(liveEligible(row({ ...uhd, videoCodec: 'hevc' }), qsv)).toBe(true);
    // ProRes 4K decodes on the CPU: 0.97× on an N100.
    expect(liveEligible(row({ ...uhd, videoCodec: 'prores' }), qsv)).toBe(false);
    // 4K HDR is tone mapped on the CPU: 0.59×.
    const hdr = { hdr: 'hlg' as const, bits: 10, pixelFormat: 'yuv420p10le', interlaced: false, rotated: false };
    expect(liveEligible(row({ ...uhd, videoCodec: 'hevc', mediaInfo: hdr }), qsv)).toBe(false);
    // Without a GPU, nothing past 1080.
    expect(liveEligible(row({ ...uhd, videoCodec: 'hevc' }), undefined)).toBe(false);
    expect(liveEligible(row({ status: 'processing' }), qsv)).toBe(false);
  });

  it('offers live the rungs not ready yet, or never stored', () => {
    expect(liveRungs(row(), ['480'], DEFAULT_VIDEO_SETTINGS, qsv)).toEqual(['720', '1080']);
    const liveOnly = {
      ...DEFAULT_VIDEO_SETTINGS,
      rungs: { '480': 'stored', '720': 'stored', '1080': 'live', '2160': 'off' },
    } as const;
    expect(liveRungs(row(), ['480', '720'], liveOnly, qsv)).toEqual(['1080']);
    const off = { ...DEFAULT_VIDEO_SETTINGS, live: { ...DEFAULT_VIDEO_SETTINGS.live, enabled: false } };
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
});
