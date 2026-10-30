import { API_PREFIX } from '@inkadra/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { allowedOrigin, requestOrigin } from '../request-origin.ts';
import { sendError } from './errors.ts';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const GUEST_PREFIX = `${API_PREFIX}/guest/`;
/** Better Auth's session cookie (`cookiePrefix: 'inkadra'`), with `__Secure-` over HTTPS. */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-|__Host-)?inkadra\.session_token=/;

/**
 * Whether a write needs to come from the instance itself (decision 0013): every write under
 * /api/v1/guest/, with or without a guest cookie, and every other write under /api/v1 sent
 * with an account session cookie. Bearer requests without a session cookie carry no ambient
 * credential; a Bearer header never exempts a request that also has a session cookie.
 */
export function needsSameOrigin(req: Pick<FastifyRequest, 'method' | 'routeOptions' | 'headers'>) {
  if (SAFE.has(req.method)) return false;
  // The router decodes URL escapes before matching. Inspect its route, never the raw URL.
  // Unmatched paths have no API handler and must remain 404s.
  const path = req.routeOptions.url ?? '';
  if (path.startsWith(GUEST_PREFIX)) return true;
  if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) return false;
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
  return req.headers.origin !== undefined
    ? allowedOrigin(req.headers.origin, requestOrigin(req), publicUrl)
    : sameOrigin(req.headers, requestOrigin(req));
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
