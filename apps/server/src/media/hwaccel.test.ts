import { describe, expect, it, vi } from 'vitest';
import {
  type DetectIo,
  detectVideoEncoder,
  encoderMemory,
  gpuDecodes,
  liveSessionsFor,
  measureLive,
  NVENC_GPU_MEMORY,
  parseSpeed,
  SOFTWARE_ENCODER,
  testEncodeArgs,
  type VideoEncoder,
  videoPipeline,
} from './hwaccel.ts';
import { rungRate } from './quality.ts';
import { DEFAULT_PROXY_SETTINGS, proxyArgs, proxyMemory, type VideoInfo } from './video.ts';

const ENCODERS = `Encoders:
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)
 V....D h264_vaapi           H.264/AVC (VAAPI) (codec h264)
`;

/**
 * Detection with every probe mocked: `works` lists the backends whose test encode passes,
 * `gpuFails` those whose GPU-decode test then fails.
 */
function io(
  over: Partial<DetectIo> & { works?: string[]; gpuFails?: string[]; basicOnly?: string[] } = {},
) {
  const works = over.works ?? [];
  const gpuFails = over.gpuFails ?? [];
  const basicOnly = over.basicOnly ?? [];
  const sampleDone = vi.fn(async () => {});
  const mock = {
    sampleDone,
    encoders: vi.fn(async () => ENCODERS),
    testEncode: vi.fn(
      async (_ffmpeg: string, _args: string[], e: VideoEncoder, gpuDecode: boolean) => {
        if (!works.includes(e.lowPower ? `${e.backend}-lp` : e.backend))
          return 'Device creation failed';
        if (e.tuning === 'full' && basicOnly.includes(e.backend)) return 'Invalid RC mode';
        return gpuDecode && gpuFails.includes(e.backend) ? 'Impossible to convert' : null;
      },
    ),
    sample: vi.fn(async () => ({ path: '/tmp/sample.mp4', done: sampleDone })),
    bench: vi.fn(async (): Promise<string | null> => null),
    canOpen: vi.fn(async () => true),
    nvidiaName: vi.fn(async () => 'NVIDIA GeForce RTX 3060'),
    vendor: vi.fn(async () => '0x8086'),
    ...over,
  };
  return mock;
}

const opts = {
  resolution: 1080,
  rate: rungRate('balanced', 1080, 25),
  quality: 'balanced' as const,
  fps: 25,
};

describe('videoPipeline', () => {
  it('aims libx264 at a constant quality under the peak of the preset', () => {
    const p = videoPipeline(SOFTWARE_ENCODER, { ...opts, gpu: true });
    expect(p.input).toEqual([]);
    expect(p.filter).toMatch(
      /^scale='if\(gte\(iw,ih\),-2,min\(1080.*:flags=lanczos:out_color_matrix=bt709:out_range=tv,setsar=1$/,
    );
    expect(p.codec).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '21',
      '-maxrate',
      '9000000',
      '-bufsize',
      '18000000',
      '-aq-mode',
      '3',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-force_key_frames',
      'expr:gte(t,n_forced*2)',
      '-g',
      '250',
      '-profile:v',
      'high',
      '-bsf:v',
      'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
    ]);
  });

  it('follows the preset: the light one is faster and lighter', () => {
    const p = videoPipeline(SOFTWARE_ENCODER, {
      ...opts,
      quality: 'light',
      rate: rungRate('light', 1080, 25),
      gpu: false,
    });
    expect(p.codec).toEqual(
      expect.arrayContaining(['veryfast', '-crf', '24', '-maxrate', '5250000']),
    );
  });

  it('decodes and scales on the card with NVENC, or only encodes there', () => {
    const nvenc: VideoEncoder = { backend: 'nvenc', label: 'NVENC' };
    const gpu = videoPipeline(nvenc, { ...opts, gpu: true });
    expect(gpu.input).toEqual(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']);
    expect(gpu.filter).toMatch(/^scale_cuda=w='if.*':h='if.*':format=yuv420p$/);
    expect(gpu.codec).toEqual(
      expect.arrayContaining(['h264_nvenc', '-cq', '26', '-maxrate', '9000000', 'high']),
    );
    expect(gpu.codec).toEqual(expect.arrayContaining(['-b_ref_mode', 'middle', '-forced-idr']));
    const cpu = videoPipeline(nvenc, { ...opts, gpu: false });
    expect(cpu.input).toEqual([]);
    expect(cpu.filter).toMatch(/^scale=.*:out_range=tv,setsar=1,format=yuv420p$/);
    // Older cards: the same quality, without lookahead and B-frame references.
    const basic = videoPipeline({ ...nvenc, tuning: 'basic' }, { ...opts, gpu: true });
    expect(basic.codec).toEqual(expect.arrayContaining(['-cq', '26', '-spatial-aq', '1']));
    expect(basic.codec).not.toContain('-b_ref_mode');
    expect(basic.codec).not.toContain('-rc-lookahead');
  });

  it('uses the render node for VAAPI, uploading CPU frames when it cannot decode', () => {
    const vaapi: VideoEncoder = { backend: 'vaapi', device: '/dev/dri/renderD129', label: '' };
    const gpu = videoPipeline(vaapi, { ...opts, gpu: true });
    expect(gpu.input).toEqual([
      '-hwaccel',
      'vaapi',
      '-hwaccel_device',
      '/dev/dri/renderD129',
      '-hwaccel_output_format',
      'vaapi',
    ]);
    expect(gpu.filter).toMatch(/^scale_vaapi=w=.*:format=nv12$/);
    const cpu = videoPipeline({ ...vaapi, lowPower: true }, { ...opts, gpu: false });
    expect(cpu.input).toEqual([
      '-init_hw_device',
      'vaapi=va:/dev/dri/renderD129',
      '-filter_hw_device',
      'va',
    ]);
    expect(cpu.filter).toMatch(/^scale=.*,format=nv12,hwupload$/);
    // The average is the preset's target, no longer half the peak.
    expect(cpu.codec).toEqual(
      expect.arrayContaining(['h264_vaapi', '-low_power', '1', '-rc_mode', 'QVBR']),
    );
    expect(cpu.codec).toEqual(
      expect.arrayContaining(['-b:v', '6000000', '-maxrate', '9000000', '-global_quality', '24']),
    );
    const basic = videoPipeline({ ...vaapi, tuning: 'basic' }, { ...opts, gpu: false });
    expect(basic.codec).toEqual(expect.arrayContaining(['-rc_mode', 'VBR', '-b:v', '6000000']));
    expect(basic.codec).not.toContain('-global_quality');
  });

  it('maps VAAPI frames to QSV, or uploads CPU frames to it', () => {
    const qsv: VideoEncoder = { backend: 'qsv', device: '/dev/dri/renderD128', label: '' };
    const gpu = videoPipeline(qsv, { ...opts, gpu: true });
    expect(gpu.input).toEqual([
      '-init_hw_device',
      'vaapi=va:/dev/dri/renderD128',
      '-init_hw_device',
      'qsv=qs@va',
      '-filter_hw_device',
      'qs',
      '-hwaccel',
      'vaapi',
      '-hwaccel_device',
      'va',
      '-hwaccel_output_format',
      'vaapi',
    ]);
    expect(gpu.filter).toMatch(/format=nv12,hwmap=derive_device=qsv,format=qsv$/);
    const cpu = videoPipeline(qsv, { ...opts, gpu: false });
    expect(cpu.input).not.toContain('-hwaccel');
    expect(cpu.filter).toMatch(/^scale=.*,format=nv12,hwupload=extra_hw_frames=64,format=qsv$/);
    expect(cpu.codec.slice(0, 2)).toEqual(['-c:v', 'h264_qsv']);
    // QVBR: a quality with a target and a cap; medium, not veryfast.
    expect(cpu.codec).toEqual(
      expect.arrayContaining(['-preset', 'medium', '-global_quality', '24', '-b:v', '6000000']),
    );
    expect(cpu.codec).toEqual(expect.arrayContaining(['-maxrate', '9000000', '-forced_idr', '1']));
    const basic = videoPipeline({ ...qsv, tuning: 'basic' }, { ...opts, gpu: false });
    expect(basic.codec).not.toContain('-global_quality');
    expect(basic.codec).not.toContain('-extbrc');
    expect(basic.codec).toEqual(expect.arrayContaining(['-b:v', '6000000']));
  });

  it('scales 10-bit frames on the card and brings them down for the CPU filters', () => {
    const post = 'format=yuv420p10le,zscale=dither=error_diffusion,format=yuv420p';
    const nvenc = videoPipeline({ backend: 'nvenc', label: '' }, { ...opts, gpu: true, post });
    expect(nvenc.filter).toMatch(
      /^scale_cuda=w=.*:format=p010le,hwdownload,format=p010le,format=yuv420p10le,zscale=dither=error_diffusion,format=yuv420p,format=yuv420p$/,
    );
    const qsv = videoPipeline(
      { backend: 'qsv', device: '/dev/dri/renderD128', label: '' },
      { ...opts, gpu: true, post },
    );
    expect(qsv.filter).toMatch(
      /^scale_vaapi=w=.*:format=p010,hwdownload,format=p010le,format=yuv420p10le,zscale=.*,format=nv12,hwupload=extra_hw_frames=64,format=qsv$/,
    );
    const cpu = videoPipeline(SOFTWARE_ENCODER, { ...opts, gpu: false, pre: 'bwdif', post });
    expect(cpu.filter).toMatch(/^bwdif,scale=.*setsar=1,format=yuv420p10le,zscale=dither/);
  });

  it('leaves ProRes, 4:2:2 and 10-bit H.264 to the CPU decoder', () => {
    expect(gpuDecodes('h264', 'yuv420p')).toBe(true);
    expect(gpuDecodes('hevc', 'yuv420p10le')).toBe(true);
    expect(gpuDecodes('h264', 'yuv420p10le')).toBe(false);
    expect(gpuDecodes('hevc', 'yuv422p10le')).toBe(false);
    expect(gpuDecodes('prores', 'yuv422p10le')).toBe(false);
    expect(gpuDecodes(null, null)).toBe(false);
  });

  it('keeps the 4 GiB cap whenever the CPU decodes, whatever encodes', () => {
    const nvenc: VideoEncoder = { backend: 'nvenc', label: '' };
    const qsv: VideoEncoder = { backend: 'qsv', label: '' };
    expect(encoderMemory(SOFTWARE_ENCODER, true)).toBe(4 * 1024 ** 3);
    expect(encoderMemory(nvenc, false)).toBe(4 * 1024 ** 3);
    expect(encoderMemory({ ...nvenc, cpuDecode: true }, true)).toBe(4 * 1024 ** 3);
    expect(encoderMemory(qsv, false)).toBe(4 * 1024 ** 3);
    // Raised only when the GPU decodes, and never left unbounded.
    expect(encoderMemory(qsv, true)).toBe(8 * 1024 ** 3);
    expect(encoderMemory(nvenc, true)).toBe(NVENC_GPU_MEMORY);
    expect(NVENC_GPU_MEMORY).toBe(64 * 1024 ** 3);
  });

  it('picks the cap of a copy from what decodes its source', () => {
    const nvenc: VideoEncoder = { backend: 'nvenc', label: '' };
    const settings = { ...DEFAULT_PROXY_SETTINGS, encoder: nvenc };
    const base = {
      durationMs: 10_000,
      width: 3840,
      height: 2160,
      audioCodec: null,
      frameRate: 25,
    };
    const hevc = { ...base, videoCodec: 'hevc', pixelFormat: 'yuv420p' };
    const prores = { ...base, videoCodec: 'prores', pixelFormat: 'yuv422p10le' };
    const small = { ...base, width: 1280, height: 720, videoCodec: 'h264', pixelFormat: 'yuv420p' };
    expect(proxyMemory(hevc, settings, nvenc, 1e8)).toBe(NVENC_GPU_MEMORY);
    expect(proxyMemory(prores, settings, nvenc, 1e8)).toBe(4 * 1024 ** 3);
    expect(proxyMemory(hevc, settings, { ...nvenc, cpuDecode: true }, 1e8)).toBe(4 * 1024 ** 3);
    expect(proxyMemory(hevc, settings, SOFTWARE_ENCODER, 1e8)).toBe(4 * 1024 ** 3);
    // A remux decodes nothing: the software cap.
    expect(proxyMemory(small, settings, nvenc, 5e6)).toBe(4 * 1024 ** 3);
  });
});

describe('proxyArgs with a hardware encoder', () => {
  const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({
    durationMs: 10_000,
    width: 3840,
    height: 2160,
    videoCodec: 'hevc',
    audioCodec: 'pcm_s16le',
    frameRate: 25,
    pixelFormat: 'yuv420p10le',
    ...over,
  });
  const qsv: VideoEncoder = { backend: 'qsv', device: '/dev/dri/renderD128', label: '' };
  const settings = { ...DEFAULT_PROXY_SETTINGS, encoder: qsv };

  it('keeps the limits of #354 and puts the device options before the input', () => {
    const args = proxyArgs('/in/source', '/out.mp4', info(), settings, 1e9);
    const input = args.indexOf('-i');
    expect(args.indexOf('-init_hw_device')).toBeLessThan(input);
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(input);
    expect(args[input + 1]).toBe('/in/source');
    expect(args).toEqual(expect.arrayContaining(['-map', '0:V:0', '-t', '7200']));
    expect(args).toEqual(expect.arrayContaining(['-threads', '2', '-c:a', 'aac']));
    expect(args.join(' ')).toContain('hwmap=derive_device=qsv');
    expect(args.at(-1)).toBe('/out.mp4');
  });

  it('decodes ProRes on the CPU and still encodes on the GPU', () => {
    const args = proxyArgs(
      '/in/source',
      '/out.mp4',
      info({ videoCodec: 'prores', pixelFormat: 'yuv422p10le' }),
      settings,
      1e9,
    );
    expect(args).not.toContain('-hwaccel');
    expect(args).toContain('h264_qsv');
    expect(args.join(' ')).toContain('hwupload');
  });

  it('decodes on the CPU when the retry asks for it', () => {
    const args = proxyArgs('/in/source', '/out.mp4', info(), settings, 1e9, {
      ...qsv,
      cpuDecode: true,
    });
    expect(args).not.toContain('-hwaccel');
    expect(args.join(' ')).toContain('hwupload=extra_hw_frames=64,format=qsv');
  });

  it('turns QuickTime references off for MOV and MP4 only', () => {
    const mov = proxyArgs('/in/source', '/out.mp4', info(), settings, 1e9, qsv, 'video/quicktime');
    expect(mov.slice(0, mov.indexOf('-i'))).toEqual(expect.arrayContaining(['-enable_drefs', '0']));
    // ffmpeg refuses the option for other demuxers.
    const mkv = proxyArgs('/in/source', '/out.mp4', info(), settings, 1e9, qsv, 'video/webm');
    expect(mkv).not.toContain('-enable_drefs');
  });

  it('uses no device for a remux', () => {
    const args = proxyArgs(
      '/in/source',
      '/out.mp4',
      info({ videoCodec: 'h264', pixelFormat: 'yuv420p', width: 1920, height: 1080 }),
      settings,
      5e6,
    );
    expect(args).not.toContain('-init_hw_device');
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'copy']));
  });

  it('takes an explicit encoder over the one of the settings: the software retry', () => {
    const args = proxyArgs('/in/source', '/out.mp4', info(), settings, 1e9, SOFTWARE_ENCODER);
    expect(args).toContain('libx264');
    expect(args).not.toContain('-init_hw_device');
  });
});

describe('detectVideoEncoder', () => {
  it('picks NVENC first with auto, named after the card', async () => {
    const mock = io({ works: ['nvenc', 'qsv', 'vaapi'] });
    const { encoder, rejected } = await detectVideoEncoder('ffmpeg', { mode: 'auto' }, mock);
    expect(encoder).toEqual({
      backend: 'nvenc',
      tuning: 'full',
      codecs: ['h264'],
      label: 'NVENC (NVIDIA GeForce RTX 3060)',
    });
    expect(rejected).toEqual([]);
    // The CPU-decode test, under 4 GiB, then the GPU-decode test on a sample clip.
    expect(vi.mocked(mock.testEncode).mock.calls.map((c) => c[3])).toEqual([false, true]);
    expect(vi.mocked(mock.testEncode).mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(['-hwaccel', 'cuda', '-i', '/tmp/sample.mp4']),
    );
    expect(mock.sampleDone).toHaveBeenCalledTimes(1);
    expect(mock.canOpen).not.toHaveBeenCalled();
  });

  it('keeps a backend whose GPU decode fails, decoding on the CPU for good', async () => {
    const mock = io({ works: ['qsv'], gpuFails: ['qsv'], encoders: async () => ENCODERS });
    const { encoder, rejected } = await detectVideoEncoder('ffmpeg', { mode: 'qsv' }, mock);
    expect(encoder).toEqual({
      backend: 'qsv',
      device: '/dev/dri/renderD128',
      cpuDecode: true,
      tuning: 'full',
      codecs: ['h264'],
      label: 'Intel Quick Sync (Intel, /dev/dri/renderD128, CPU decode)',
    });
    expect(rejected).toEqual([
      { backend: 'qsv', reason: 'GPU decode failed, CPU decode only: Impossible to convert' },
    ]);
    // Then every copy is decoded on the CPU: no failed GPU attempt first.
    const args = proxyArgs(
      '/in/source',
      '/out.mp4',
      {
        durationMs: 1000,
        width: 3840,
        height: 2160,
        videoCodec: 'hevc',
        audioCodec: null,
        frameRate: 25,
        pixelFormat: 'yuv420p',
      },
      { ...DEFAULT_PROXY_SETTINGS, encoder },
      1e9,
    );
    expect(args).not.toContain('-hwaccel');
    expect(args).toContain('h264_qsv');
  });

  it('goes on to QSV when there is no NVIDIA card, and tries low power second', async () => {
    const mock = io({ works: ['qsv-lp'] });
    const { encoder, rejected } = await detectVideoEncoder('ffmpeg', { mode: 'auto' }, mock);
    expect(encoder).toEqual({
      backend: 'qsv',
      device: '/dev/dri/renderD128',
      lowPower: true,
      tuning: 'full',
      codecs: ['h264'],
      label: 'Intel Quick Sync (Intel, /dev/dri/renderD128, low power)',
    });
    expect(rejected.map((r) => r.backend)).toEqual(['nvenc', 'nvenc', 'qsv', 'qsv']);
    expect(mock.canOpen).toHaveBeenCalledWith('/dev/dri/renderD128');
  });

  it('falls to VAAPI on an AMD card', async () => {
    const mock = io({ works: ['vaapi'], vendor: async () => '0x1002' });
    const { encoder } = await detectVideoEncoder(
      'ffmpeg',
      { mode: 'auto', vaapiDevice: '/dev/dri/renderD129' },
      mock,
    );
    expect(encoder).toEqual({
      backend: 'vaapi',
      device: '/dev/dri/renderD129',
      tuning: 'full',
      codecs: ['h264'],
      label: 'VAAPI (AMD, /dev/dri/renderD129)',
    });
  });

  it('falls back to the basic rate control a driver takes, and says so', async () => {
    const mock = io({ works: ['vaapi'], basicOnly: ['vaapi'], vendor: async () => '0x1002' });
    const { encoder, rejected } = await detectVideoEncoder('ffmpeg', { mode: 'vaapi' }, mock);
    expect(encoder.tuning).toBe('basic');
    expect(encoder.label).toBe('VAAPI (AMD, /dev/dri/renderD128, basic rate control)');
    expect(rejected).toEqual([
      { backend: 'vaapi', reason: 'test encode (full) failed: Invalid RC mode' },
    ]);
  });

  it('records AV1 when the card encodes it, without using it', async () => {
    const mock = io({
      works: ['nvenc'],
      encoders: async () => `${ENCODERS} V....D av1_nvenc  NVIDIA NVENC av1 encoder (codec av1)\n`,
    });
    const { encoder } = await detectVideoEncoder('ffmpeg', { mode: 'auto' }, mock);
    expect(encoder.codecs).toEqual(['h264', 'av1']);
    expect(vi.mocked(mock.testEncode).mock.calls[2]?.[1]).toContain('av1_nvenc');
  });

  it('skips backends ffmpeg lacks and devices the worker cannot open', async () => {
    const mock = io({
      works: ['nvenc', 'qsv', 'vaapi'],
      encoders: async () => ' V..... h264_qsv  QSV\n V..... h264_vaapi  VAAPI\n',
      canOpen: async () => false,
    });
    const { encoder, rejected } = await detectVideoEncoder('ffmpeg', { mode: 'auto' }, mock);
    expect(encoder).toBe(SOFTWARE_ENCODER);
    expect(rejected.map((r) => r.reason)).toEqual([
      'ffmpeg has no h264_nvenc',
      '/dev/dri/renderD128 is missing or not readable by the worker',
      '/dev/dri/renderD128 is missing or not readable by the worker',
    ]);
    expect(mock.testEncode).not.toHaveBeenCalled();
  });

  it('only tries the backend named, and runs nothing with none', async () => {
    const vaapi = io({ works: ['nvenc', 'qsv', 'vaapi'] });
    const named = await detectVideoEncoder('ffmpeg', { mode: 'vaapi' }, vaapi);
    expect(named.encoder.backend).toBe('vaapi');
    expect(named.requested).toBe('vaapi');
    expect(vaapi.testEncode).toHaveBeenCalledTimes(2);

    const failing = io({ works: [] });
    const missed = await detectVideoEncoder('ffmpeg', { mode: 'nvenc' }, failing);
    expect(missed.encoder).toBe(SOFTWARE_ENCODER);
    expect(missed.rejected).toEqual([
      { backend: 'nvenc', reason: 'test encode (full) failed: Device creation failed' },
      { backend: 'nvenc', reason: 'test encode (basic) failed: Device creation failed' },
    ]);

    const none = io();
    expect((await detectVideoEncoder('ffmpeg', { mode: 'none' }, none)).encoder).toBe(
      SOFTWARE_ENCODER,
    );
    expect(none.encoders).not.toHaveBeenCalled();
  });

  it('test-encodes one second of generated frames through the real pipeline', () => {
    const args = testEncodeArgs({ backend: 'vaapi', device: '/dev/dri/renderD128', label: '' });
    expect(args).toEqual(
      expect.arrayContaining([
        '-init_hw_device',
        'vaapi=va:/dev/dri/renderD128',
        'lavfi',
        'testsrc2=size=1280x720:rate=25:duration=1',
        'h264_vaapi',
        'null',
      ]),
    );
    expect(args.indexOf('-init_hw_device')).toBeLessThan(args.indexOf('-i'));
    const gpu = testEncodeArgs(
      { backend: 'vaapi', device: '/dev/dri/renderD128', label: '' },
      '/tmp/sample.mp4',
    );
    expect(gpu).toEqual(expect.arrayContaining(['-hwaccel', 'vaapi', '-i', '/tmp/sample.mp4']));
    expect(gpu).not.toContain('lavfi');
  });
});

describe('live benchmark (decision 0128)', () => {
  it('allows one session per 1.5× of measured speed, as the N100 ran', () => {
    // N100: one session at 5.35×; three ran at 1.78× each, four at 1.33×.
    expect(liveSessionsFor(5.35)).toBe(3);
    expect(liveSessionsFor(1.49)).toBe(0);
    expect(liveSessionsFor(1.5)).toBe(1);
    expect(liveSessionsFor(40)).toBe(8);
  });

  it('reads the last speed of ffmpeg statistics', () => {
    expect(parseSpeed('frame= 10 speed=2.1x\rframe= 125 fps=130 speed=5.35x\n')).toBe(5.35);
    expect(parseSpeed('speed=N/A')).toBeNull();
  });

  const bench = (stderr: string | null) => {
    const mock = io({ works: ['qsv'] });
    const calls: Array<{ args: string[]; timeout: number }> = [];
    return {
      mock: {
        ...mock,
        bench: async (_f: string, args: string[], _e: VideoEncoder, timeout: number) => {
          calls.push({ args, timeout });
          return stderr;
        },
      },
      calls,
    };
  };
  const qsv: VideoEncoder = { backend: 'qsv', device: '/dev/dri/renderD128', label: '' };

  it('measures five seconds of 1080p decoded and encoded on the GPU', async () => {
    const { mock, calls } = bench('frame=125 speed=5.35x');
    expect(await measureLive('ffmpeg', qsv, mock)).toEqual({
      sessions: 3,
      speed: 5.35,
      error: null,
    });
    expect(mock.sample).toHaveBeenCalledWith('ffmpeg', { width: 1920, height: 1080, seconds: 5 });
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['-hwaccel', 'vaapi', 'h264_qsv']));
    expect(calls[0]?.timeout).toBe(60_000);
    expect(mock.sampleDone).toHaveBeenCalled();
  });

  it('turns live playback off when the benchmark fails, times out or is too slow', async () => {
    expect(await measureLive('ffmpeg', qsv, bench(null).mock)).toMatchObject({
      sessions: 0,
      error: 'benchmark failed or timed out',
    });
    expect(await measureLive('ffmpeg', qsv, bench('speed=1.2x').mock)).toEqual({
      sessions: 0,
      speed: 1.2,
      error: 'GPU too slow for real time',
    });
    // libx264, or a card that cannot decode: never measured, never live.
    const none = bench('speed=9x');
    expect((await measureLive('ffmpeg', SOFTWARE_ENCODER, none.mock)).sessions).toBe(0);
    expect((await measureLive('ffmpeg', { ...qsv, cpuDecode: true }, none.mock)).sessions).toBe(0);
    expect(none.calls).toEqual([]);
  });
});
