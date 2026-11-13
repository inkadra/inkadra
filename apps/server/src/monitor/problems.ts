import { createHash } from 'node:crypto';
import { redactFeedback, type ServerProblemKind, type ServerRole } from '@inkadra/shared';
import type { Logger } from 'pino';
import type { MonitorStore, ProblemInput } from './store.ts';

/** Extensions of the server's own files: an error naming them names no one's work. */
const TECHNICAL = new Set(['js', 'mjs', 'cjs', 'ts', 'mts', 'json', 'node', 'sql', 'wasm', 'map']);

/**
 * The technical line of a problem (#514): where it happened and the error, with nothing a
 * board, a file or a person could be recognised by: what the feedback redaction removes
 * (addresses, tokens, ids), then quoted text, paths and file names (they carry titles).
 */
export function technicalText(text: string): string {
  // The first 2000 characters say what went wrong; the patterns below stay fast on them.
  const clean = redactFeedback(text.slice(0, 2000))
    .replace(/"[^"\n]{0,300}"|'[^'\n]{0,300}'|«[^»\n]{0,300}»|“[^”\n]{0,300}”/g, '"…"')
    // A path runs to its first extension, spaces and all (`/data/My Film Final.mov: …`), or
    // else to the end of the word.
    .replace(
      /(?:\b[A-Za-z]:)?[\\/](?:[\w.@~+-]+[\\/])+(?:[^\n:"'<>|]*?\.[A-Za-z][A-Za-z0-9]{1,4}\b|[^\s:"'<>|]*)/g,
      '[path]',
    )
    // shortcut: a file name outside a path loses only its last word (`My Film Final.mov` keeps
    // `My Film`): nothing tells where it starts. Any `name.ext`, but for code and data formats.
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.([A-Za-z][A-Za-z0-9]{1,4})\b/g, (match, ext: string) =>
      TECHNICAL.has(ext.toLowerCase()) ? match : '[file]',
    )
    // A database error quotes the values it refused: `Key (email)=(x) already exists`.
    .replace(/=\([^)\n]{0,300}\)/g, '=(…)');
  return clean.length > 600 ? `${clean.slice(0, 599)}…` : clean;
}

const QUEUE_KINDS: Record<string, ServerProblemKind> = {
  'media-proxies': 'video_failed',
  media: 'preview_failed',
  office: 'office_failed',
  email: 'email_failed',
  transfers: 'transfer_failed',
};

const short = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

/**
 * A job that failed for good, as a problem. The same file failing again is one problem with a
 * count; other jobs group by queue, name and the first line of the error.
 */
export function jobProblem(
  role: ServerRole,
  queue: string,
  job: { id?: string | undefined; name: string; data: unknown },
  err: Error,
  at = Date.now(),
): ProblemInput | null {
  // Board edits expire by design and backups are watched from their own rows.
  if (queue === 'collab' || (queue === 'maintenance' && job.name === 'backup')) return null;
  const kind = QUEUE_KINDS[queue] ?? 'job_failed';
  const data =
    job.data && typeof job.data === 'object' ? (job.data as Record<string, unknown>) : {};
  const assetId = typeof data.assetId === 'string' ? data.assetId : null;
  const message = technicalText(`${err.name}: ${err.message}`.split('\n')[0] ?? '');
  return {
    id: assetId ? `${kind}:${assetId}` : `${kind}:${queue}:${job.name}:${short(message)}`,
    kind,
    severity: kind === 'email_failed' ? 'warning' : 'error',
    role,
    technical: `${role} · ${queue} · ${job.name}\n${message}`,
    assetId,
    service: null,
    job: job.id ? { queue, id: job.id } : null,
    at,
  };
}

/** An answer the web role could not give (a 500), grouped by route and error. */
export function requestProblem(
  route: string,
  method: string,
  err: Error,
  at = Date.now(),
): ProblemInput {
  const message = technicalText(`${err.name}: ${err.message}`.split('\n')[0] ?? '');
  return {
    id: `server_error:${method} ${route}:${short(message)}`,
    kind: 'server_error',
    severity: 'error',
    role: 'web',
    technical: `web · ${method} ${route}\n${message}`,
    assetId: null,
    service: null,
    job: null,
    at,
  };
}

/**
 * A board that could not be saved or opened (collab). One problem per board and error: until it
 * is saved, its edits live only in the memory of the process.
 */
export function boardProblem(
  kind: 'board_save_failed' | 'board_load_failed',
  role: ServerRole,
  boardId: string,
  err: Error,
  at = Date.now(),
): ProblemInput {
  const message = technicalText(`${err.name}: ${err.message}`.split('\n')[0] ?? '');
  return {
    id: `${kind}:${boardId}:${short(message)}`,
    kind,
    severity: 'error',
    role,
    technical: `${role} · board\n${message}`,
    assetId: null,
    service: null,
    job: null,
    at,
  };
}

export function recordProblem(
  store: MonitorStore | undefined,
  input: ProblemInput | null,
  log: Pick<Logger, 'warn'>,
) {
  if (!store || !input) return;
  store.record(input).catch((err) => log.warn({ err }, 'server problem not saved'));
}
