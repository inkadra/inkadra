import { API_PREFIX } from '@inkadra/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { bearerToken } from '../tokens.ts';
import { sendError } from './errors.ts';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GUEST_PREFIX = `${API_PREFIX}/guest/`;
/** Better Auth's session cookie (`cookiePrefix: 'inkadra'`), with `__Secure-` over HTTPS. */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?inkadra\.session_token=/;

/**
 * Whether a write needs to come from the instance itself (decision 0013): every write under
 * /api/v1/guest/, with or without a guest cookie, and every other write under /api/v1 sent
 * with an account session cookie. Requests with a bearer token (extension, mobile app) carry
 * no ambient credential, so they are not affected.
 */
export function needsSameOrigin(req: Pick<FastifyRequest, 'method' | 'url' | 'headers'>) {
  if (!UNSAFE.has(req.method)) return false;
  const path = req.url.split('?')[0] ?? '';
  if (path.startsWith(GUEST_PREFIX)) return true;
  if (!path.startsWith(`${API_PREFIX}/`)) return false;
  if (bearerToken(req.headers.authorization)) return false;
  return SESSION_COOKIE.test(req.headers.cookie ?? '');
}

/** `Origin` equal to the origin of PUBLIC_URL or, without `Origin`, `Sec-Fetch-Site: same-origin`. */
export function sameOrigin(headers: FastifyRequest['headers'], allowedOrigin: string): boolean {
  const origin = headers.origin;
  if (origin !== undefined) return origin === allowedOrigin;
  return headers['sec-fetch-site'] === 'same-origin';
}

/** Shared with the guest-link routes: validate against the configured instance origin. */
export function checkSameOrigin(req: FastifyRequest, publicUrl: string): boolean {
  return sameOrigin(req.headers, new URL(publicUrl).origin);
}

/**
 * Refuses cross-site writes with 403 before any handler runs. SameSite=Lax does not stop
 * requests from sibling subdomains, which are common when self-hosting.
 */
export function registerCsrfCheck(app: FastifyInstance, publicUrl: string) {
  app.addHook('onRequest', async (req, reply) => {
    if (needsSameOrigin(req) && !checkSameOrigin(req, publicUrl))
      return sendError(reply, 'forbidden', 'Cross-site request refused.');
  });
}
