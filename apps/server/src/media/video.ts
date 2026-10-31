import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { limitedCommand, runTool, toolEnv } from './tools.ts';

export { type MediaTools, mediaTools, resetMediaTools } from './tools.ts';

/**
 * Container formats the worker opens. Uploads are untrusted: playlists (HLS, concat, …) could
 * make ffmpeg read other files or fetch URLs, so ffmpeg only gets these demuxers and the file
 * protocol.
 */
const FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegts,mxf';
const SAFE_INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', FORMATS];

/** Address space of one ffmpeg or ffprobe run: decoding 8K ProRes fits, a bomb does not. */
const FFMPEG_MEMORY = 4 * 1024 ** 3;

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
  const rotation = Math.abs(video?.side_data_list?.find((d) => d.rotation)?.rotation ?? 0);
  const turned = rotation === 90 || rotation === 270;
  const size = (v: number | undefined) =>
    v !== undefined && Number.isInteger(v) && v > 0 ? v : null;
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
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
      { timeoutMs: 120_000, memoryBytes: FFMPEG_MEMORY },
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
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  enabled: true,
  maxDurationS: 7200,
  maxSourceBytes: 20 * 1024 ** 3,
  resolution: 1080,
  bitrate: '5M',
};

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
  return 'make';
}

/** `5M` → `10M`: the rate-control buffer is two seconds at the peak rate. */
const doubled = (bitrate: string) => {
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(bitrate);
  return m ? `${Number(m[1]) * 2}${m[2]}` : bitrate;
};

/** ffmpeg arguments of the playable copy of `input`, progress on stdout. */
export function proxyArgs(input: string, output: string, info: VideoInfo, settings: ProxySettings) {
  const short = Math.min(info.width ?? Infinity, info.height ?? Infinity);
  // H.264 that already fits only changes container: the picture is copied, not re-encoded.
  const copyVideo = plainH264(info) && short <= settings.resolution;
  const copyAudio = info.audioCodec === 'aac';
  const r = settings.resolution;
  // The shorter side at most `r` (1080 makes 1920×1080 or 1080×1920), never upscaled, even.
  const scale =
    `scale='if(gte(iw,ih),-2,min(${r},trunc(iw/2)*2))'` +
    `:'if(gte(iw,ih),min(${r},trunc(ih/2)*2),-2)'`;
  return [
    '-nostdin',
    '-v',
    'error',
    '-y',
    ...SAFE_INPUT,
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    ...(copyVideo
      ? ['-c:v', 'copy']
      : [
          '-vf',
          scale,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-maxrate',
          settings.bitrate,
          '-bufsize',
          doubled(settings.bitrate),
          '-pix_fmt',
          'yuv420p',
          '-profile:v',
          'high',
        ]),
    ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k', '-ac', '2']),
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

/**
 * Writes the playable H.264/AAC MP4 of `input` to `output`, calling `onProgress` with the
 * percent done (0–99) as ffmpeg reports it. Killed past `timeoutMs`.
 */
export async function makeProxy(
  ffmpeg: string,
  input: string,
  output: string,
  info: VideoInfo,
  settings: ProxySettings,
  opts: { timeoutMs: number; onProgress?: (percent: number) => void },
): Promise<void> {
  const [file, argv] = await limitedCommand(
    ffmpeg,
    proxyArgs(input, output, info, settings),
    FFMPEG_MEMORY,
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, argv, { env: toolEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let pending = '';
    let last = -1;
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
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
      else
        reject(
          new Error(
            `ffmpeg could not make the playable copy (${signal ?? `exit ${code}`}): ${stderr.trim().slice(0, 500)}`,
          ),
        );
    });
  });
}

/** Time a copy may take: four times the length of the video, at least ten minutes. */
export function proxyTimeoutMs(info: VideoInfo) {
  return Math.max(10 * 60_000, (info.durationMs ?? 30 * 60_000) * 4);
}
