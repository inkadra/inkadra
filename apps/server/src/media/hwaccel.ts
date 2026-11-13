import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { QUALITY_VALUES, type RungRate, rungRate, type VideoQuality } from './quality.ts';
import { ffmpegError, limitedCommand, toolEnv } from './tools.ts';

const exec = promisify(execFile);

/**
 * Hardware encoders of playable copies (#358). NVENC runs on NVIDIA cards through the host
 * driver the NVIDIA Container Toolkit mounts; QSV and VAAPI on Intel iGPUs (and Arc) and, for
 * VAAPI, AMD GPUs, through a `/dev/dri/renderD*` device.
 */
export type HwBackend = 'nvenc' | 'qsv' | 'vaapi';
export type HwAccelMode = 'auto' | HwBackend | 'none';
export const HWACCEL_MODES = ['auto', 'nvenc', 'qsv', 'vaapi', 'none'] as const;

/** How playable copies are encoded, chosen once when the worker starts. */
export interface VideoEncoder {
  backend: HwBackend | 'software';
  /** Render node of QSV and VAAPI. */
  device?: string;
  /** The low-power (VDEnc) entry point: the only one of Intel's free media driver. */
  lowPower?: boolean;
  /** Decode and scale on the CPU even when the GPU could: the retry of a failed GPU decode. */
  cpuDecode?: boolean;
  /**
   * Rate control the card took at detection: `full` (quality under a cap, lookahead) or
   * `basic` (VBR at the target), for older GPUs and drivers. Unset on libx264.
   */
  tuning?: EncoderTuning;
  /** Codecs the card encodes besides H.264 (`av1`): shown, not used (decision 0128). */
  codecs?: string[];
  /** Shown in the logs and in Diagnostics: `NVENC (NVIDIA GeForce RTX 3060)`, `Software`. */
  label: string;
}

export type EncoderTuning = 'full' | 'basic';

export const SOFTWARE_ENCODER: VideoEncoder = { backend: 'software', label: 'Software (libx264)' };

const ENCODER_NAME = { nvenc: 'h264_nvenc', qsv: 'h264_qsv', vaapi: 'h264_vaapi' } as const;
const AV1_NAME = { nvenc: 'av1_nvenc', qsv: 'av1_qsv', vaapi: 'av1_vaapi' } as const;

/** Address space of one ffmpeg run (as in video.ts). */
export const FFMPEG_MEMORY = 4 * 1024 ** 3;

/** Cap of an NVENC run whose frames the GPU decodes: CUDA reserves tens of GB of address space. */
export const NVENC_GPU_MEMORY = 64 * 1024 ** 3;

/**
 * Address-space cap of an encode with `encoder`. Whenever the CPU decodes the untrusted source
 * (software, ProRes and 4:2:2, the CPU-decode retry, `cpuDecode`), the software cap of 4 GiB
 * holds, whatever encodes. When the GPU decodes, the process maps GPU memory: 8 GiB for VAAPI
 * and Quick Sync, 64 GiB for NVENC, which CUDA cannot start under less.
 */
export function encoderMemory(encoder: VideoEncoder, gpuDecode: boolean) {
  if (encoder.backend === 'software' || !gpuDecode || encoder.cpuDecode) return FFMPEG_MEMORY;
  return encoder.backend === 'nvenc' ? NVENC_GPU_MEMORY : 2 * FFMPEG_MEMORY;
}

/** Input of a pipeline: what ffmpeg is told before `-i`, the filter graph, the encoder. */
export interface VideoPipeline {
  input: string[];
  filter: string;
  codec: string[];
}

/** Codecs and pixel formats the GPU decoders of all three backends take in practice. */
const GPU_CODECS = new Set(['h264', 'hevc', 'vp9', 'av1', 'mpeg2video', 'vc1', 'vp8']);
const GPU_8BIT = new Set(['yuv420p', 'yuvj420p', 'nv12']);
const GPU_10BIT = new Set(['yuv420p10le', 'p010le']);
const GPU_10BIT_CODECS = new Set(['hevc', 'vp9', 'av1']);

/**
 * Whether the GPU should decode and scale too. ProRes, DNxHD, 4:2:2 and 4:4:4 sources (which
 * no consumer GPU decodes) are decoded and scaled on the CPU and only encoded on the GPU.
 */
export function gpuDecodes(codec: string | null, pixelFormat: string | null) {
  if (!codec || !pixelFormat || !GPU_CODECS.has(codec)) return false;
  return GPU_8BIT.has(pixelFormat) || (GPU_10BIT.has(pixelFormat) && GPU_10BIT_CODECS.has(codec));
}

/**
 * The scale of a playable copy: the shorter side at most `resolution` (1080 makes 1920×1080
 * or 1080×1920), never upscaled, even.
 */
export function scaleSize(resolution: number) {
  const r = resolution;
  return {
    w: `'if(gte(iw,ih),-2,min(${r},trunc(iw/2)*2))'`,
    h: `'if(gte(iw,ih),min(${r},trunc(ih/2)*2),-2)'`,
  };
}

/** What a copy aims for: its size, rate and quality preset, and the source frame rate. */
export interface PipelineOptions {
  resolution: number;
  rate: RungRate;
  quality: VideoQuality;
  fps: number | null;
  /** Decode and scale on the card as well (see gpuDecodes). */
  gpu: boolean;
  /** CPU filters before the scale, on the CPU path (deinterlacing). */
  pre?: string;
  /**
   * CPU filters after the scale, ending in 8-bit 4:2:0 (tone mapping, dithering). On the GPU
   * path the card scales at 10 bit and the smaller frames come down for them.
   */
  post?: string;
  /** HDR source: `post` tone maps it, from the source's own matrix. */
  hdr?: boolean;
  /** Seconds the encode starts at, keeping source timestamps (live playback). */
  from?: number;
  /** The quality value the admin set (CRF, CQ or global_quality) over the preset's. */
  qualityValue?: number;
}

/**
 * Keyframes every two seconds, by time (variable frame rates included), so every copy and
 * every rung can be cut and switched at the same instants; `-g` (ten seconds) is only a net.
 */
export function keyframeArgs(fps: number | null, from = 0) {
  return [
    '-force_key_frames',
    // From a seek, timestamps are the source's (-copyts): the grid stays on even seconds.
    from > 0 ? `expr:gte(t,${from}+n_forced*2)` : 'expr:gte(t,n_forced*2)',
    '-g',
    String(Math.max(1, Math.round((fps ?? 25) * 10))),
  ];
}

/**
 * Colour tags of every copy: SDR BT.709, limited range (HDR is tone mapped first). Written in
 * the bitstream: ffmpeg 9 turns `-colorspace` and its siblings into a conversion of the frames,
 * which it cannot do on frames kept on the GPU (spike of decision 0128).
 */
export const BT709_TAGS = [
  '-bsf:v',
  'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
];

/**
 * ffmpeg arguments of the video of a playable copy with `encoder` (decision 0128): constant
 * quality under a peak (CRF on libx264, CQ on NVENC, QVBR on Quick Sync and VAAPI, or plain
 * VBR at the target on the `basic` tuning older hardware is left with). `gpu` decodes and
 * scales on the card as well; otherwise frames are scaled on the CPU and uploaded.
 */
export function videoPipeline(encoder: VideoEncoder, opts: PipelineOptions): VideoPipeline {
  const { w, h } = scaleSize(opts.resolution);
  const post = opts.post ? `,${opts.post}` : '';
  // swscale converts the matrix and range to what the tags say (not for HDR: tone mapping
  // reads the source's own matrix); the GPU scalers keep them.
  const matrix = opts.hdr ? '' : ':out_color_matrix=bt709:out_range=tv';
  const cpuScale = `${opts.pre ? `${opts.pre},` : ''}scale=${w}:${h}:flags=lanczos${matrix},setsar=1${post}`;
  // 10-bit frames scaled on the card, brought down for the CPU filters.
  const down = (format: string) => `:format=${format},hwdownload,format=p010le${post}`;
  const { target, peak, buffer } = opts.rate;
  const preset = QUALITY_VALUES[opts.quality];
  const own = opts.qualityValue;
  const q = own === undefined ? preset : { ...preset, crf: own, cq: own, globalQuality: own };
  const cap = ['-maxrate', String(peak), '-bufsize', String(buffer)];
  const lowPower = encoder.lowPower ? ['-low_power', '1'] : [];
  const full = encoder.tuning !== 'basic';
  const device = encoder.device ?? DEFAULT_VAAPI_DEVICE;
  const common = [...keyframeArgs(opts.fps, opts.from), '-profile:v', 'high', ...BT709_TAGS];
  switch (encoder.backend) {
    case 'nvenc':
      return {
        input: opts.gpu ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'] : [],
        filter: opts.gpu
          ? `scale_cuda=w=${w}:h=${h}${opts.post ? `${down('p010le')},format=yuv420p` : ':format=yuv420p'}`
          : `${cpuScale},format=yuv420p`,
        codec: [
          '-c:v',
          'h264_nvenc',
          '-preset',
          'p5',
          ...(full ? ['-tune', 'hq'] : []),
          '-rc',
          'vbr',
          '-cq',
          String(q.cq),
          '-b:v',
          '0',
          ...cap,
          '-spatial-aq',
          '1',
          ...(full ? ['-rc-lookahead', '20', '-bf', '3', '-b_ref_mode', 'middle'] : []),
          '-forced-idr',
          '1',
          '-no-scenecut',
          '1',
          ...common,
        ],
      };
    case 'vaapi':
      return {
        input: opts.gpu
          ? ['-hwaccel', 'vaapi', '-hwaccel_device', device, '-hwaccel_output_format', 'vaapi']
          : ['-init_hw_device', `vaapi=va:${device}`, '-filter_hw_device', 'va'],
        filter: opts.gpu
          ? `scale_vaapi=w=${w}:h=${h}${opts.post ? `${down('p010')},format=nv12,hwupload` : ':format=nv12'}`
          : `${cpuScale},format=nv12,hwupload`,
        codec: [
          '-c:v',
          'h264_vaapi',
          ...lowPower,
          // VAAPI takes a quality and a cap together only as QVBR, which not every driver has.
          ...(full
            ? ['-rc_mode', 'QVBR', '-global_quality', String(q.globalQuality)]
            : ['-rc_mode', 'VBR']),
          '-b:v',
          String(target),
          ...cap,
          ...common,
        ],
      };
    case 'qsv':
      // Decoded by VAAPI and mapped to QSV: the generic decoders take any codec, the `_qsv`
      // ones would have to be named per codec.
      return {
        input: [
          '-init_hw_device',
          `vaapi=va:${device}`,
          '-init_hw_device',
          'qsv=qs@va',
          '-filter_hw_device',
          'qs',
          ...(opts.gpu
            ? ['-hwaccel', 'vaapi', '-hwaccel_device', 'va', '-hwaccel_output_format', 'vaapi']
            : []),
        ],
        filter: opts.gpu
          ? opts.post
            ? `scale_vaapi=w=${w}:h=${h}${down('p010')},format=nv12,hwupload=extra_hw_frames=64,format=qsv`
            : `scale_vaapi=w=${w}:h=${h}:format=nv12,hwmap=derive_device=qsv,format=qsv`
          : `${cpuScale},format=nv12,hwupload=extra_hw_frames=64,format=qsv`,
        codec: [
          '-c:v',
          'h264_qsv',
          ...lowPower,
          '-preset',
          'medium',
          // A quality with -b:v and -maxrate makes ffmpeg pick QVBR; without it, VBR.
          ...(full
            ? [
                '-global_quality',
                String(q.globalQuality),
                '-extbrc',
                '1',
                '-look_ahead_depth',
                '30',
              ]
            : []),
          '-b:v',
          String(target),
          ...cap,
          '-forced_idr',
          '1',
          ...common,
        ],
      };
    default:
      return {
        input: [],
        filter: cpuScale,
        codec: [
          '-c:v',
          'libx264',
          '-preset',
          q.x264Preset,
          '-crf',
          String(q.crf),
          ...cap,
          '-aq-mode',
          '3',
          '-sc_threshold',
          '0',
          '-pix_fmt',
          'yuv420p',
          ...common,
        ],
      };
  }
}

// Detection -------------------------------------------------------------------------------

export const DEFAULT_VAAPI_DEVICE = '/dev/dri/renderD128';

/** What detection runs; replaced in tests. */
export interface DetectIo {
  /** stdout of `ffmpeg -hide_banner -encoders`, or '' when it fails. */
  encoders(ffmpeg: string): Promise<string>;
  /**
   * Runs one test encode, under the cap of `encoder` decoding on the GPU or not; resolves
   * with null when it worked, else the error text.
   */
  testEncode(
    ffmpeg: string,
    args: string[],
    encoder: VideoEncoder,
    gpuDecode: boolean,
  ): Promise<string | null>;
  /**
   * An H.264 clip of the generated test pattern made with libx264, for the test of the GPU
   * decode (one second, 1280×720 by default) and the live benchmark; null if not.
   */
  sample(
    ffmpeg: string,
    size?: { width: number; height: number; seconds: number },
  ): Promise<{ path: string; done: () => Promise<void> } | null>;
  /**
   * Runs the live benchmark (`args`, at a lower priority, killed past `timeoutMs`); resolves
   * with ffmpeg's stderr when it worked, else null.
   */
  bench(
    ffmpeg: string,
    args: string[],
    encoder: VideoEncoder,
    timeoutMs: number,
  ): Promise<string | null>;
  /** Whether the worker may open `path` for reading and writing. */
  canOpen(path: string): Promise<boolean>;
  /** Name of the first NVIDIA GPU (`nvidia-smi`), or null. */
  nvidiaName(): Promise<string | null>;
  /** PCI vendor of a render node (`0x8086`), or null. */
  vendor(device: string): Promise<string | null>;
}

const TEST_TIMEOUT_MS = 20_000;

export const defaultDetectIo: DetectIo = {
  async encoders(ffmpeg) {
    try {
      const { stdout } = await exec(ffmpeg, ['-hide_banner', '-encoders'], {
        timeout: 10_000,
        env: toolEnv(),
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    } catch {
      return '';
    }
  },
  async testEncode(ffmpeg, args, encoder, gpuDecode) {
    const [file, argv] = await limitedCommand(ffmpeg, args, {
      memoryBytes: encoderMemory(encoder, gpuDecode),
    });
    try {
      await exec(file, argv, {
        timeout: TEST_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: toolEnv(),
        maxBuffer: 1024 * 1024,
      });
      return null;
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return ffmpegError(e.stderr || e.message || 'failed', 300);
    }
  },
  async bench(ffmpeg, args, encoder, timeoutMs) {
    const [file, argv] = await limitedCommand(ffmpeg, args, {
      memoryBytes: encoderMemory(encoder, true),
      nice: true,
    });
    try {
      const { stderr } = await exec(file, argv, {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        env: toolEnv(),
        maxBuffer: 4 * 1024 * 1024,
      });
      return String(stderr);
    } catch {
      return null;
    }
  },
  async sample(ffmpeg, size = { width: 1280, height: 720, seconds: 1 }) {
    const dir = await mkdtemp(join(tmpdir(), 'inkadra-hwaccel-'));
    const path = join(dir, 'sample.mp4');
    const done = () => rm(dir, { recursive: true, force: true });
    try {
      await exec(
        ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `testsrc2=size=${size.width}x${size.height}:rate=25:duration=${size.seconds}`,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          path,
        ],
        { timeout: TEST_TIMEOUT_MS, killSignal: 'SIGKILL', env: toolEnv() },
      );
      return { path, done };
    } catch {
      await done();
      return null;
    }
  },
  async canOpen(path) {
    try {
      await access(path, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
  async nvidiaName() {
    try {
      const { stdout } = await exec('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
        timeout: 5000,
        env: toolEnv(),
      });
      const name = stdout.split('\n')[0]?.trim();
      return name && /^[\w .()-]{1,80}$/.test(name) ? name : null;
    } catch {
      return null;
    }
  },
  async vendor(device) {
    try {
      const text = await readFile(`/sys/class/drm/${basename(device)}/device/vendor`, 'utf8');
      return text.trim().toLowerCase();
    } catch {
      return null;
    }
  },
};

/**
 * Arguments of the one-second test encode of `encoder`, thrown away. Without `sample`:
 * generated frames, scaled on the CPU and uploaded, as for a ProRes file. With `sample` (an
 * H.264 clip): decoded and scaled on the GPU, as for most camera and phone files.
 */
export function testEncodeArgs(encoder: VideoEncoder, sample?: string) {
  const gpu = sample !== undefined;
  const pipeline = videoPipeline(encoder, {
    resolution: 360,
    rate: rungRate('balanced', 360, 25),
    quality: 'balanced',
    fps: 25,
    gpu,
  });
  return [
    '-nostdin',
    '-hide_banner',
    '-v',
    'error',
    ...pipeline.input,
    ...(gpu ? ['-i', sample] : ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=1']),
    '-vf',
    pipeline.filter,
    ...pipeline.codec,
    '-an',
    '-f',
    'null',
    '-',
  ];
}

/** One second of AV1 from the card, thrown away: detection only, never used for copies. */
export function av1TestArgs(encoder: VideoEncoder) {
  if (encoder.backend === 'software') return [];
  const device = encoder.device ?? DEFAULT_VAAPI_DEVICE;
  const upload =
    encoder.backend === 'nvenc'
      ? { input: [], filter: 'format=yuv420p' }
      : encoder.backend === 'qsv'
        ? {
            input: [
              '-init_hw_device',
              `vaapi=va:${device}`,
              '-init_hw_device',
              'qsv=qs@va',
              '-filter_hw_device',
              'qs',
            ],
            filter: 'format=nv12,hwupload=extra_hw_frames=64,format=qsv',
          }
        : {
            input: ['-init_hw_device', `vaapi=va:${device}`, '-filter_hw_device', 'va'],
            filter: 'format=nv12,hwupload',
          };
  return [
    '-nostdin',
    '-hide_banner',
    '-v',
    'error',
    ...upload.input,
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=25:duration=1',
    '-vf',
    upload.filter,
    '-c:v',
    AV1_NAME[encoder.backend],
    ...(encoder.lowPower ? ['-low_power', '1'] : []),
    '-an',
    '-f',
    'null',
    '-',
  ];
}

// Live benchmark (decision 0128) ----------------------------------------------------------

/** Speed a live session needs, × real time: half again over 1×, for seeks and other work. */
export const LIVE_MARGIN = 1.5;
export const LIVE_MAX_SESSIONS = 8;
const BENCH_TIMEOUT_MS = 60_000;

/**
 * Live sessions at once a speed allows: one per 1.5× of the speed of one encode. On the N100 of
 * the spike, one 1080p session ran at 5.35×: three sessions (measured 1.78× each), not four
 * (1.33×, too close to real time).
 */
export const liveSessionsFor = (speed: number) =>
  Math.max(0, Math.min(LIVE_MAX_SESSIONS, Math.floor(speed / LIVE_MARGIN)));

/** The last `speed=…x` of ffmpeg's statistics, or null. */
export function parseSpeed(stderr: string) {
  const all = [...stderr.matchAll(/speed=\s*([\d.]+)x/g)];
  const value = Number(all.at(-1)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export type LiveMeasure =
  | { sessions: number; speed: number; error: null }
  | { sessions: 0; speed: number | null; error: string };

/**
 * Measures live playback on `encoder` once, when the worker starts: five seconds of 1080p H.264
 * of the generated test pattern (no one's files), decoded, scaled and encoded on the GPU with
 * the live settings (balanced 1080p, two-second keyframes), at a lower priority, killed after a
 * minute. Never on libx264. A failure turns live playback off, with the reason.
 */
export async function measureLive(
  ffmpeg: string,
  encoder: VideoEncoder,
  io: DetectIo = defaultDetectIo,
): Promise<LiveMeasure> {
  if (encoder.backend === 'software' || encoder.cpuDecode)
    return { sessions: 0, speed: null, error: 'needs GPU decoding and encoding' };
  const sample = await io.sample(ffmpeg, { width: 1920, height: 1080, seconds: 5 });
  if (!sample) return { sessions: 0, speed: null, error: 'no sample clip' };
  try {
    const pipeline = videoPipeline(encoder, {
      resolution: 1080,
      rate: rungRate('balanced', 1080, 25),
      quality: 'balanced',
      fps: 25,
      gpu: true,
    });
    const args = [
      '-nostdin',
      '-hide_banner',
      '-stats',
      ...pipeline.input,
      '-i',
      sample.path,
      '-vf',
      pipeline.filter,
      ...pipeline.codec,
      '-an',
      '-f',
      'null',
      '-',
    ];
    const stderr = await io.bench(ffmpeg, args, encoder, BENCH_TIMEOUT_MS);
    if (stderr === null)
      return { sessions: 0, speed: null, error: 'benchmark failed or timed out' };
    const speed = parseSpeed(stderr);
    if (speed === null) return { sessions: 0, speed: null, error: 'no speed in the benchmark' };
    const sessions = liveSessionsFor(speed);
    return sessions > 0
      ? { sessions, speed, error: null }
      : { sessions: 0, speed, error: 'GPU too slow for real time' };
  } finally {
    await sample.done();
  }
}

const VENDORS: Record<string, string> = { '0x8086': 'Intel', '0x1002': 'AMD', '0x10de': 'NVIDIA' };

async function label(encoder: VideoEncoder, io: DetectIo) {
  if (encoder.backend === 'nvenc') {
    const name = await io.nvidiaName();
    const details = [
      name,
      encoder.cpuDecode ? 'CPU decode' : null,
      encoder.tuning === 'basic' ? 'basic rate control' : null,
    ].filter(Boolean);
    return details.length ? `NVENC (${details.join(', ')})` : 'NVENC';
  }
  const device = encoder.device ?? DEFAULT_VAAPI_DEVICE;
  const vendor = VENDORS[(await io.vendor(device)) ?? ''];
  const details = [
    vendor,
    device,
    encoder.lowPower ? 'low power' : null,
    encoder.cpuDecode ? 'CPU decode' : null,
    encoder.tuning === 'basic' ? 'basic rate control' : null,
  ].filter(Boolean);
  return `${encoder.backend === 'qsv' ? 'Intel Quick Sync' : 'VAAPI'} (${details.join(', ')})`;
}

export interface Detection {
  encoder: VideoEncoder;
  /** VIDEO_PROXY_HWACCEL as set. */
  requested: HwAccelMode;
  /** Why each candidate was passed over, for the log. */
  rejected: Array<{ backend: HwBackend; reason: string }>;
}

/**
 * Picks the encoder of playable copies: with `auto`, the first of NVENC, QSV and VAAPI that
 * ffmpeg has, whose device the worker can open and that passes a one-second test encode;
 * with a backend named, only that one; with `none`, or when none works, libx264. The chosen
 * one is then tested decoding an H.264 clip on the GPU: if that fails, it keeps `cpuDecode`
 * for the life of the process, so no file pays a failed GPU decode first. Never throws.
 */
export async function detectVideoEncoder(
  ffmpeg: string,
  opts: { mode: HwAccelMode; vaapiDevice?: string },
  io: DetectIo = defaultDetectIo,
): Promise<Detection> {
  const requested = opts.mode;
  const device = opts.vaapiDevice || DEFAULT_VAAPI_DEVICE;
  const rejected: Detection['rejected'] = [];
  if (requested === 'none') return { encoder: SOFTWARE_ENCODER, requested, rejected };
  const backends: HwBackend[] = requested === 'auto' ? ['nvenc', 'qsv', 'vaapi'] : [requested];
  const list = await io.encoders(ffmpeg);
  for (const backend of backends) {
    if (!new RegExp(`\\s${ENCODER_NAME[backend]}\\s`).test(list)) {
      rejected.push({ backend, reason: `ffmpeg has no ${ENCODER_NAME[backend]}` });
      continue;
    }
    if (backend !== 'nvenc' && !(await io.canOpen(device))) {
      rejected.push({ backend, reason: `${device} is missing or not readable by the worker` });
      continue;
    }
    // Intel's free media driver only has the low-power entry point: tried second. Each entry
    // point tries the full rate control first, then the basic one older drivers keep.
    const variants = backend === 'nvenc' ? [false] : [false, true];
    for (const lowPower of variants) {
      for (const tuning of ['full', 'basic'] as const) {
        const candidate: VideoEncoder = {
          backend,
          label: '',
          tuning,
          ...(backend === 'nvenc' ? {} : { device }),
          ...(lowPower ? { lowPower } : {}),
        };
        const error = await io.testEncode(ffmpeg, testEncodeArgs(candidate), candidate, false);
        if (error !== null) {
          rejected.push({
            backend,
            reason: `test encode (${[tuning, lowPower ? 'low power' : null].filter(Boolean).join(', ')}) failed: ${error}`,
          });
          continue;
        }
        const sample = await io.sample(ffmpeg);
        try {
          const gpuError = sample
            ? await io.testEncode(ffmpeg, testEncodeArgs(candidate, sample.path), candidate, true)
            : 'no sample clip';
          if (gpuError !== null) {
            candidate.cpuDecode = true;
            rejected.push({ backend, reason: `GPU decode failed, CPU decode only: ${gpuError}` });
          }
        } finally {
          await sample?.done();
        }
        if (new RegExp(`\\s${AV1_NAME[backend]}\\s`).test(list)) {
          const av1 = await io.testEncode(ffmpeg, av1TestArgs(candidate), candidate, false);
          candidate.codecs = av1 === null ? ['h264', 'av1'] : ['h264'];
        } else candidate.codecs = ['h264'];
        candidate.label = await label(candidate, io);
        return { encoder: candidate, requested, rejected };
      }
    }
  }
  return { encoder: SOFTWARE_ENCODER, requested, rejected };
}
