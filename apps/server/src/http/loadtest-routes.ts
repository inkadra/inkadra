import { API_PREFIX, Id, type LoadTests, StartLoadTest, z } from '@inkadra/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { recordAudit } from '../audit.ts';
import type { Auth } from '../auth.ts';
import { serverTimeZone } from '../backup.ts';
import type { Database } from '../db/client.ts';
import { loadTestRun } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import {
  busyReason,
  createRun,
  GUARD,
  listLoadTests,
  presetList,
  scheduleTime,
  toLoadTestRun,
} from '../loadtest/runs.ts';
import type { MonitorStore } from '../monitor/store.ts';
import { ENQUEUE_TIMEOUT_MS, within } from '../queues.ts';
import { requireSession } from './auth-routes.ts';
import { HttpError } from './errors.ts';

const RunParams = z.object({ runId: Id });

/** The load test of Settings → Server (#908): administrators only, from a signed-in session. */
export function registerLoadTestRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: Auth; jobs: Jobs; store: MonitorStore },
) {
  const { db, auth, jobs, store } = deps;
  const admin = async (req: FastifyRequest) => {
    const { user: actor } = await requireSession(auth, req, db);
    if (actor.role !== 'admin') throw new HttpError('forbidden', 'Administrators only.');
    return actor;
  };
  const busy = (reason: string, message: string) => new HttpError('conflict', message, { reason });

  app.get(`${API_PREFIX}/instance/load-tests`, async (req) => {
    await admin(req);
    return {
      available: Boolean(jobs.runLoadTest),
      timeZone: serverTimeZone(),
      presets: presetList(),
      guard: GUARD,
      items: await listLoadTests(db),
    } satisfies LoadTests;
  });

  app.post(`${API_PREFIX}/instance/load-tests`, async (req, reply) => {
    const actor = await admin(req);
    const input = StartLoadTest.parse(req.body ?? {});
    if (!jobs.runLoadTest) throw busy('no_worker', 'Load tests need a worker (REDIS_URL).');
    const scheduledFor = input.at ? scheduleTime(input.at) : null;
    if (input.at && !scheduledFor)
      throw new HttpError('bad_request', 'Choose a time in the next 7 days.');
    // Started now: refused at once rather than queued to be refused; a scheduled run checks
    // again when its time comes.
    if (!scheduledFor) {
      const reason = await busyReason(db, store);
      if (reason) throw busy(reason, 'The instance is busy: try again later.');
    }
    const row = await createRun(db, { preset: input.preset, scheduledFor, requestedBy: actor.id });
    if (!row) throw busy('loadtest_running', 'A load test is already scheduled or running.');
    try {
      await within(
        jobs.runLoadTest(row.id, scheduledFor ? scheduledFor.getTime() - Date.now() : 0),
        ENQUEUE_TIMEOUT_MS,
        'The job queue did not answer.',
      );
    } catch (err) {
      // Without its job the row would block every later run.
      await db.delete(loadTestRun).where(eq(loadTestRun.id, row.id));
      throw err;
    }
    await recordAudit(db, {
      action: 'loadtest.started',
      actorId: actor.id,
      targetType: 'load_test',
      targetId: row.id,
      ip: req.ip,
      details: { preset: row.preset, scheduledFor: row.scheduledFor?.toISOString() ?? null },
    }).catch((err) => req.log.error({ err }, 'audit event not recorded'));
    return reply.status(202).send(toLoadTestRun(row));
  });

  // A scheduled run is cancelled; a running one stops at its next heartbeat and cleans up.
  app.post(`${API_PREFIX}/instance/load-tests/:runId/stop`, async (req) => {
    const actor = await admin(req);
    const { runId } = RunParams.parse(req.params);
    const [cancelled] = await db
      .update(loadTestRun)
      .set({ status: 'cancelled', finishedAt: new Date(), cleanedAt: new Date() })
      .where(and(eq(loadTestRun.id, runId), eq(loadTestRun.status, 'scheduled')))
      .returning();
    const [stopping] = cancelled
      ? [cancelled]
      : await db
          .update(loadTestRun)
          .set({ stopRequestedAt: new Date() })
          .where(and(eq(loadTestRun.id, runId), eq(loadTestRun.status, 'running')))
          .returning();
    if (!stopping) {
      const [exists] = await db
        .select({ id: loadTestRun.id })
        .from(loadTestRun)
        .where(eq(loadTestRun.id, runId));
      if (!exists) throw new HttpError('not_found', 'No such load test.');
      throw new HttpError('conflict', 'This load test is over.');
    }
    if (cancelled)
      await jobs.cancelLoadTest?.(runId).catch((err) => req.log.warn({ err }, 'job not removed'));
    await recordAudit(db, {
      action: 'loadtest.stopped',
      actorId: actor.id,
      targetType: 'load_test',
      targetId: runId,
      ip: req.ip,
      details: { preset: stopping.preset, cancelled: Boolean(cancelled) },
    }).catch((err) => req.log.error({ err }, 'audit event not recorded'));
    return toLoadTestRun(stopping);
  });
}
