import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { limitedCommand, toolEnv } from './tools.ts';

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
  /** Shown in the logs and in Diagnostics: `NVENC (NVIDIA GeForce RTX 3060)`, `Software`. */
  label: string;
}

export const SOFTWARE_ENCODER: VideoEncoder = { backend: 'software', label: 'Software (libx264)' };

const ENCODER_NAME = { nvenc: 'h264_nvenc', qsv: 'h264_qsv', vaapi: 'h264_vaapi' } as const;

/** Address space of one ffmpeg run (as in video.ts). */
export const FFMPEG_MEMORY = 4 * 1024 ** 3;

/**
 * Address-space cap of an encode with `encoder`. CUDA reserves tens of GB of virtual memory
 * at start, so NVENC runs without one; its frames are on the card. VAAPI and Quick Sync map
 * their surfaces into the process, so they get twice the software cap.
 */
export const encoderMemory = (encoder: VideoEncoder) =>
  encoder.backend === 'nvenc'
    ? undefined
    : encoder.backend === 'software'
      ? FFMPEG_MEMORY
      : 2 * FFMPEG_MEMORY;

/** Input of a pipeline: what ffmpeg is told before `-i`, the filter graph, the encoder. */
export interface VideoPipeline {
  input: string[];
  filter: string;
  codec: string[];
}

/** `5M` → `2.5M`: the average rate asked of hardware encoders, under the peak. */
const halved = (bitrate: string) => {
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(bitrate);
  return m ? `${Number(m[1]) / 2}${m[2]}` : bitrate;
};

/** `5M` → `10M`: the rate-control buffer is two seconds at the peak rate. */
export const doubled = (bitrate: string) => {
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(bitrate);
  return m ? `${Number(m[1]) * 2}${m[2]}` : bitrate;
};

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

/**
 * ffmpeg arguments of the video of a playable copy with `encoder`. `gpu` decodes and scales
 * on the card as well (see gpuDecodes); otherwise frames are scaled on the CPU and uploaded.
 * The rate is the same everywhere: `bitrate` at peak, a two-second buffer.
 */
export function videoPipeline(
  encoder: VideoEncoder,
  opts: { resolution: number; bitrate: string; gpu: boolean },
): VideoPipeline {
  const { w, h } = scaleSize(opts.resolution);
  const cpuScale = `scale=${w}:${h}`;
  const peak = ['-maxrate', opts.bitrate, '-bufsize', doubled(opts.bitrate)];
  const lowPower = encoder.lowPower ? ['-low_power', '1'] : [];
  const device = encoder.device ?? DEFAULT_VAAPI_DEVICE;
  switch (encoder.backend) {
    case 'nvenc':
      return {
        input: opts.gpu ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'] : [],
        filter: opts.gpu ? `scale_cuda=w=${w}:h=${h}:format=yuv420p` : `${cpuScale},format=yuv420p`,
        codec: [
          '-c:v',
          'h264_nvenc',
          '-preset',
          'p4',
          '-rc',
          'vbr',
          '-cq',
          '23',
          '-b:v',
          '0',
          ...peak,
          '-profile:v',
          'high',
        ],
      };
    case 'vaapi':
      return {
        input: opts.gpu
          ? ['-hwaccel', 'vaapi', '-hwaccel_device', device, '-hwaccel_output_format', 'vaapi']
          : ['-init_hw_device', `vaapi=va:${device}`, '-filter_hw_device', 'va'],
        filter: opts.gpu
          ? `scale_vaapi=w=${w}:h=${h}:format=nv12`
          : `${cpuScale},format=nv12,hwupload`,
        codec: [
          '-c:v',
          'h264_vaapi',
          ...lowPower,
          '-rc_mode',
          'VBR',
          '-b:v',
          halved(opts.bitrate),
          ...peak,
          '-profile:v',
          'high',
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
          ? `scale_vaapi=w=${w}:h=${h}:format=nv12,hwmap=derive_device=qsv,format=qsv`
          : `${cpuScale},format=nv12,hwupload=extra_hw_frames=64,format=qsv`,
        codec: [
          '-c:v',
          'h264_qsv',
          ...lowPower,
          '-preset',
          'veryfast',
          '-b:v',
          halved(opts.bitrate),
          ...peak,
          '-profile:v',
          'high',
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
          'veryfast',
          '-crf',
          '23',
          ...peak,
          '-pix_fmt',
          'yuv420p',
          '-profile:v',
          'high',
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
  /** Runs one test encode; resolves with null when it worked, else the error text. */
  testEncode(ffmpeg: string, args: string[], encoder: VideoEncoder): Promise<string | null>;
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
  async testEncode(ffmpeg, args, encoder) {
    const [file, argv] = await limitedCommand(ffmpeg, args, {
      memoryBytes: encoderMemory(encoder),
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
      return (e.stderr || e.message || 'failed').trim().slice(0, 300);
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
 * Arguments of the one-second test encode of `encoder`: generated frames, scaled on the CPU
 * and uploaded as a real copy of a ProRes file would be, thrown away.
 */
export function testEncodeArgs(encoder: VideoEncoder) {
  const pipeline = videoPipeline(encoder, { resolution: 360, bitrate: '2M', gpu: false });
  return [
    '-nostdin',
    '-hide_banner',
    '-v',
    'error',
    ...pipeline.input,
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=25:duration=1',
    '-vf',
    pipeline.filter,
    ...pipeline.codec,
    '-an',
    '-f',
    'null',
    '-',
  ];
}

const VENDORS: Record<string, string> = { '0x8086': 'Intel', '0x1002': 'AMD', '0x10de': 'NVIDIA' };

async function label(encoder: VideoEncoder, io: DetectIo) {
  if (encoder.backend === 'nvenc') {
    const name = await io.nvidiaName();
    return name ? `NVENC (${name})` : 'NVENC';
  }
  const device = encoder.device ?? DEFAULT_VAAPI_DEVICE;
  const vendor = VENDORS[(await io.vendor(device)) ?? ''];
  const details = [vendor, device, encoder.lowPower ? 'low power' : null].filter(Boolean);
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
 * with a backend named, only that one; with `none`, or when none works, libx264. Never throws.
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
    // Intel's free media driver only has the low-power entry point: tried second.
    const variants = backend === 'nvenc' ? [false] : [false, true];
    for (const lowPower of variants) {
      const candidate: VideoEncoder = {
        backend,
        label: '',
        ...(backend === 'nvenc' ? {} : { device }),
        ...(lowPower ? { lowPower } : {}),
      };
      const error = await io.testEncode(ffmpeg, testEncodeArgs(candidate), candidate);
      if (error === null) {
        candidate.label = await label(candidate, io);
        return { encoder: candidate, requested, rejected };
      }
      rejected.push({
        backend,
        reason: `test encode${lowPower ? ' (low power)' : ''} failed: ${error}`,
      });
    }
  }
  return { encoder: SOFTWARE_ENCODER, requested, rejected };
}
