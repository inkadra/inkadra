import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import { API_PREFIX, AUTH_PREFIX, COLLAB_PATH } from '@inkadra/shared';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import type { Auth } from '../auth.ts';
import type { BoardReader } from '../board-content.ts';
import type { BoardNotifier } from '../board-notices.ts';
import type { BoardWriter } from '../board-writer.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import type { Jobs } from '../jobs.ts';
import { type Mailer, noMailer } from '../mailer.ts';
import { recordProblem, requestProblem } from '../monitor/problems.ts';
import type { LatencyRecorder } from '../monitor/sampler.ts';
import type { ServerDeps } from '../monitor/status.ts';
import { type MonitorStore, memoryStore } from '../monitor/store.ts';
import { rememberOrigin, requestIsSecure } from '../request-origin.ts';
import { DocViews } from '../share-links.ts';
import type { Storage } from '../storage.ts';
import type { VersionWriter } from '../versions.ts';
import { registerAccountRoutes } from './account-routes.ts';
import { registerApiRoutes } from './api-routes.ts';
import { registerAssetRoutes } from './assets-routes.ts';
import { registerAuthRoutes } from './auth-routes.ts';
import { registerBoardRoutes } from './boards-routes.ts';
import { registerCalendarRoutes } from './calendar-routes.ts';
import { registerClipRoutes } from './clip-routes.ts';
import { registerCommentRoutes } from './comments-routes.ts';
import { registerCrewRoutes } from './crew-routes.ts';
import { registerCsrfCheck } from './csrf.ts';
import { registerDemoRoutes } from './demo-routes.ts';
import { registerDiagnostics } from './diagnostics.ts';
import { errorHandler, HttpError, sendError } from './errors.ts';
import { registerExportSettingsRoutes } from './export-settings-routes.ts';
import { registerFeedbackRoutes } from './feedback-routes.ts';
import { registerGuestRoutes } from './guest-routes.ts';
import { registerInstanceAdminRoutes } from './instance-admin-routes.ts';
import { registerLinkPreviews } from './link-previews.ts';
import { registerMapPreviews } from './map-previews.ts';
import { registerMapTiles } from './map-tiles.ts';
import { registerNotificationRoutes } from './notifications-routes.ts';
import { containsNul } from './nul.ts';
import { registerProjectRoutes } from './projects-routes.ts';
import { registerReviewRoutes } from './reviews-routes.ts';
import { registerScheduleRoutes } from './schedule-routes.ts';
import { registerSearchRoutes } from './search-routes.ts';
import { securityHeaders } from './security-headers.ts';
import { registerServerRoutes } from './server-routes.ts';
import { GUEST_PAGE_PATH, registerShareLinkRoutes } from './share-links-routes.ts';
import { registerSharingRoutes } from './sharing-routes.ts';
import { registerTransferRoutes } from './transfers-routes.ts';
import { registerUploads } from './uploads.ts';
import { registerVersionRoutes } from './versions-routes.ts';

export interface AppDeps {
  /** Tests only: fake GitHub HTTP server. */
  feedbackGitHubUrl?: string;
  config: Config;
  db: Database;
  auth: Auth;
  log: Logger;
  storage: Storage;
  jobs: Jobs;
  /** Off when omitted (no SMTP). */
  mailer?: Mailer;
  pingQueue?: () => Promise<boolean>;
  /** Adds cards to board documents for the clip endpoint; without it clips are refused. */
  boards?: BoardWriter;
  /** Reads live cards after the route has authorized the board. */
  boardReader?: BoardReader;
  /** Named saves and restores of board versions; without it both are refused. */
  versions?: VersionWriter;
  /** Tells open boards about comment and review changes; without it nothing is sent. */
  notices?: BoardNotifier;
  /** Scratch space for files received in one piece (clips). */
  tmpDir?: string;
  /** Tests only: a stand-in for Cloudflare Turnstile and other demo archives. */
  turnstileFetch?: typeof import('../safe-fetch.ts').safeFetch;
  demoSeeds?: readonly string[];
  /** Tests only: addresses link previews may fetch besides public ones. */
  allowAddresses?: string[];
  /** The Server page (#514); in memory when omitted. */
  monitor?: {
    store: MonitorStore;
    latency?: LatencyRecorder;
    queues?: ServerDeps['queues'];
    redis?: ServerDeps['redis'];
  };
}

export async function createApp(deps: AppDeps) {
  const { config } = deps;
  const options: FastifyServerOptions = {
    loggerInstance: deps.log.child(
      {},
      {
        serializers: {
          req(req: FastifyRequest) {
            // These paths contain bearer credentials. Never persist them in request logs.
            const url = req.url.startsWith(`${API_PREFIX}/feedback/attachments/`)
              ? `${API_PREFIX}/feedback/attachments/[redacted]`
              : req.url.startsWith('/calendar/')
                ? '/calendar/[redacted].ics'
                : req.url.startsWith(GUEST_PAGE_PATH)
                  ? `${GUEST_PAGE_PATH}[redacted]`
                  : req.url.startsWith(`${API_PREFIX}/guest/by-token/`)
                    ? `${API_PREFIX}/guest/by-token/[redacted]`
                    : req.url;
            return { method: req.method, url, hostname: req.hostname, remoteAddress: req.ip };
          },
        },
      },
    ) as FastifyBaseLogger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  };
  const app = Fastify(options);

  app.setErrorHandler(errorHandler);
  app.addHook('onRequest', async (req, reply) => {
    try {
      rememberOrigin(req.raw, config.TRUST_PROXY);
    } catch {
      return sendError(reply, 'bad_request', 'Invalid request origin.');
    }
  });

  // Every route at once, after parsing: text with U+0000 is refused before it reaches PostgreSQL.
  app.addHook('preValidation', async (req) => {
    if (containsNul(req.body) || containsNul(req.query) || containsNul(req.params))
      throw new HttpError('bad_request', 'Text cannot contain the NUL character.');
  });

  app.addHook('onSend', async (req, reply) => {
    // A route's stricter policy stands: stored files are sandboxed whatever the page's policy is.
    for (const [name, value] of Object.entries(securityHeaders(config, requestIsSecure(req))))
      if (!reply.hasHeader(name)) reply.header(name, value);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    // The token of a share link is in the path of its guest page: it must not leak to the
    // sites of link cards nor into search engines (decision 0013).
    if (
      req.url.startsWith(GUEST_PAGE_PATH) ||
      req.url.startsWith('/calendar/') ||
      req.url.startsWith(`${API_PREFIX}/feedback/attachments/`)
    ) {
      reply.header('referrer-policy', 'no-referrer');
      reply.header('x-robots-tag', 'noindex, nofollow');
    } else reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  });

  const monitor = deps.monitor ?? { store: memoryStore() };
  app.addHook('onResponse', async (req, reply) => {
    if (!monitor.latency || !req.url.startsWith(API_PREFIX)) return;
    // JSON answers only: a file takes as long as its size, not as the server.
    const type = String(reply.getHeader('content-type') ?? '');
    if (reply.statusCode >= 500 || reply.statusCode === 204 || type.startsWith('application/json'))
      monitor.latency.record(reply.elapsedTime, reply.statusCode);
  });
  app.addHook('onError', async (req, _reply, err) => {
    if (err instanceof HttpError || err instanceof ZodError) return;
    const code = 'statusCode' in err ? err.statusCode : undefined;
    if (typeof code === 'number' && code < 500) return;
    recordProblem(
      monitor.store,
      requestProblem(req.routeOptions.url ?? 'unknown route', req.method, err),
      req.log,
    );
  });

  // Before every route: cross-site writes stop here (decision 0013).
  registerCsrfCheck(app, config.PUBLIC_URL);
  // The demo's allowlist, before any route can answer (decision 0084).
  registerDemoRoutes(app, deps);
  registerAuthRoutes(app, deps.auth, config.PUBLIC_URL);
  const mailer = deps.mailer ?? noMailer;
  registerApiRoutes(app, { ...deps, mailer });
  registerAccountRoutes(app, deps);
  registerInstanceAdminRoutes(app, deps);
  registerSharingRoutes(app, { ...deps, mailer });
  registerProjectRoutes(app, deps);
  registerExportSettingsRoutes(app, deps);
  registerBoardRoutes(app, deps);
  registerVersionRoutes(app, deps);
  registerAssetRoutes(app, deps);
  registerSearchRoutes(app, deps);
  registerLinkPreviews(app, deps);
  registerMapPreviews(app, deps);
  registerMapTiles(app, deps);
  registerDiagnostics(app, deps);
  registerServerRoutes(app, { ...deps, ...monitor });
  registerCommentRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerScheduleRoutes(app, deps);
  registerCrewRoutes(app, deps);
  registerNotificationRoutes(app, deps);
  registerCalendarRoutes(app, deps);
  registerFeedbackRoutes(app, deps);
  registerTransferRoutes(app, deps);
  registerUploads(app, { ...deps, uploadMaxSize: config.UPLOAD_MAX_SIZE });
  await registerClipRoutes(app, { ...deps, uploadMaxSize: config.UPLOAD_MAX_SIZE });
  // Share links and their guests (decision 0013) decode stored documents through one cache.
  const docs = new DocViews();
  registerShareLinkRoutes(app, { ...deps, docs });
  await registerGuestRoutes(app, { ...deps, docs });

  const webDist = config.WEB_DIST ? resolve(config.WEB_DIST) : undefined;
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      index: false,
      setHeaders(res, file) {
        // Vite fingerprints everything under /assets, so those files never change.
        const immutable = file.includes(`${sep}assets${sep}`);
        res.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0] ?? '/';
      const isApi =
        path.startsWith(API_PREFIX) ||
        path.startsWith(AUTH_PREFIX) ||
        path.startsWith('/calendar/');
      const isFile = path.startsWith('/assets/') || path.startsWith(COLLAB_PATH);
      // HEAD too: uptime monitors and proxies probe the site with it.
      if ((req.method !== 'GET' && req.method !== 'HEAD') || isApi || isFile)
        return sendError(reply, 'not_found', 'Not found.');
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => sendError(reply, 'not_found', 'Not found.'));
  }

  return app;
}
