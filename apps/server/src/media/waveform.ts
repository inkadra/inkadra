import { spawn } from 'node:child_process';
import { FFMPEG_MEMORY } from './hwaccel.ts';
import { limitedCommand, toolEnv } from './tools.ts';
import { MAX_INT32, safeInput } from './video.ts';

/** Peaks kept per audio file: enough for the widest card, a few hundred bytes of JSON. */
export const WAVEFORM_PEAKS = 160;

/** Samples per second ffmpeg decodes to, mono, and per block: one block every 10 ms. */
const RATE = 8000;
const BLOCK = 80;

/** Longest stretch read, whatever the header claims: as for playable copies, 2 hours. */
const MAX_SECONDS = 7200;

/**
 * `count` peaks of `blocks` (the loudest block of each slice, 0–1), scaled so the loudest is
 * 100: a quiet recording still draws a shape. Silence and empty input are all zeros.
 */
export function reducePeaks(blocks: ArrayLike<number>, count = WAVEFORM_PEAKS): number[] {
  if (blocks.length === 0) return [];
  const n = Math.min(count, blocks.length);
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * blocks.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * blocks.length) / n));
    let max = 0;
    for (let j = from; j < to; j++) max = Math.max(max, blocks[j] ?? 0);
    peaks.push(max);
  }
  const top = Math.max(...peaks);
  return peaks.map((p) => (top > 0 ? Math.round((p / top) * 100) : 0));
}

/**
 * Loudest sample of each 10 ms block (0–255) of signed 16-bit little-endian mono PCM, fed in
 * chunks of any length: a sample split across two chunks is carried over.
 */
export class BlockPeaks {
  readonly blocks: number[] = [];
  private carry: number | null = null;
  private max = 0;
  private inBlock = 0;

  push(chunk: Uint8Array) {
    let i = 0;
    if (this.carry !== null && chunk.length > 0) {
      this.sample(this.carry | ((chunk[0] ?? 0) << 8));
      this.carry = null;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) this.sample((chunk[i] ?? 0) | ((chunk[i + 1] ?? 0) << 8));
    if (i < chunk.length) this.carry = chunk[i] ?? 0;
  }

  private sample(u16: number) {
    const v = u16 >= 0x8000 ? u16 - 0x10000 : u16;
    this.max = Math.max(this.max, Math.abs(v));
    if (++this.inBlock === BLOCK) this.flush();
  }

  flush() {
    if (this.inBlock === 0) return;
    this.blocks.push(Math.min(255, Math.round((this.max / 32768) * 255)));
    this.max = 0;
    this.inBlock = 0;
  }
}

/**
 * The waveform of an audio file (#327): ffmpeg decodes its first sound stream to 8 kHz mono
 * PCM on a pipe, read here block by block, never kept whole. Same sandbox as every media job:
 * the safe demuxers and file protocol only, the 4 GiB address-space cap, a 1 MiB file cap
 * (it writes no file), `nice`, no environment of the server, at most 2 hours of sound, and
 * killed past `timeoutMs`.
 */
export async function readPeaks(
  ffmpeg: string,
  input: string,
  container: string,
  durationMs: number | null,
): Promise<number[]> {
  const [file, argv] = await limitedCommand(
    ffmpeg,
    [
      '-nostdin',
      '-v',
      'error',
      ...safeInput(container),
      '-i',
      input,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-t',
      String(MAX_SECONDS),
      '-ac',
      '1',
      '-ar',
      String(RATE),
      '-f',
      's16le',
      '-c:a',
      'pcm_s16le',
      'pipe:1',
    ],
    { memoryBytes: FFMPEG_MEMORY, fileBytes: 1024 * 1024, nice: true },
  );
  // Decoding runs far faster than real time: a quarter of the length, at least 2 minutes.
  const seconds = Math.min(MAX_SECONDS, (durationMs ?? MAX_SECONDS * 1000) / 1000);
  const timeoutMs = Math.min(MAX_INT32, Math.max(120_000, seconds * 250));
  const peaks = new BlockPeaks();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, argv, { env: toolEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => peaks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 2000) stderr += chunk;
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
            `ffmpeg could not read the waveform (${signal ?? `exit ${code}`}): ${stderr.trim().slice(0, 300)}`,
          ),
        );
    });
  });
  peaks.flush();
  return reducePeaks(peaks.blocks);
}
