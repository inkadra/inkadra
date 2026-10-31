import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROXY_SETTINGS,
  parseProbe,
  proxyArgs,
  proxyPlan,
  type VideoInfo,
  webPlayable,
} from './video.ts';

const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({
  durationMs: 10_000,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  audioCodec: 'aac',
  frameRate: 25,
  pixelFormat: 'yuv420p',
  ...over,
});

describe('parseProbe', () => {
  it('keeps the picture stream, not cover art, and turns portrait phone videos', () => {
    const parsed = parseProbe({
      format: { duration: '12.480000' },
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        {
          codec_type: 'video',
          codec_name: 'hevc',
          pix_fmt: 'yuv420p10le',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30000/1001',
          side_data_list: [{ rotation: -90 }],
          disposition: { attached_pic: 0 },
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    expect(parsed).toEqual({
      durationMs: 12_480,
      width: 1080,
      height: 1920,
      videoCodec: 'hevc',
      audioCodec: 'aac',
      frameRate: 29.97,
      pixelFormat: 'yuv420p10le',
    });
  });

  it('turns odd answers into nulls', () => {
    expect(
      parseProbe({
        format: { duration: 'N/A' },
        streams: [{ codec_type: 'video', codec_name: 'x; rm -rf', avg_frame_rate: '0/0' }],
      }),
    ).toEqual({
      durationMs: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      frameRate: null,
      pixelFormat: null,
    });
    expect(parseProbe(null).videoCodec).toBeNull();
  });
});

describe('webPlayable', () => {
  it('plays H.264 MP4 and VP9 WebM as uploaded', () => {
    expect(webPlayable('video/mp4', info())).toBe(true);
    expect(webPlayable('video/mp4', info({ audioCodec: null }))).toBe(true);
    expect(
      webPlayable('video/webm', info({ videoCodec: 'vp9', audioCodec: 'opus', pixelFormat: null })),
    ).toBe(true);
  });

  it('does not trust camera formats', () => {
    expect(webPlayable('video/quicktime', info({ videoCodec: 'prores' }))).toBe(false);
    expect(webPlayable('video/quicktime', info())).toBe(false);
    expect(webPlayable('video/mp4', info({ videoCodec: 'hevc' }))).toBe(false);
    expect(webPlayable('video/mp4', info({ pixelFormat: 'yuv422p10le' }))).toBe(false);
    expect(webPlayable('video/mp4', info({ audioCodec: 'pcm_s16le' }))).toBe(false);
    expect(webPlayable('video/webm', info())).toBe(false);
    expect(webPlayable('application/mxf', info())).toBe(false);
    expect(webPlayable('video/x-msvideo', info())).toBe(false);
  });
});

describe('proxyPlan', () => {
  const prores = info({ videoCodec: 'prores', pixelFormat: 'yuv422p10le' });

  it('makes nothing for a video that already plays or has no picture', () => {
    expect(proxyPlan('video/mp4', info(), 1000, DEFAULT_PROXY_SETTINGS)).toBe('none');
    expect(
      proxyPlan('video/quicktime', info({ videoCodec: null }), 1000, DEFAULT_PROXY_SETTINGS),
    ).toBe('none');
  });

  it('makes a copy within the limits, skips it past them or when turned off', () => {
    expect(proxyPlan('video/quicktime', prores, 1000, DEFAULT_PROXY_SETTINGS)).toBe('make');
    const off = { ...DEFAULT_PROXY_SETTINGS, enabled: false };
    expect(proxyPlan('video/quicktime', prores, 1000, off)).toBe('skip');
    const short = { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 5 };
    expect(proxyPlan('video/quicktime', prores, 1000, short)).toBe('skip');
    const small = { ...DEFAULT_PROXY_SETTINGS, maxSourceBytes: 999 };
    expect(proxyPlan('video/quicktime', prores, 1000, small)).toBe('skip');
    const unlimited = { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 0, maxSourceBytes: 0 };
    expect(proxyPlan('video/quicktime', prores, 10 ** 12, unlimited)).toBe('make');
  });
});

describe('proxyArgs', () => {
  const args = (i: VideoInfo) => proxyArgs('/in', '/out.mp4', i, DEFAULT_PROXY_SETTINGS);

  it('only changes the container of H.264 that fits, re-encoding sound that is not AAC', () => {
    const remux = args(info({ audioCodec: 'opus' }));
    expect(remux.join(' ')).toContain('-c:v copy');
    expect(remux.join(' ')).toContain('-c:a aac');
    expect(args(info()).join(' ')).toContain('-c:a copy');
  });

  it('encodes other video to H.264, at most 1080 on the shorter side, safely', () => {
    const encode = args(info({ videoCodec: 'prores', pixelFormat: 'yuv422p10le' }));
    const line = encode.join(' ');
    expect(line).toContain('-c:v libx264');
    expect(line).toContain('-maxrate 5M -bufsize 10M');
    expect(line).toContain('min(1080,');
    expect(line).toContain('-protocol_whitelist file');
    expect(line).toContain('+faststart');
    // 4K H.264 is scaled down rather than copied.
    expect(args(info({ width: 3840, height: 2160 })).join(' ')).toContain('libx264');
  });
});
