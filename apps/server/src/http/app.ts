import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import { API_PREFIX, AUTH_PREFIX, COLLAB_PATH } from '@inkadra/shared';
import Fastify, { type FastifyBaseLogger, type FastifyServerOptions } from 'fastify';
import type { Logger } from 'pino';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import type { Jobs } from '../jobs.ts';
import { type Mailer, noMailer } from '../mailer.ts';
import type { Storage } from '../storage.ts';
import { registerAccountRoutes } from './account-routes.ts';
import { registerApiRoutes } from './api-routes.ts';
import { registerAssetRoutes } from './assets-routes.ts';
import { registerAuthRoutes } from './auth-routes.ts';
import { registerBoardRoutes } from './boards-routes.ts';
import { registerDiagnostics } from './diagnostics.ts';
import { errorHandler, sendError } from './errors.ts';
import { registerLinkPreviews } from './link-previews.ts';
import { registerProjectRoutes } from './projects-routes.ts';
import { registerSharingRoutes } from './sharing-routes.ts';
import { registerUploads } from './uploads.ts';

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
  /** Tests only: addresses link previews may fetch besides public ones. */
  allowAddresses?: string[];
}

export async function createApp(deps: AppDeps) {
  const { config } = deps;
  const options: FastifyServerOptions = {
    loggerInstance: deps.log as FastifyBaseLogger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  };
  const app = Fastify(options);

  app.setErrorHandler(errorHandler);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'DENY');
  });

  registerAuthRoutes(app, deps.auth, config.PUBLIC_URL);
  const mailer = deps.mailer ?? noMailer;
  registerApiRoutes(app, { ...deps, mailer });
  registerAccountRoutes(app, deps);
  registerSharingRoutes(app, { ...deps, mailer });
  registerProjectRoutes(app, deps);
  registerBoardRoutes(app, deps);
  registerAssetRoutes(app, deps);
  registerLinkPreviews(app, deps);
  registerDiagnostics(app, deps);
  registerUploads(app, { ...deps, uploadMaxSize: config.UPLOAD_MAX_SIZE });

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
      if (req.method !== 'GET' || isApi || isFile)
        return sendError(reply, 'not_found', 'Not found.');
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => sendError(reply, 'not_found', 'Not found.'));
  }

  return app;
}
