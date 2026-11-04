import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { extname } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { type CreateFeedback, redactFeedback } from '@inkadra/shared';
import sharp from 'sharp';
import { decodeHeic } from './media/heic.ts';
import { limitedCommand, mediaTools } from './media/tools.ts';

const exec = promisify(execFile);
/** All that may leave on this route, in step with the Worker's list. */
export const RELAY_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'text/plain',
  'application/pdf',
];
const VIDEO_FORMATS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/**
 * Images the upload route does not rewrite, without their metadata (GPS, camera, owner): whatever
 * leaves on this route stays in the history of a repository. Null: not one of those.
 */
export async function relayImage(path: string, mime: string, maxPixels: number) {
  if (!['image/gif', 'image/tiff', 'image/avif', 'image/heic'].includes(mime)) return null;
  const options = { limitInputPixels: maxPixels };
  // In memory, and the upload limit keeps it small: sharp would hold the file open on Windows.
  const bytes = await readFile(path);
  if (mime === 'image/gif')
    return {
      data: await sharp(bytes, { ...options, animated: true })
        .gif()
        .toBuffer(),
      mime,
    };
  if (mime === 'image/tiff' || mime === 'image/avif')
    return {
      data: await sharp(bytes, options).rotate().webp({ quality: 85 }).toBuffer(),
      mime: 'image/webp',
    };
  if (mime === 'image/heic') {
    const { width, height, data } = await decodeHeic(bytes);
    if (width * height > maxPixels) throw new Error('Image too large');
    return {
      data: await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        raw: { width, height, channels: 4 },
      })
        .webp({ quality: 85 })
        .toBuffer(),
      mime: 'image/webp',
    };
  }
  return null;
}

/**
 * A video from the device, its pictures and sound copied as they are, nothing else: no metadata,
 * chapters or data tracks, where phones and action cameras keep the GPS position. Null: no ffmpeg
 * here (only the `-media` image has it), or a format that can't be copied into its own container.
 */
export async function relayVideo(path: string, mime: string) {
  const { ffmpeg } = await mediaTools();
  const format = VIDEO_FORMATS[mime];
  if (!ffmpeg || !format) return null;
  const out = `${path}.clean`;
  const [file, argv] = await limitedCommand(ffmpeg, [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-protocol_whitelist',
    'file',
    '-i',
    path,
    '-map',
    '0:v',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-fflags',
    '+bitexact',
    '-f',
    format,
    '-y',
    out,
  ]);
  try {
    await exec(file, argv, { timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(out, { force: true });
  }
}

const INTERNAL_ADDRESS =
  /\b(?:10\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|(?:[a-z0-9-]+\.)+(?:local|lan|internal|intranet|home\.arpa|ts\.net))\b/gi;

/**
 * Secrets go first; then the instance's names, which a log can hold without a scheme: its public
 * host, this machine's name and internal addresses.
 * shortcut: another public alias of the instance stays, a config list of aliases would catch it.
 */
export function relayClean(text: string, publicUrl: string) {
  let clean = redactFeedback(text).replaceAll(new URL(publicUrl).hostname, '[instance]');
  const machine = hostname();
  if (machine.length >= 4) clean = clean.replaceAll(machine, '[instance]');
  return clean.replace(INTERNAL_ADDRESS, '[instance]');
}

/** The name a file had on someone's device can hold a name: only its kind and extension leave. */
export function relayFileName(file: { kind: string; name: string }, index: number) {
  const extension = extname(file.name);
  return `${file.kind}-${index + 1}${/^\.[a-z0-9]{1,8}$/i.test(extension) ? extension : ''}`;
}

/** Only fixed diagnostic fields leave the instance; never reporter or instance metadata. */
export function relayMetadata(report: CreateFeedback, publicUrl: string) {
  const clean = (text: string) => relayClean(text, publicUrl);
  return {
    requestId: report.requestId,
    kind: report.type === 'bug' ? 'problem' : report.type,
    area: report.area,
    title: report.title,
    description: report.description,
    device: Object.fromEntries(
      Object.entries(report.diagnostics)
        .filter(([k]) => !['console', 'network'].includes(k))
        .map(([k, v]) => [k, clean(v)]),
    ),
    // The relay keeps this much: the newest lines, the ones that explain the report.
    logExcerpt: clean(
      [report.diagnostics.console, report.diagnostics.network].filter(Boolean).join('\n'),
    ).slice(-RELAY_LOG_LIMIT),
  };
}

const MAX_TICKET_WAIT_MS = 20000;
const RELAY_LOG_LIMIT = 6000;
/** Only the Worker's own answers about this report stop it: see `failureFrom`. */
const PERMANENT = [400, 410, 413, 422, 451];

export class RelayFailure extends Error {
  readonly status: number;
  readonly uncertain: boolean;
  readonly permanent: boolean;
  /** When the relay said when to come back. */
  readonly retryAfterMs: number | undefined;
  /** The relay is fine, it asks this report to wait its turn: not an outage to tell anyone about. */
  readonly waiting: boolean;
  constructor(
    status: number,
    options: {
      uncertain?: boolean;
      permanent?: boolean;
      retryAfterMs?: number;
      waiting?: boolean;
    } = {},
  ) {
    super(`Relay unavailable (HTTP ${status})`);
    this.status = status;
    this.uncertain = options.uncertain ?? false;
    this.permanent = options.permanent ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.waiting = options.waiting ?? false;
  }
}

/**
 * A host not published yet, a proxy or a Cloudflare error page answers anything, without our JSON:
 * none of that may stop a report for good. Only the relay itself can confirm it failed before the
 * issue write, so an error without that word stays uncertain when it is a 5xx.
 */
async function failureFrom(res: Response, writing: boolean) {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    uncertain?: boolean;
  } | null;
  const seconds = Number(res.headers.get('retry-after'));
  return new RelayFailure(res.status, {
    uncertain: writing && res.status >= 500 && body?.uncertain !== false,
    permanent: !!body?.error && PERMANENT.includes(res.status),
    ...(seconds > 0 ? { retryAfterMs: seconds * 1000 } : {}),
  });
}

export async function relayChallenge(base: string, installId: string) {
  const res = await fetch(`${base}/challenge`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installId }),
  });
  if (!res.ok) throw await failureFrom(res, false);
  const t = (await res.json()) as { ticket: string; seed: string; bits: number; nbf: number };
  if (
    !Number.isInteger(t.bits) ||
    t.bits < 0 ||
    t.bits > 20 ||
    !Number.isFinite(t.nbf) ||
    t.nbf > Date.now() + 16 * 60000 ||
    typeof t.seed !== 'string' ||
    typeof t.ticket !== 'string'
  )
    throw new RelayFailure(502);
  // Before the work: what it proves would be stale by the time the wait is over.
  const wait = t.nbf - Date.now();
  if (wait > MAX_TICKET_WAIT_MS) throw new RelayFailure(429, { retryAfterMs: wait, waiting: true });
  let powNonce = '';
  for (let n = 0; ; n++) {
    const hash = createHash('sha256').update(`${t.seed}:${n}`).digest();
    let bits = 0;
    for (const byte of hash) {
      if (!byte) bits += 8;
      else {
        bits += Math.clz32(byte) - 24;
        break;
      }
    }
    if (bits >= t.bits) {
      powNonce = String(n);
      break;
    }
    if (n % 1024 === 0) await setTimeout(0);
  }
  // Holding a claimed report for long would mark it uncertain if the server restarted.
  await setTimeout(Math.max(0, t.nbf - Date.now()));
  return { installId, ticket: t.ticket, powNonce };
}

export async function sendRelay(
  base: string,
  form: FormData,
  ticket: { installId: string; ticket: string; powNonce: string },
) {
  let res: Response;
  try {
    res = await fetch(`${base}/report`, {
      method: 'POST',
      body: form,
      headers: {
        'x-relay-install': ticket.installId,
        'x-relay-ticket': ticket.ticket,
        'x-relay-nonce': ticket.powNonce,
      },
      redirect: 'error',
      // The Worker gives each file two minutes; the ticket and the issue take seconds.
      signal: AbortSignal.timeout(300000),
    });
  } catch {
    throw new RelayFailure(502, { uncertain: true });
  }
  if (!res.ok) throw await failureFrom(res, true);
  try {
    const result = (await res.json()) as { number: number };
    if (!Number.isSafeInteger(result.number) || result.number < 1)
      throw new Error('Invalid receipt');
    return result.number;
  } catch {
    throw new RelayFailure(502, { uncertain: true });
  }
}
