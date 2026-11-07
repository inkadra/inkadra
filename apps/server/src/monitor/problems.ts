import { createHash } from 'node:crypto';
import { redactFeedback, type ServerProblemKind, type ServerRole } from '@inkadra/shared';
import type { Logger } from 'pino';
import type { MonitorStore, ProblemInput } from './store.ts';

/**
 * The technical line of a problem (#514): where it happened and the error, with nothing a
 * board, a file or a person could be recognised by: what the feedback redaction removes
 * (addresses, tokens, ids), then quoted text, paths and file names (they carry titles).
 */
export function technicalText(text: string): string {
  const clean = redactFeedback(text)
    .replace(/"[^"\n]{0,300}"|'[^'\n]{0,300}'|«[^»\n]{0,300}»|“[^”\n]{0,300}”/g, '"…"')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@~+-]+){2,}/g, '[path]')
    .replace(
      /\b[\w-]+\.(?:mp4|mov|mkv|avi|webm|mxf|m4v|jpe?g|png|heic|tiff?|pdf|docx?|xlsx?|pptx?|wav|mp3|m4a|psd|raw|dng|cr[23]|nef|arw)\b/gi,
      '[file]',
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

export function recordProblem(
  store: MonitorStore | undefined,
  input: ProblemInput | null,
  log: Pick<Logger, 'warn'>,
) {
  if (!store || !input) return;
  store.record(input).catch((err) => log.warn({ err }, 'server problem not saved'));
}
