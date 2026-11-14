import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  API_PREFIX,
  type DiagnosticCheck,
  ServerStatusQuery,
  UpdateServerAlerts,
  z,
} from '@inkadra/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.ts';
import { saveServerAlerts } from '../monitor/alerts.ts';
import { collectMetrics, renderMetrics } from '../monitor/metrics.ts';
import { retryProblem, type ServerDeps, serverLive, serverStatus } from '../monitor/status.ts';
import { safeEqual } from '../secrets.ts';
import type { Storage } from '../storage.ts';
import { requireSession } from './auth-routes.ts';
import { runChecks } from './diagnostics.ts';
import { HttpError } from './errors.ts';

const ProblemParams = z.object({ problemId: z.string().min(1).max(200) });
/** The checks write a probe file to the storage: once a minute is plenty for a page that polls. */
const CHECKS_MS = 60_000;

/** The Server page of the settings (#514): administrators only, from a signed-in session. */
export function registerServerRoutes(
  app: FastifyInstance,
  deps: ServerDeps & { auth: Auth; storage: Storage; pingQueue?: () => Promise<boolean> },
) {
  const { db, auth, store } = deps;
  const admin = async (req: FastifyRequest) => {
    const { user: actor } = await requireSession(auth, req, db);
    if (actor.role !== 'admin') throw new HttpError('forbidden', 'Administrators only.');
    return actor;
  };
  let checks: { at: number; list: DiagnosticCheck[] } | null = null;

  // Prometheus (#817): only with METRICS_TOKEN set, and only for that bearer token.
  const metricsToken = deps.config.METRICS_TOKEN;
  const loop = metricsToken ? monitorEventLoopDelay() : undefined;
  loop?.enable();
  app.get('/metrics', { logLevel: 'warn' }, async (req, reply) => {
    if (!metricsToken) throw new HttpError('not_found', 'Not found.');
    if (!safeEqual(req.headers.authorization ?? '', `Bearer ${metricsToken}`))
      throw new HttpError('unauthorized', 'A valid metrics token is required.');
    return reply
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(renderMetrics(await collectMetrics(deps, loop)));
  });

  app.get(`${API_PREFIX}/instance/server`, async (req) => {
    const actor = await admin(req);
    const { range } = ServerStatusQuery.parse(req.query ?? {});
    if (!checks || Date.now() - checks.at > CHECKS_MS)
      checks = { at: Date.now(), list: await runChecks(deps, req) };
    return serverStatus(deps, actor.id, range, checks.list);
  });

  // Every few seconds while the page is open: the monitor store only, never the database
  // aggregates of the full status.
  app.get(`${API_PREFIX}/instance/server/live`, async (req) => {
    await admin(req);
    const { range } = ServerStatusQuery.parse(req.query ?? {});
    return serverLive(store, range);
  });

  app.patch(`${API_PREFIX}/instance/server/alerts`, async (req) => {
    await admin(req);
    return saveServerAlerts(db, UpdateServerAlerts.parse(req.body ?? {}));
  });

  app.post(`${API_PREFIX}/instance/server/problems/seen`, async (req, reply) => {
    await admin(req);
    const now = Date.now();
    for (const p of await store.problems()) await store.update(p.id, { seenAt: now });
    return reply.status(204).send();
  });

  app.post(`${API_PREFIX}/instance/server/problems/retry`, async (req) => {
    await admin(req);
    let retried = 0;
    for (const p of await store.problems()) {
      if (p.seenAt !== null && p.seenAt >= p.lastAt) continue;
      if (await retryProblem(deps, p).catch(() => false)) {
        retried += 1;
        await store.update(p.id, { seenAt: Date.now() });
      }
    }
    return { retried };
  });

  app.post(`${API_PREFIX}/instance/server/problems/:problemId/seen`, async (req, reply) => {
    await admin(req);
    const { problemId } = ProblemParams.parse(req.params);
    const found = (await store.problems()).find((p) => p.id === problemId);
    if (!found) throw new HttpError('not_found', 'No such problem.');
    await store.update(problemId, { seenAt: Date.now() });
    return reply.status(204).send();
  });

  app.post(`${API_PREFIX}/instance/server/problems/:problemId/retry`, async (req, reply) => {
    await admin(req);
    const { problemId } = ProblemParams.parse(req.params);
    const found = (await store.problems()).find((p) => p.id === problemId);
    if (!found) throw new HttpError('not_found', 'No such problem.');
    if (!(await retryProblem(deps, found)))
      throw new HttpError('conflict', 'This job is gone or cannot run again.');
    // Out of the list until it fails again.
    await store.update(problemId, { seenAt: Date.now() });
    return reply.status(202).send();
  });
}
