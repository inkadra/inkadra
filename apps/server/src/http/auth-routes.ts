import { AUTH_PREFIX } from '@inkadra/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor } from '../access.ts';
import type { Auth } from '../auth.ts';
import { HttpError } from './errors.ts';

export function toHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
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

export async function requireActor(auth: Auth, req: FastifyRequest): Promise<Actor> {
  const session = await auth.api.getSession({ headers: toHeaders(req) });
  if (!session) throw new HttpError('unauthorized', 'Sign in to continue.');
  const role = (session.user as { role?: string }).role === 'admin' ? 'admin' : 'member';
  return { id: session.user.id, role };
}
