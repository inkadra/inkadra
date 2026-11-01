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
import type { Auth } from '../auth.ts';
import type { BoardReader } from '../board-content.ts';
import type { BoardNotifier } from '../board-notices.ts';
import type { BoardWriter } from '../board-writer.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import type { Jobs } from '../jobs.ts';
import { type Mailer, noMailer } from '../mailer.ts';
import { rememberOrigin, requestIsSecure } from '../request-origin.ts';
import { DocViews } from '../share-links.ts';
import type { Storage } from '../storage.ts';
import type { VersionWriter } from '../versions.ts';
import { registerAccountRoutes } from './account-routes.ts';
import { registerApiRoutes } from './api-routes.ts';
import { registerAssetRoutes } from './assets-routes.ts';
import { registerAuthRoutes } from './auth-routes.ts';
import { registerBoardRoutes } from './boards-routes.ts';
import { registerClipRoutes } from './clip-routes.ts';
import { registerCommentRoutes } from './comments-routes.ts';
import { registerCsrfCheck } from './csrf.ts';
import { registerDiagnostics } from './diagnostics.ts';
import { errorHandler, sendError } from './errors.ts';
import { registerExportSettingsRoutes } from './export-settings-routes.ts';
import { registerGuestRoutes } from './guest-routes.ts';
import { registerInstanceAdminRoutes } from './instance-admin-routes.ts';
import { registerLinkPreviews } from './link-previews.ts';
import { registerMapPreviews } from './map-previews.ts';
import { registerNotificationRoutes } from './notifications-routes.ts';
import { registerProjectRoutes } from './projects-routes.ts';
import { registerReviewRoutes } from './reviews-routes.ts';
import { registerScheduleRoutes } from './schedule-routes.ts';
import { registerSearchRoutes } from './search-routes.ts';
import { securityHeaders } from './security-headers.ts';
import { GUEST_PAGE_PATH, registerShareLinkRoutes } from './share-links-routes.ts';
import { registerSharingRoutes } from './sharing-routes.ts';
import { registerTransferRoutes } from './transfers-routes.ts';
import { registerUploads } from './uploads.ts';
import { registerVersionRoutes } from './versions-routes.ts';

export interface AppDeps {
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
  /** Tests only: addresses link previews may fetch besides public ones. */
  allowAddresses?: string[];
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
            const url = req.url.startsWith(GUEST_PAGE_PATH)
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

  app.addHook('onSend', async (req, reply) => {
    for (const [name, value] of Object.entries(securityHeaders(config, requestIsSecure(req))))
      reply.header(name, value);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    // The token of a share link is in the path of its guest page: it must not leak to the
    // sites of link cards nor into search engines (decision 0013).
    if (req.url.startsWith(GUEST_PAGE_PATH)) {
      reply.header('referrer-policy', 'no-referrer');
      reply.header('x-robots-tag', 'noindex, nofollow');
    } else reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  });

  // Before every route: cross-site writes stop here (decision 0013).
  registerCsrfCheck(app, config.PUBLIC_URL);
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
  registerDiagnostics(app, deps);
  registerCommentRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerScheduleRoutes(app, deps);
  registerNotificationRoutes(app, deps);
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
      const isApi = path.startsWith(API_PREFIX) || path.startsWith(AUTH_PREFIX);
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
