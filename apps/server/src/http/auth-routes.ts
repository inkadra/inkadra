import { AUTH_PREFIX } from '@inkadra/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor } from '../access.ts';
import { enforceAdminTwoFactor } from '../admin-two-factor.ts';
import { type Auth, CLIENT_IP_HEADER } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { user } from '../db/schema.ts';
import { ORIGIN_HEADER, requestOrigin } from '../request-origin.ts';
import { actorFromToken, bearerToken } from '../tokens.ts';
import { HttpError } from './errors.ts';

export function toHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (
      value === undefined ||
      key === CLIENT_IP_HEADER ||
      key === ORIGIN_HEADER ||
      key.startsWith('x-forwarded-')
    )
      continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set(CLIENT_IP_HEADER, req.ip);
  headers.set(ORIGIN_HEADER, requestOrigin(req));
  return headers;
}

/** Mounts Better Auth under /api/auth by translating Fastify requests to Fetch requests. */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth) {
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_PREFIX}/*`,
    async handler(req, reply) {
      const url = new URL(`${requestOrigin(req)}${req.url}`);
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
export async function requireActor(
  auth: Auth,
  req: FastifyRequest,
  db: Database,
  enrollment = false,
): Promise<Actor> {
  const token = bearerToken(req.headers.authorization);
  if (token) {
    const actor = await actorFromToken(db, token);
    if (!actor) throw new HttpError('unauthorized', 'The token is not valid any more.');
    if (!enrollment) await enforceAdminTwoFactor(db, actor);
    return actor;
  }
  const session = await auth.api.getSession({ headers: toHeaders(req) });
  if (!session) throw new HttpError('unauthorized', 'Sign in to continue.');
  const [owner] = await db
    .select({
      id: user.id,
      role: user.role,
      deactivatedAt: user.deactivatedAt,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(user)
    .where(eq(user.id, session.user.id));
  if (!owner || owner.deactivatedAt) throw new HttpError('unauthorized', 'Account deactivated.');
  if (!enrollment) await enforceAdminTwoFactor(db, owner);
  return { id: owner.id, role: owner.role };
}

/** Like requireActor, for account-level actions that a token must not do. */
export async function requireSession(
  auth: Auth,
  req: FastifyRequest,
  db: Database,
  enrollment = false,
) {
  if (bearerToken(req.headers.authorization))
    throw new HttpError('forbidden', 'Not available with a token. Sign in on the web.');
  const session = await auth.api.getSession({ headers: toHeaders(req) });
  if (!session) throw new HttpError('unauthorized', 'Sign in to continue.');
  const [owner] = await db
    .select({
      role: user.role,
      deactivatedAt: user.deactivatedAt,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(user)
    .where(eq(user.id, session.user.id));
  if (!owner || owner.deactivatedAt) throw new HttpError('unauthorized', 'Account deactivated.');
  if (!enrollment) await enforceAdminTwoFactor(db, owner);
  return session;
}
