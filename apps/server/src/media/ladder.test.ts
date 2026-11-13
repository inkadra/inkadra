import { describe, expect, it } from 'vitest';
import type { VideoEncoder } from './hwaccel.ts';
import {
  customRate,
  generationOf,
  isHeavy,
  ladderArgs,
  recipesFor,
  renditionCodecs,
  renditionKey,
  videoPlan,
} from './ladder.ts';
import { DEFAULT_PROXY_SETTINGS, type VideoInfo } from './video.ts';

const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({
  durationMs: 10_000,
  width: 3840,
  height: 2160,
  videoCodec: 'prores',
  audioCodec: 'pcm_s16le',
  frameRate: 25,
  pixelFormat: 'yuv422p10le',
  bits: 10,
  audioChannels: [2],
  ...over,
});
const settings = DEFAULT_PROXY_SETTINGS;

describe('videoPlan', () => {
  it('gives camera files the ladder, never above their size', () => {
    expect(videoPlan('video/quicktime', info(), 1e9, settings)).toEqual({
      kind: 'ladder',
      rungs: ['480', '720', '1080'],
      original: false,
    });
    const small = info({ width: 1280, height: 720 });
    expect(videoPlan('video/quicktime', small, 1e8, settings)).toMatchObject({
      rungs: ['480', '720'],
    });
  });

  it('streams a light playable MP4 as it is, a heavy one through the ladder', () => {
    const phone = info({ videoCodec: 'h264', pixelFormat: 'yuv420p', width: 1920, height: 1080 });
    // 10 s, 10 MB: 8 Mbit/s.
    expect(videoPlan('video/mp4', { ...phone, audioCodec: 'aac' }, 10e6, settings)).toEqual({
      kind: 'none',
    });
    const camera = { ...phone, audioCodec: 'aac', width: 3840, height: 2160 };
    expect(videoPlan('video/mp4', camera, 125e6, settings)).toMatchObject({
      kind: 'ladder',
      original: true,
    });
    expect(videoPlan('video/mp4', camera, 125e6, { ...settings, playable: 'never' }).kind).toBe(
      'none',
    );
    expect(
      videoPlan('video/mp4', { ...phone, audioCodec: 'aac' }, 10e6, {
        ...settings,
        playable: 'always',
      }).kind,
    ).toBe('ladder');
  });

  it('remuxes light H.264 from a phone MOV, copies sound files, skips past the limits', () => {
    const mov = info({ videoCodec: 'h264', pixelFormat: 'yuv420p', width: 1920, height: 1080 });
    expect(videoPlan('video/quicktime', mov, 5e6, settings).kind).toBe('remux');
    const ogg = info({ videoCodec: null, audioCodec: 'opus', width: null, height: null });
    expect(videoPlan('audio/ogg', ogg, 1e6, settings).kind).toBe('audio');
    expect(videoPlan('video/quicktime', info(), 1e9, { ...settings, maxDurationS: 5 }).kind).toBe(
      'skip',
    );
  });

  it('calls heavy what is over 1080, 12 Mbit/s or 60 fps', () => {
    const hd = info({ width: 1920, height: 1080 });
    expect(isHeavy(hd, 10e6)).toBe(false);
    expect(isHeavy(hd, 20e6)).toBe(true);
    expect(isHeavy({ ...hd, frameRate: 120 }, 1e6)).toBe(true);
    expect(isHeavy(info(), 1e6)).toBe(true);
  });
});

describe('ladderArgs', () => {
  const outputs = [
    { rung: '720' as const, path: '/job/720.mp4' },
    { rung: '1080' as const, path: '/job/1080.mp4' },
  ];

  it('decodes once and splits to one encoder per rung, fragmented with an index', () => {
    const args = ladderArgs('/in', outputs, info(), settings);
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toMatch(/^\[0:V:0\]split=2\[s0\]\[s1\];\[s0\]scale=.*min\(720,/);
    expect(graph).toContain(';[s1]scale=');
    expect(graph).toContain('zscale=dither=error_diffusion');
    expect(graph).toContain('[0:a:0]asplit=2[a0][a1]');
    expect(args.filter((a) => a === '-map')).toHaveLength(4);
    expect(
      args.filter((a) => a === '+frag_keyframe+empty_moov+default_base_moof+global_sidx'),
    ).toHaveLength(2);
    // Each rung has its own rate: 720p and 1080p at 25 fps, balanced.
    expect(args).toEqual(expect.arrayContaining(['-maxrate', '4500000']));
    expect(args).toEqual(expect.arrayContaining(['-maxrate', '9000000']));
    expect(args.at(-1)).toBe('/job/1080.mp4');
  });

  it('deinterlaces once, merges mono tracks, puts device options before the input', () => {
    const qsv: VideoEncoder = { backend: 'qsv', device: '/dev/dri/renderD128', label: '' };
    const args = ladderArgs('/in', outputs, info({ interlaced: true, audioChannels: [1, 1] }), {
      ...settings,
      encoder: qsv,
    });
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(graph.startsWith('[0:V:0]bwdif=mode=send_frame:deint=interlaced,split=2')).toBe(true);
    expect(graph).toContain('[0:a:0][0:a:1]amerge=inputs=2,asplit=2[a0][a1]');
    expect(args.indexOf('-init_hw_device')).toBeLessThan(args.indexOf('-i'));
    expect(args.filter((a) => a === 'h264_qsv')).toHaveLength(2);
  });

  it('leaves sound out of a silent video', () => {
    const args = ladderArgs(
      '/in',
      outputs,
      info({ audioCodec: null, audioChannels: [] }),
      settings,
    );
    expect(args.join(' ')).not.toContain('asplit');
    expect(args.join(' ')).not.toContain('-c:a');
  });
});

describe('renditions', () => {
  it('names files by generation, and reads it back', () => {
    const key = renditionKey('a1', 'Ab3_-x', '720');
    expect(key).toBe('variants/a1/rAb3_-x-720.mp4');
    expect(generationOf(key)).toBe('Ab3_-x');
    expect(generationOf('variants/a1/proxy.mp4')).toBeNull();
  });

  it('declares the H.264 level the size and rate need', () => {
    expect(renditionCodecs(854, 480, 25)).toBe('avc1.64001e,mp4a.40.2');
    expect(renditionCodecs(1920, 1080, 25)).toBe('avc1.640028,mp4a.40.2');
    expect(renditionCodecs(1920, 1080, 50)).toBe('avc1.64002a,mp4a.40.2');
    expect(renditionCodecs(3840, 2160, 30)).toBe('avc1.640033,mp4a.40.2');
  });
});

describe('recipes (decision 0128)', () => {
  it('change with the custom values of a rung, and only for that rung', () => {
    const plain = recipesFor('balanced');
    expect(plain['720']).toBe('h264/balanced/1');
    const custom = recipesFor('balanced', { '720': { target: 4_000_000, quality: 20 } });
    expect(custom['720']).toBe('h264/balanced/1/t4000000pq20');
    expect(custom['1080']).toBe(plain['1080']);
  });

  it('encode a rung with its custom rate and quality', () => {
    const args = ladderArgs('/in', [{ rung: '720', path: '/o.mp4' }], info(), {
      ...DEFAULT_PROXY_SETTINGS,
      custom: { '720': { target: 4_000_000, peak: 5_000_000, quality: 18 } },
    });
    expect(args).toEqual(
      expect.arrayContaining(['-crf', '18', '-maxrate', '5000000', '-bufsize', '10000000']),
    );
  });

  it('keep custom values under VIDEO_PROXY_BITRATE', () => {
    const capped = {
      ...DEFAULT_PROXY_SETTINGS,
      bitrate: '3M',
      custom: { '720': { target: 4_000_000, peak: 6_000_000 } },
    };
    expect(customRate(capped, '720', 720, 25)).toEqual({
      target: 3_000_000,
      peak: 3_000_000,
      buffer: 6_000_000,
    });
  });
});
