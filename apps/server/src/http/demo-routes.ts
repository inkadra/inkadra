import { API_PREFIX, AUTH_PREFIX, CreateDemoSandbox } from '@inkadra/shared';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  createSandbox,
  type DemoDeps,
  endSandbox,
  readSandbox,
  refuse,
  verifyTurnstile,
} from '../demo.ts';
import type { Jobs } from '../jobs.ts';
import { addressBucket, Failures } from '../rate-limits.ts';
import type { safeFetch } from '../safe-fetch.ts';
import type { Storage } from '../storage.ts';
import { requireActor, toHeaders } from './auth-routes.ts';
import { HttpError, sendError } from './errors.ts';

const v1 = (path: string) => `${API_PREFIX}${path}`;
/** Refused attempts (Turnstile, a full demo) one address may make every ten minutes. */
export const DEMO_REFUSALS = 5;
const UPLOADS = v1('/uploads');

/**
 * What a sandbox may reach (decision 0084): working on its own project. Everything else of the
 * API answers 403 in the demo, routes added later included: sharing, invitations, members,
 * guest and review links, calendar feeds, feedback, the clipper and app tokens, imports,
 * avatars, address search and maps, link previews (the server would fetch any address and
 * keep its picture), and the whole administration.
 */
const ALLOWED: Record<string, readonly string[]> = {
  GET: [
    '/health',
    '/instance',
    '/instance/version',
    '/instance/classifications',
    '/demo/sandbox',
    '/me',
    '/me/tasks',
    '/me/preferences',
    '/me/notification-preferences',
    '/me/notifications',
    '/me/notifications/unread-count',
    '/me/recent-boards',
    '/me/unsorted',
    '/me/storage',
    '/me/storage/files',
    '/me/sessions',
    '/me/shooting-days',
    '/users/:userId/avatar/:version',
    '/projects',
    '/projects/:projectId',
    '/projects/:projectId/board-counts',
    '/projects/:projectId/boards',
    '/projects/:projectId/cast-appearances',
    '/projects/:projectId/export-settings',
    '/projects/:projectId/members',
    '/projects/:projectId/plan-kit',
    '/projects/:projectId/tags',
    '/project-groups',
    '/shared-boards',
    '/boards/:boardId',
    '/boards/:boardId/access',
    '/boards/:boardId/columns',
    '/boards/:boardId/comments',
    '/boards/:boardId/comment-counts',
    '/boards/:boardId/elements/:elementId/review/history',
    '/boards/:boardId/preview',
    '/boards/:boardId/reactions',
    '/boards/:boardId/reviews',
    '/boards/:boardId/schedule',
    '/boards/:boardId/schedule/attendance',
    '/boards/:boardId/share-links',
    '/boards/:boardId/versions',
    '/boards/:boardId/versions/:versionId',
    '/boards/:boardId/versions/:versionId/state',
    '/comments/:commentId/replies',
    // The proofing of an imported link, which no address opens (decision 0086).
    '/share-links/:linkId/picks',
    '/assets/:assetId',
    '/assets/:assetId/file',
    '/assets/:assetId/frame',
    '/assets/:assetId/proxy',
    '/assets/:assetId/variants/:size',
    '/assets/:assetId/waveform',
    '/search',
    '/transfers',
    '/transfers/:transferId',
    '/transfers/:transferId/download',
  ],
  POST: [
    '/demo/sandbox',
    '/projects/:projectId/boards',
    '/projects/:projectId/exports',
    '/project-groups',
    '/boards/:boardId/comments',
    '/boards/:boardId/schedule',
    '/boards/:boardId/schedule/edit',
    '/boards/:boardId/versions',
    '/boards/:boardId/versions/:versionId/restore',
    '/comments/:commentId/read',
    '/comments/:commentId/unread',
    '/comments/:commentId/resolve',
    '/comments/:commentId/reopen',
    '/me/notifications/:notificationId/read',
    '/me/notifications/:notificationId/unread',
    '/me/notifications/read-all',
    '/uploads',
  ],
  PATCH: [
    '/me',
    '/me/preferences',
    '/me/notification-preferences',
    '/projects/:projectId',
    '/projects/:projectId/export-settings',
    '/project-groups/:groupId',
    '/boards/:boardId',
    '/boards/:boardId/versions/:versionId',
    '/comments/:commentId',
    '/uploads/:uploadId',
  ],
  PUT: [
    '/projects/:projectId/group',
    '/projects/:projectId/pin',
    '/boards/:boardId/elements/:elementId/review',
    '/boards/:boardId/elements/:elementId/reactions/:emoji',
    '/comments/:commentId/reactions/:emoji',
    '/boards/:boardId/schedule/cast-links',
    '/boards/:boardId/schedule/:dayId',
    '/boards/:boardId/schedule/:dayId/attendance',
  ],
  DELETE: [
    '/demo/sandbox',
    '/project-groups/:groupId',
    '/boards/:boardId',
    '/boards/:boardId/versions/:versionId',
    '/boards/:boardId/elements/:elementId/reactions/:emoji',
    '/comments/:commentId',
    '/comments/:commentId/reactions/:emoji',
    '/boards/:boardId/schedule/:dayId',
    '/me/sessions/:sessionId',
    '/transfers/:transferId',
    '/uploads/:uploadId',
  ],
  HEAD: ['/uploads/:uploadId'],
  OPTIONS: ['/uploads', '/uploads/:uploadId'],
};
const allowed = new Set(
  Object.entries(ALLOWED).flatMap(([method, paths]) => paths.map((p) => `${method} ${v1(p)}`)),
);
/** Better Auth: reading the session and signing out; no sign-in or sign-up of any kind. */
const AUTH_ALLOWED = new Set([`GET ${AUTH_PREFIX}/get-session`, `POST ${AUTH_PREFIX}/sign-out`]);

/** Whether the demo lets this request through; the web app's own files always pass. */
export function demoAllows(method: string, route: string | undefined, path: string): boolean {
  const verb = method === 'HEAD' && !route?.startsWith(UPLOADS) ? 'GET' : method;
  if (path.startsWith(`${AUTH_PREFIX}/`))
    return AUTH_ALLOWED.has(`${verb} ${path.split('?')[0]?.replace(/\/+$/, '')}`);
  // Guest pages, calendar feeds and anything else the server answers outside the web app.
  if (path.startsWith('/s/') || path.startsWith('/calendar/')) return false;
  if (!path.startsWith('/api/')) return true;
  return route !== undefined && allowed.has(`${verb} ${route}`);
}

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  storage: Storage;
  jobs: Jobs;
  log: Logger;
  /** Tests: a stand-in for Cloudflare. */
  turnstileFetch?: typeof safeFetch;
  /** Tests: other archives than the sample projects. */
  demoSeeds?: readonly string[];
}

/** The demo's door (decision 0084): the allowlist above, and the sandbox routes. */
export function registerDemoRoutes(app: FastifyInstance, deps: Deps) {
  const { config, db, auth } = deps;
  if (!config.DEMO_MODE) return;
  app.addHook('onRequest', async (req, reply) => {
    if (!demoAllows(req.method, req.routeOptions.url, req.url))
      return sendError(reply, 'forbidden', 'Not available in the demo.', { reason: 'demo_off' });
  });

  const demo: DemoDeps = {
    db,
    storage: deps.storage,
    jobs: deps.jobs,
    config,
    log: deps.log,
    ...(deps.demoSeeds ? { seeds: deps.demoSeeds } : {}),
  };
  // One sandbox per address (an IPv6 /64) every ten minutes. A refusal (a failed check, a full
  // demo) does not spend that turn, but has its own budget: nobody hammers Turnstile from here.
  const perAddress = new Failures(1, 10 * 60 * 1000, 'demo-routes:perAddress');
  const refusals = new Failures(DEMO_REFUSALS, 10 * 60 * 1000, 'demo-routes:refusals');
  const limited = config.NODE_ENV === 'production' || config.AUTH_RATE_LIMITS !== 'off';
  const hostname = new URL(config.PUBLIC_URL).hostname;

  app.post(v1('/demo/sandbox'), async (req, reply) => {
    const { turnstileToken } = CreateDemoSandbox.parse(req.body ?? {});
    const key = addressBucket(req.ip);
    if (limited && !(await refusals.begin(key))) {
      reply.header('retry-after', String(Math.max(1, refusals.retryAfterSeconds(key))));
      throw refuse('rate_limited', 'demo_wait');
    }
    if (limited && !(await perAddress.begin(key))) {
      await refusals.finish(key, false);
      reply.header('retry-after', String(Math.max(1, perAddress.retryAfterSeconds(key))));
      throw refuse('rate_limited', 'demo_wait');
    }
    let made = false;
    try {
      if (
        config.TURNSTILE_SECRET &&
        !(await verifyTurnstile(
          config.TURNSTILE_SECRET,
          turnstileToken,
          req.ip,
          hostname,
          deps.turnstileFetch,
        ))
      )
        throw refuse('forbidden', 'turnstile');
      const userId = await createSandbox(demo);
      made = true;
      const signed = await auth.api.demoSession({
        body: { userId },
        headers: toHeaders(req),
        returnHeaders: true,
      });
      const cookies = signed.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      const sandbox = await readSandbox(db, config, userId);
      return reply.status(201).send(sandbox);
    } finally {
      if (limited) {
        await perAddress.finish(key, made);
        await refusals.finish(key, !made);
      }
    }
  });

  app.get(v1('/demo/sandbox'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const sandbox = await readSandbox(db, config, actor.id);
    if (!sandbox) throw new HttpError('not_found', 'This account is not a demo sandbox.');
    return sandbox;
  });

  // "Start over": the sandbox goes now, as it would at the end of its hour.
  app.delete(v1('/demo/sandbox'), async (req, reply) => {
    const actor = await requireActor(auth, req, db);
    if (!(await readSandbox(db, config, actor.id)))
      throw new HttpError('not_found', 'This account is not a demo sandbox.');
    await endSandbox(demo, actor.id);
    return reply.status(204).send();
  });
}
