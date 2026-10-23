import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * ffmpeg and ffprobe are not in the default image: the `-media` image variant adds them
 * (docs/decisions/0010). They are looked up once, on the PATH or in FFMPEG_PATH and
 * FFPROBE_PATH; without them videos are stored without poster or duration.
 */
export interface MediaTools {
  ffmpeg: string | null;
  ffprobe: string | null;
}

let tools: Promise<MediaTools> | undefined;

async function works(bin: string): Promise<boolean> {
  try {
    await run(bin, ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function mediaTools(): Promise<MediaTools> {
  tools ??= (async () => {
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
    const [a, b] = await Promise.all([works(ffmpeg), works(ffprobe)]);
    return { ffmpeg: a ? ffmpeg : null, ffprobe: b ? ffprobe : null };
  })();
  return tools;
}

/** Tests only. */
export function resetMediaTools() {
  tools = undefined;
}

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
}

export async function probeVideo(ffprobe: string, file: string): Promise<VideoInfo> {
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', ...SAFE_INPUT, '-show_entries', 'format=duration', '-of', 'json', file],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const seconds = Number(
    (JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration,
  );
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
  };
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
    run(
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
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
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
