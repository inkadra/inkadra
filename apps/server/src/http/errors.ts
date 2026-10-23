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
};

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
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
  if (err instanceof HttpError) return sendError(reply, err.code, err.message, err.details);
  if (err instanceof ZodError)
    return sendError(reply, 'bad_request', 'Invalid request', err.issues);
  const code = 'statusCode' in err ? err.statusCode : undefined;
  if (code === 413) return sendError(reply, 'payload_too_large', err.message);
  if (code && code >= 400 && code < 500) return sendError(reply, 'bad_request', err.message);
  req.log.error({ err }, 'unhandled error');
  return sendError(reply, 'internal', 'Something went wrong.');
}
