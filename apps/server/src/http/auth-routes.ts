import { AUTH_PREFIX } from '@inkadra/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor } from '../access.ts';
import { type Auth, CLIENT_IP_HEADER } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { actorFromToken, bearerToken } from '../tokens.ts';
import { HttpError } from './errors.ts';

export function toHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === CLIENT_IP_HEADER) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set(CLIENT_IP_HEADER, req.ip);
  return headers;
}

/** Mounts Better Auth under /api/auth by translating Fastify requests to Fetch requests. */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth, publicUrl: string) {
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_PREFIX}/*`,
    async handler(req, reply) {
      const url = new URL(req.url, publicUrl);
      const request = new Request(url, {
        method: req.method,
        headers: toHeaders(req),
        ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
      });
      const response = await auth.handler(request);
      reply.status(response.status);
      for (const [key, value] of response.headers) {
        if (key.toLowerCase() === 'set-cookie') continue;
        reply.header(key, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

/**
 * The signed-in person: a bearer token (`Authorization: Bearer ink_…`) or the session cookie.
 * Better Auth's own endpoints only accept the cookie.
 */
export async function requireActor(auth: Auth, req: FastifyRequest, db: Database): Promise<Actor> {
  const token = bearerToken(req.headers.authorization);
  if (token) {
    const actor = await actorFromToken(db, token);
    if (!actor) throw new HttpError('unauthorized', 'The token is not valid any more.');
    return actor;
  }
  const session = await auth.api.getSession({ headers: toHeaders(req) });
  if (!session) throw new HttpError('unauthorized', 'Sign in to continue.');
  const role = (session.user as { role?: string }).role === 'admin' ? 'admin' : 'member';
  return { id: session.user.id, role };
}

/** Like requireActor, for account-level actions that a token must not do. */
export async function requireSession(auth: Auth, req: FastifyRequest) {
  if (bearerToken(req.headers.authorization))
    throw new HttpError('forbidden', 'Not available with a token. Sign in on the web.');
  const session = await auth.api.getSession({ headers: toHeaders(req) });
  if (!session) throw new HttpError('unauthorized', 'Sign in to continue.');
  return session;
}
