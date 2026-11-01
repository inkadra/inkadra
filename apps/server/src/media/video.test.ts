import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROXY_SETTINGS,
  MAX_INT32,
  PROXY_MAX_RUN_MS,
  parseProbe,
  proxyArgs,
  proxyMaxBytes,
  proxyPlan,
  proxyTimeoutMs,
  safeInput,
  sniffAudio,
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

  it('discards a duration the row could not hold', () => {
    const claim = (duration: string) => parseProbe({ format: { duration } }).durationMs;
    expect(claim(String(MAX_INT32 / 1000))).toBe(MAX_INT32);
    expect(claim('2147484')).toBeNull();
    expect(claim('1e300')).toBeNull();
    expect(claim('Infinity')).toBeNull();
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
  const args = (i: VideoInfo, settings = DEFAULT_PROXY_SETTINGS) =>
    proxyArgs('/in', '/out.mp4', i, settings, 50 * 1024 ** 2);
  const flagValue = (list: string[], flag: string) => list[list.indexOf(flag) + 1];

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

  it('maps the first real video stream, never cover art', () => {
    const list = args(info());
    expect(list[list.indexOf('-map') + 1]).toBe('0:V:0');
    expect(list).not.toContain('0:v:0');
  });

  it('caps the length, the size and the threads of the copy', () => {
    const list = args(info({ videoCodec: 'prores' }));
    expect(flagValue(list, '-t')).toBe('7200');
    expect(flagValue(list, '-threads')).toBe('2');
    // 10 s at 5 Mbit/s plus sound, half again, and a 16 MB margin.
    expect(Number(flagValue(list, '-fs'))).toBe(
      proxyMaxBytes(info({ videoCodec: 'prores' }), DEFAULT_PROXY_SETTINGS, 50 * 1024 ** 2),
    );
    expect(Number(flagValue(list, '-fs'))).toBeLessThan(30 * 1024 ** 2);
    expect(args(info(), { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 0 })).not.toContain('-t');
    // A remux is as large as its source, not as the bitrate says.
    const remux = Number(flagValue(args(info({ audioCodec: 'opus' })), '-fs'));
    expect(remux).toBeGreaterThan(55 * 1024 ** 2);
  });

  it('plans a video of unknown length for the cap, not for nothing', () => {
    const unknown = info({ videoCodec: 'prores', durationMs: null });
    // 7200 s at 5.384 Mbit/s, half again: about 7 GB, never 0.
    expect(proxyMaxBytes(unknown, DEFAULT_PROXY_SETTINGS, 1000)).toBeGreaterThan(6e9);
    const noCap = { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 0, maxSourceBytes: 0 };
    // No limit of its own: the 4-hour run limit plans an hour of video.
    expect(proxyMaxBytes(unknown, noCap, 1000)).toBeGreaterThan(3e9);
    expect(proxyPlan('video/quicktime', unknown, 1000, DEFAULT_PROXY_SETTINGS)).toBe('make');
  });
});

describe('proxyTimeoutMs', () => {
  it('is four times the length, at least ten minutes, at most four hours', () => {
    expect(proxyTimeoutMs(info({ durationMs: 60_000 }), DEFAULT_PROXY_SETTINGS)).toBe(600_000);
    expect(proxyTimeoutMs(info({ durationMs: 30 * 60_000 }), DEFAULT_PROXY_SETTINGS)).toBe(
      2 * 60 * 60_000,
    );
    expect(proxyTimeoutMs(info({ durationMs: MAX_INT32 }), DEFAULT_PROXY_SETTINGS)).toBe(
      PROXY_MAX_RUN_MS,
    );
    // Unknown length: the cap of the instance, so four hours here too.
    expect(proxyTimeoutMs(info({ durationMs: null }), DEFAULT_PROXY_SETTINGS)).toBe(
      PROXY_MAX_RUN_MS,
    );
    expect(PROXY_MAX_RUN_MS).toBeLessThan(MAX_INT32);
  });
});

describe('audio files (#327)', () => {
  const bytes = (...parts: Array<string | number[]>) =>
    Uint8Array.from(
      parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );
  const sound = (audioCodec: string) =>
    info({ videoCodec: null, width: null, height: null, frameRate: null, audioCodec });

  it('tells audio containers apart from their first bytes', () => {
    expect(sniffAudio(bytes('ID3', [4, 0]))).toBe('audio/mpeg');
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90]))).toBe('audio/mpeg');
    expect(sniffAudio(bytes([0xff, 0xf1, 0x50]))).toBe('audio/aac');
    expect(sniffAudio(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '))).toBe('audio/wav');
    expect(sniffAudio(bytes('OggS'))).toBe('audio/ogg');
    expect(sniffAudio(bytes('fLaC'))).toBe('audio/flac');
    expect(sniffAudio(bytes([0, 0, 0, 32], 'ftypM4A '))).toBe('audio/mp4');
    expect(sniffAudio(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('audio/webm');
    expect(sniffAudio(bytes('FORM', [0, 0, 0, 0], 'AIFF'))).toBe('audio/aiff');
    expect(sniffAudio(bytes('#EXTM3U\n'))).toBeNull();
    expect(sniffAudio(bytes('RIFF', [0, 0, 0, 0], 'AVI '))).toBeNull();
  });

  it('opens audio with the audio demuxers only, never playlists', () => {
    const list = safeInput('audio/ogg');
    expect(list[list.indexOf('-format_whitelist') + 1]).toContain('ogg');
    expect(list.join(' ')).not.toMatch(/hls|concat|m3u/);
    expect(safeInput('audio/mp4')).toContain('-enable_drefs');
  });

  it('copies only what not every browser plays', () => {
    const plan = (container: string, codec: string) =>
      proxyPlan(container, sound(codec), 1000, DEFAULT_PROXY_SETTINGS);
    expect(plan('audio/mpeg', 'mp3')).toBe('none');
    expect(plan('audio/mp4', 'aac')).toBe('none');
    expect(plan('audio/wav', 'pcm_s16le')).toBe('none');
    expect(plan('audio/flac', 'flac')).toBe('none');
    expect(plan('audio/ogg', 'opus')).toBe('make');
    expect(plan('audio/webm', 'opus')).toBe('make');
    expect(plan('audio/mp4', 'alac')).toBe('make');
    expect(plan('audio/aiff', 'pcm_s16be')).toBe('make');
    expect(
      proxyPlan('audio/ogg', sound('opus'), 1000, { ...DEFAULT_PROXY_SETTINGS, enabled: false }),
    ).toBe('skip');
    expect(
      proxyPlan(
        'audio/ogg',
        info({ videoCodec: null, audioCodec: null }),
        1,
        DEFAULT_PROXY_SETTINGS,
      ),
    ).toBe('none');
  });

  it('encodes the sound alone to AAC, with the same caps as a video', () => {
    const args = proxyArgs(
      '/in',
      '/out.mp4',
      sound('opus'),
      DEFAULT_PROXY_SETTINGS,
      1e6,
      undefined,
      'audio/ogg',
    );
    const line = args.join(' ');
    expect(line).toContain('-map 0:a:0 -vn');
    expect(line).toContain('-c:a aac');
    expect(line).not.toContain('-c:v');
    expect(line).toContain('-t 7200');
    expect(line).toContain('-fs');
    // Sized for sound, not for a 5 Mbit/s picture.
    expect(proxyMaxBytes(sound('opus'), DEFAULT_PROXY_SETTINGS, 1e6)).toBeLessThan(
      proxyMaxBytes(info({ videoCodec: 'prores' }), DEFAULT_PROXY_SETTINGS, 1e6),
    );
  });
});
