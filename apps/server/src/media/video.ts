import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import {
  encoderMemory,
  FFMPEG_MEMORY,
  gpuDecodes,
  SOFTWARE_ENCODER,
  type VideoEncoder,
  videoPipeline,
} from './hwaccel.ts';
import { limitedCommand, runTool, toolEnv } from './tools.ts';

export { type MediaTools, mediaTools, resetMediaTools } from './tools.ts';

/**
 * Container formats the worker opens. Uploads are untrusted: playlists (HLS, concat, …) could
 * make ffmpeg read other files or fetch URLs, so ffmpeg only gets these demuxers and the file
 * protocol.
 */
const FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegts,mxf';
const SAFE_INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', FORMATS];

/** Video container from the first bytes, or null if it is not one ffmpeg should open. */
export function sniffVideo(head: Uint8Array): string | null {
  const text = (from: number, length: number) =>
    String.fromCharCode(...head.subarray(from, from + length));
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (text(4, 4) === 'ftyp') return text(8, 2) === 'qt' ? 'video/quicktime' : 'video/mp4';
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (text(0, 4) === 'RIFF' && text(8, 3) === 'AVI') return 'video/x-msvideo';
  if (starts(0x00, 0x00, 0x01, 0xba)) return 'video/mpeg';
  if (head[0] === 0x47 && head[188] === 0x47) return 'video/mp2t';
  if (starts(0x06, 0x0e, 0x2b, 0x34)) return 'application/mxf';
  return null;
}

export interface VideoInfo {
  durationMs: number | null;
  /** Of the picture as shown, rotation applied. */
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  /** Pixel format of the video stream (`yuv420p`, `yuv422p10le`…). */
  pixelFormat: string | null;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: Array<{ rotation?: number }>;
}

const rate = (value: string | undefined) => {
  const [n, d] = (value ?? '').split('/').map(Number);
  const fps = d ? (n ?? 0) / d : Number.NaN;
  return Number.isFinite(fps) && fps > 0 && fps < 1000 ? Math.round(fps * 1000) / 1000 : null;
};

/** Largest value of an `integer` column, and of a Node timer: longer durations are lies. */
export const MAX_INT32 = 2 ** 31 - 1;

const name = (value: string | undefined) =>
  value && /^[a-z0-9_.-]{1,40}$/i.test(value) ? value.toLowerCase() : null;

/** The fields of an ffprobe JSON answer the worker keeps; anything odd becomes null. */
export function parseProbe(json: unknown): VideoInfo {
  const data = (json ?? {}) as { format?: { duration?: string }; streams?: ProbeStream[] };
  const streams = Array.isArray(data.streams) ? data.streams : [];
  // Cover art of an MP4 or MKV is a "video" stream too: never take it for the picture.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === 'audio');
  const seconds = Number(data.format?.duration);
  const ms = Math.round(seconds * 1000);
  const rotation = Math.abs(video?.side_data_list?.find((d) => d.rotation)?.rotation ?? 0);
  const turned = rotation === 90 || rotation === 270;
  const size = (v: number | undefined) =>
    v !== undefined && Number.isInteger(v) && v > 0 ? v : null;
  return {
    // A header can claim any length: one past what the row holds is discarded, not saved.
    durationMs: Number.isFinite(ms) && ms > 0 && ms <= MAX_INT32 ? ms : null,
    width: size(turned ? video?.height : video?.width),
    height: size(turned ? video?.width : video?.height),
    videoCodec: name(video?.codec_name),
    audioCodec: name(audio?.codec_name),
    frameRate: rate(video?.avg_frame_rate) ?? rate(video?.r_frame_rate),
    pixelFormat: name(video?.pix_fmt),
  };
}

export async function probeVideo(ffprobe: string, file: string): Promise<VideoInfo> {
  const stdout = await runTool(
    ffprobe,
    [
      '-v',
      'error',
      ...SAFE_INPUT,
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,' +
        'r_frame_rate:stream_disposition=attached_pic:stream_side_data=rotation',
      '-of',
      'json',
      file,
    ],
    { timeoutMs: 30_000, memoryBytes: FFMPEG_MEMORY, maxBuffer: 1024 * 1024 },
  );
  return parseProbe(JSON.parse(stdout.toString('utf8')));
}

/**
 * Writes one frame as PNG: a tenth of the way in (at most 5 s), which skips black leaders and
 * fades, or the first frame of very short clips. ffmpeg applies the rotation of phone videos.
 */
export async function extractPoster(
  ffmpeg: string,
  file: string,
  out: string,
  durationMs: number | null,
): Promise<void> {
  const at = durationMs ? Math.min(5, durationMs / 10_000) : 0;
  const grab = (seek: number) =>
    runTool(
      ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-y',
        ...SAFE_INPUT,
        '-ss',
        seek.toFixed(3),
        '-i',
        file,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        "scale='min(2048,iw)':-2",
        '-f',
        'image2',
        '-c:v',
        'png',
        out,
      ],
      { timeoutMs: 120_000, memoryBytes: FFMPEG_MEMORY, fileBytes: 256 * 1024 * 1024 },
    );
  const written = async () => (await stat(out).catch(() => null))?.size ?? 0;
  // Seeking past the end of a broken or variable-rate file writes nothing: try the start.
  try {
    await grab(at);
    if ((await written()) > 0) return;
  } catch (err) {
    if (at === 0) throw err;
  }
  await grab(0);
  if ((await written()) === 0) throw new Error('ffmpeg wrote no poster frame');
}

// Playable copies (decision 0048) ---------------------------------------------------------

/** What the instance allows for playable copies, from the VIDEO_PROXY_* settings. */
export interface ProxySettings {
  enabled: boolean;
  /** Longest source in seconds; 0 = no limit. */
  maxDurationS: number;
  /** Largest source in bytes; 0 = no limit. */
  maxSourceBytes: number;
  /** Shorter side of the copy, in pixels. */
  resolution: number;
  /** Peak video bitrate, as ffmpeg reads it (`5M`). */
  bitrate: string;
  /** Encoder threads of one copy. */
  threads: number;
  /** Detected when the worker starts (VIDEO_PROXY_HWACCEL); libx264 if unset. */
  encoder?: VideoEncoder;
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  enabled: true,
  maxDurationS: 7200,
  maxSourceBytes: 20 * 1024 ** 3,
  resolution: 1080,
  bitrate: '5M',
  threads: 2,
};

/** Longest a copy may run, whatever the video: 4 hours. */
export const PROXY_MAX_RUN_MS = 4 * 60 * 60 * 1000;

/** 8-bit 4:2:0 H.264, which every browser decodes. */
const plainH264 = (info: VideoInfo) =>
  info.videoCodec === 'h264' && (info.pixelFormat === 'yuv420p' || info.pixelFormat === 'yuvj420p');

/**
 * Whether a browser plays the original as it is: H.264 (8-bit 4:2:0) with AAC, MP3 or no
 * sound in an MP4, or VP8, VP9 or AV1 with Opus, Vorbis or no sound in a WebM. QuickTime,
 * Matroska with other codecs, AVI, MPEG and MXF are not played reliably by every browser.
 */
export function webPlayable(container: string, info: VideoInfo): boolean {
  if (container === 'video/mp4')
    return plainH264(info) && [null, 'aac', 'mp3'].includes(info.audioCodec);
  if (container === 'video/webm')
    return (
      ['vp8', 'vp9', 'av1'].includes(info.videoCodec ?? '') &&
      [null, 'opus', 'vorbis'].includes(info.audioCodec)
    );
  return false;
}

/**
 * What to do about the playable copy of a video: `none` when the original plays (or has no
 * picture at all), `skip` when one is needed but the instance does not make it, `make`
 * otherwise.
 */
export function proxyPlan(
  container: string,
  info: VideoInfo,
  sourceBytes: number,
  settings: ProxySettings,
): 'none' | 'skip' | 'make' {
  if (!info.videoCodec || webPlayable(container, info)) return 'none';
  if (!settings.enabled) return 'skip';
  if (settings.maxSourceBytes > 0 && sourceBytes > settings.maxSourceBytes) return 'skip';
  if (settings.maxDurationS > 0 && (info.durationMs ?? 0) > settings.maxDurationS * 1000)
    return 'skip';
  // A video with no duration is still copied: `-t`, `-fs` and the timeout use the caps.
  return 'make';
}

/** Seconds a copy is planned for: the duration, else the limit of the instance or 4 hours. */
function plannedSeconds(info: VideoInfo, settings: ProxySettings) {
  const cap = settings.maxDurationS > 0 ? settings.maxDurationS : PROXY_MAX_RUN_MS / 4000;
  return info.durationMs ? Math.min(info.durationMs / 1000, cap) : cap;
}

/** `5M` → 5 000 000 bits per second. */
const bitsPerSecond = (bitrate: string) => {
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(bitrate);
  const unit = { k: 1e3, m: 1e6 }[m?.[2]?.toLowerCase() ?? ''] ?? 1;
  return m ? Number(m[1]) * unit : 5e6;
};

/** H.264 that already fits only changes container: the picture is copied, not re-encoded. */
export function copiesVideo(info: VideoInfo, settings: ProxySettings) {
  const short = Math.min(info.width ?? Infinity, info.height ?? Infinity);
  return plainH264(info) && short <= settings.resolution;
}

/**
 * Largest playable copy ffmpeg may write (`-fs`): half again what the peak bitrates give over
 * the planned length (the source size for a remux), never more than the largest source.
 */
export function proxyMaxBytes(info: VideoInfo, settings: ProxySettings, sourceBytes: number) {
  const margin = 16 * 1024 * 1024;
  const estimate = copiesVideo(info, settings)
    ? sourceBytes * 1.1
    : (plannedSeconds(info, settings) * (bitsPerSecond(settings.bitrate) + 384_000) * 1.5) / 8;
  const capped =
    settings.maxSourceBytes > 0 ? Math.min(estimate, settings.maxSourceBytes * 1.1) : estimate;
  return Math.ceil(capped + margin);
}

/**
 * ffmpeg arguments of the playable copy of `input`, progress on stdout, with `encoder` (the
 * one of `settings`, else libx264). A remux uses no encoder at all.
 */
export function proxyArgs(
  input: string,
  output: string,
  info: VideoInfo,
  settings: ProxySettings,
  sourceBytes: number,
  encoder: VideoEncoder = settings.encoder ?? SOFTWARE_ENCODER,
) {
  const copyVideo = copiesVideo(info, settings);
  const copyAudio = info.audioCodec === 'aac';
  const pipeline = videoPipeline(encoder, {
    resolution: settings.resolution,
    bitrate: settings.bitrate,
    gpu: !encoder.cpuDecode && gpuDecodes(info.videoCodec, info.pixelFormat),
  });
  return [
    '-nostdin',
    '-v',
    'error',
    '-y',
    ...SAFE_INPUT,
    ...(copyVideo ? [] : pipeline.input),
    '-i',
    input,
    // `V`, not `v`: video streams that are not cover art (attached pictures).
    '-map',
    '0:V:0',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    ...(copyVideo ? ['-c:v', 'copy'] : ['-vf', pipeline.filter, ...pipeline.codec]),
    ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k', '-ac', '2']),
    '-threads',
    String(settings.threads),
    // Whatever the header says, the copy stops at the length and the size it is planned for.
    ...(settings.maxDurationS > 0 ? ['-t', String(settings.maxDurationS)] : []),
    '-fs',
    String(proxyMaxBytes(info, settings, sourceBytes)),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    '-progress',
    'pipe:1',
    '-nostats',
    output,
  ];
}

/** ffmpeg ran out of time: another attempt would too. */
export class ProxyTimeout extends Error {}

/**
 * Writes the playable H.264/AAC MP4 of `input` to `output`, calling `onProgress` with the
 * percent done (0–99) as ffmpeg reports it. Runs at a lower priority, with caps on memory and
 * on the file it writes; killed past `timeoutMs` with ProxyTimeout.
 */
export async function makeProxy(
  ffmpeg: string,
  input: string,
  output: string,
  info: VideoInfo,
  settings: ProxySettings,
  opts: {
    timeoutMs: number;
    sourceBytes: number;
    /** Overrides the encoder of `settings`: the software retry of a failed hardware copy. */
    encoder?: VideoEncoder;
    onProgress?: (percent: number) => void;
  },
): Promise<void> {
  const encoder = opts.encoder ?? settings.encoder ?? SOFTWARE_ENCODER;
  const [file, argv] = await limitedCommand(
    ffmpeg,
    proxyArgs(input, output, info, settings, opts.sourceBytes, encoder),
    {
      memoryBytes: copiesVideo(info, settings) ? FFMPEG_MEMORY : encoderMemory(encoder),
      // Above -fs: ffmpeg stops cleanly at its own limit, the kernel only past it.
      fileBytes: proxyMaxBytes(info, settings, opts.sourceBytes) + 64 * 1024 * 1024,
      nice: true,
    },
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, argv, { env: toolEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let pending = '';
    let last = -1;
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill('SIGKILL');
      },
      Math.min(opts.timeoutMs, MAX_INT32),
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (!m || !info.durationMs) continue;
        const percent = Math.min(99, Math.floor(Number(m[1]) / 10 / info.durationMs));
        if (percent > last) {
          last = percent;
          opts.onProgress?.(percent);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4000) stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (timedOut)
        reject(new ProxyTimeout(`ffmpeg ran past ${Math.round(opts.timeoutMs / 60_000)} minutes`));
      else
        reject(
          new Error(
            `ffmpeg could not make the playable copy (${signal ?? `exit ${code}`}): ${stderr.trim().slice(0, 500)}`,
          ),
        );
    });
  });
}

/**
 * Time a copy may take: four times its planned length (the duration, else the cap), at least
 * ten minutes, at most four hours.
 */
export function proxyTimeoutMs(info: VideoInfo, settings: ProxySettings) {
  const planned = plannedSeconds(info, settings) * 1000 * 4;
  return Math.min(PROXY_MAX_RUN_MS, MAX_INT32, Math.max(10 * 60_000, planned));
}
