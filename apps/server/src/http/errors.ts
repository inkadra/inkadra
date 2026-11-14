import type { ApiError, ErrorCode } from '@inkadra/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

const status: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
};

/** Advertised in `/instance/version`: servers that answer outages with 503 `unavailable`. */
export const UNAVAILABLE_ERRORS_CAPABILITY = 'unavailable-errors';

/** PostgreSQL and driver codes that mean "try again", not a bug. */
const RETRY_SOON = new Set(['40001', '40P01', '55P03', '57014']);
const DATABASE_DOWN = new Set([
  '53300',
  '57P01',
  '57P02',
  '57P03',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
]);

/**
 * A database error the client can act on: a unique violation lost to a concurrent request is a
 * 409; a serialization failure, deadlock, lock or statement timeout, or an unreachable database
 * is a 503 with `Retry-After`. Drizzle wraps driver errors, so the whole `cause` chain is read.
 */
export function databaseError(err: unknown): HttpError | undefined {
  for (let e = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const { code } = e as { code?: unknown };
    if (typeof code !== 'string') continue;
    if (code === '23505')
      return new HttpError('conflict', 'This was changed at the same time. Reload and try again.');
    if (RETRY_SOON.has(code))
      return new HttpError('unavailable', 'The server is busy. Try again.', undefined, 1);
    if (DATABASE_DOWN.has(code) || code.startsWith('08'))
      return new HttpError(
        'unavailable',
        'The server is unavailable. Try again soon.',
        undefined,
        5,
      );
  }
  return undefined;
}

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  const body: ApiError = {
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
  return reply.status(status[code]).send(body);
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    if (err.retryAfter !== undefined) reply.header('Retry-After', err.retryAfter);
    return sendError(reply, err.code, err.message, err.details);
  }
  if (err instanceof ZodError)
    return sendError(reply, 'bad_request', 'Invalid request', err.issues);
  const known = databaseError(err);
  if (known) {
    req.log.warn({ err }, 'database error');
    return errorHandler(known, req, reply);
  }
  const code = 'statusCode' in err ? err.statusCode : undefined;
  if (code === 413) return sendError(reply, 'payload_too_large', err.message);
  if (code && code >= 400 && code < 500) return sendError(reply, 'bad_request', err.message);
  req.log.error({ err }, 'unhandled error');
  return sendError(reply, 'internal', 'Something went wrong.');
}
