import { describe, expect, it, vi } from 'vitest';
import {
  type DetectIo,
  detectVideoEncoder,
  encoderMemory,
  gpuDecodes,
  SOFTWARE_ENCODER,
  testEncodeArgs,
  type VideoEncoder,
  videoPipeline,
} from './hwaccel.ts';
import { DEFAULT_PROXY_SETTINGS, proxyArgs, type VideoInfo } from './video.ts';

const ENCODERS = `Encoders:
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)
 V....D h264_vaapi           H.264/AVC (VAAPI) (codec h264)
`;

/** Detection with every probe mocked: `works` lists the backends whose test encode passes. */
function io(over: Partial<DetectIo> & { works?: string[] } = {}) {
  const works = over.works ?? [];
  const mock = {
    encoders: vi.fn(async () => ENCODERS),
    testEncode: vi.fn(async (_ffmpeg: string, _args: string[], e: VideoEncoder) =>
      works.includes(e.lowPower ? `${e.backend}-lp` : e.backend) ? null : 'Device creation failed',
    ),
    canOpen: vi.fn(async () => true),
    nvidiaName: vi.fn(async () => 'NVIDIA GeForce RTX 3060'),
    vendor: vi.fn(async () => '0x8086'),
    ...over,
  };
  return mock;
}

const opts = { resolution: 1080, bitrate: '5M' };

describe('videoPipeline', () => {
  it('keeps the libx264 arguments of #354 for software', () => {
    const p = videoPipeline(SOFTWARE_ENCODER, { ...opts, gpu: true });
    expect(p.input).toEqual([]);
    expect(p.filter).toMatch(/^scale='if\(gte\(iw,ih\),-2,min\(1080/);
    expect(p.codec).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-maxrate',
      '5M',
      '-bufsize',
      '10M',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
    ]);
  });

  it('decodes and scales on the card with NVENC, or only encodes there', () => {
    const nvenc: VideoEncoder = { backend: 'nvenc', label: 'NVENC' };
    const gpu = videoPipeline(nvenc, { ...opts, gpu: true });
    expect(gpu.input).toEqual(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']);
    expect(gpu.filter).toMatch(/^scale_cuda=w='if.*':h='if.*':format=yuv420p$/);
    expect(gpu.codec).toEqual(
      expect.arrayContaining(['h264_nvenc', '-maxrate', '5M', '-bufsize', '10M', 'high']),
    );
    const cpu = videoPipeline(nvenc, { ...opts, gpu: false });
    expect(cpu.input).toEqual([]);
    expect(cpu.filter).toMatch(/^scale=.*,format=yuv420p$/);
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
    expect(cpu.codec).toEqual(
      expect.arrayContaining(['h264_vaapi', '-low_power', '1', '-b:v', '2.5M', '-maxrate', '5M']),
    );
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
  });

  it('leaves ProRes, 4:2:2 and 10-bit H.264 to the CPU decoder', () => {
    expect(gpuDecodes('h264', 'yuv420p')).toBe(true);
    expect(gpuDecodes('hevc', 'yuv420p10le')).toBe(true);
    expect(gpuDecodes('h264', 'yuv420p10le')).toBe(false);
    expect(gpuDecodes('hevc', 'yuv422p10le')).toBe(false);
    expect(gpuDecodes('prores', 'yuv422p10le')).toBe(false);
    expect(gpuDecodes(null, null)).toBe(false);
  });

  it('caps the address space of every encoder but NVENC', () => {
    expect(encoderMemory(SOFTWARE_ENCODER)).toBe(4 * 1024 ** 3);
    expect(encoderMemory({ backend: 'qsv', label: '' })).toBe(8 * 1024 ** 3);
    expect(encoderMemory({ backend: 'nvenc', label: '' })).toBeUndefined();
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
    expect(args).toEqual(expect.arrayContaining(['-map', '0:V:0', '-t', '7200', '-fs']));
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

  it('uses no device for a remux', () => {
    const args = proxyArgs(
      '/in/source',
      '/out.mp4',
      info({ videoCodec: 'h264', pixelFormat: 'yuv420p', width: 1920, height: 1080 }),
      settings,
      1e9,
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
    expect(encoder).toEqual({ backend: 'nvenc', label: 'NVENC (NVIDIA GeForce RTX 3060)' });
    expect(rejected).toEqual([]);
    expect(mock.testEncode).toHaveBeenCalledTimes(1);
    expect(mock.canOpen).not.toHaveBeenCalled();
  });

  it('goes on to QSV when there is no NVIDIA card, and tries low power second', async () => {
    const mock = io({ works: ['qsv-lp'] });
    const { encoder, rejected } = await detectVideoEncoder('ffmpeg', { mode: 'auto' }, mock);
    expect(encoder).toEqual({
      backend: 'qsv',
      device: '/dev/dri/renderD128',
      lowPower: true,
      label: 'Intel Quick Sync (Intel, /dev/dri/renderD128, low power)',
    });
    expect(rejected.map((r) => r.backend)).toEqual(['nvenc', 'qsv']);
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
      label: 'VAAPI (AMD, /dev/dri/renderD129)',
    });
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
    expect(vaapi.testEncode).toHaveBeenCalledTimes(1);

    const failing = io({ works: [] });
    const missed = await detectVideoEncoder('ffmpeg', { mode: 'nvenc' }, failing);
    expect(missed.encoder).toBe(SOFTWARE_ENCODER);
    expect(missed.rejected).toEqual([
      { backend: 'nvenc', reason: 'test encode failed: Device creation failed' },
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
  });
});
