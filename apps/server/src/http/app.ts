import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import { API_PREFIX, AUTH_PREFIX, COLLAB_PATH } from '@inkadra/shared';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Logger } from 'pino';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { registerApiRoutes } from './api-routes.ts';
import { registerAuthRoutes } from './auth-routes.ts';
import { errorHandler, sendError } from './errors.ts';

export interface AppDeps {
  config: Config;
  db: Database;
  auth: Auth;
  log: Logger;
  pingQueue?: () => Promise<boolean>;
}

export async function createApp(deps: AppDeps) {
  const { config } = deps;
  const app = Fastify({
    loggerInstance: deps.log as FastifyBaseLogger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.setErrorHandler(errorHandler);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'DENY');
  });

  registerAuthRoutes(app, deps.auth, config.PUBLIC_URL);
  registerApiRoutes(app, deps);

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
