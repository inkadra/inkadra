import { randomBytes } from 'node:crypto';
import type {
  LoadTestGuard,
  LoadTestPreset,
  LoadTestProgress,
  LoadTestReport,
  LoadTestRun,
} from '@inkadra/shared';
import { and, desc, eq, inArray, isNotNull, isNull, lt, notInArray, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { pseudonymizeAudit, recordAudit } from '../audit.ts';
import type { Database } from '../db/client.ts';
import {
  asset,
  instanceBackup,
  loadTestRun,
  project,
  projectTransfer,
  user,
} from '../db/schema.ts';
import { recordDeletions } from '../file-deletions.ts';
import { projectFiles } from '../http/projects-routes.ts';
import { database } from '../monitor/status.ts';
import { type MonitorStore, processKey } from '../monitor/store.ts';
import { issueToken } from '../tokens.ts';
import { runLoad } from './generator.ts';
import {
  evaluate,
  formatReport,
  PRESETS,
  percentile,
  type Result,
  type ServerReading,
} from './report.ts';

/**
 * Load tests from Settings → Server (#908): the CLI's load (#902) as a worker job of the instance
 * itself, one at a time, stopped when the people who use the instance feel it, and never leaving
 * its account or project behind.
 */

/** Finished runs kept for the page; older ones go once their data is cleaned up. */
export const HISTORY = 10;
/** The guard stops a run after this many readings in a row past one of its limits. */
export const GUARD: LoadTestGuard = {
  storeP95Ms: 2000,
  apiP95Ms: 2000,
  apiErrorRate: 0.05,
  editP95Ms: 3000,
};
export const GUARD_BREACHES = 2;
/** Fewer API answers than this in the window say nothing about an error rate. */
const GUARD_MIN_REQUESTS = 20;
/** A run does not start when the last minute already looked like this. */
export const BUSY = { apiP95Ms: 1000, storeP95Ms: 1000, cpu: 0.8 };
const BUSY_WINDOW_MS = 60_000;
/** API answers of the last this many ms count for the guard. */
const API_WINDOW_MS = 30_000;
export const HEARTBEAT_MS = 5_000;
/** A `running` row silent this long belongs to a process that is gone. */
export const STALE_MS = 6 * HEARTBEAT_MS;
/** A `scheduled` row this far past its time lost its job (a flushed Valkey). */
export const MISSED_MS = 15 * 60_000;
export const MAX_AHEAD_MS = 7 * 86_400_000;
const ALIVE_MS = 30_000;

export type LoadTestRow = typeof loadTestRun.$inferSelect;
const ACTIVE = ['scheduled', 'running'] as const;

export function toLoadTestRun(row: LoadTestRow): LoadTestRun {
  return {
    id: row.id,
    preset: row.preset,
    status: row.status,
    reason: row.reason,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    progress: row.progress ?? null,
    report: row.report ?? null,
    cleanedUp: row.cleanedAt !== null,
  };
}

export const presetList = () =>
  Object.entries(PRESETS).map(([name, p]) => ({
    name: name as LoadTestPreset,
    editors: p.editors,
    readers: p.readers,
    boards: p.boards,
    durationS: p.durationS,
  }));

/**
 * The moment of a wall-clock date and time in the server's time zone (the zone of this
 * process, as for the nightly backup). Null when it is past or more than 7 days ahead.
 */
export function scheduleTime(at: { date: string; time: string }, now = new Date()): Date | null {
  const [y, mo, d] = at.date.split('-').map(Number);
  const [h, mi] = at.time.split(':').map(Number);
  const when = new Date(y!, mo! - 1, d!, h!, mi!, 0, 0);
  // A time skipped by a clock change moves forward; one that never existed fails here.
  if (Number.isNaN(when.getTime())) return null;
  const ahead = when.getTime() - now.getTime();
  return ahead > 0 && ahead <= MAX_AHEAD_MS ? when : null;
}

/** A new run, unless one is scheduled or running (the partial unique index decides). */
export async function createRun(
  db: Database,
  input: { preset: LoadTestPreset; scheduledFor: Date | null; requestedBy: string },
): Promise<LoadTestRow | null> {
  await reapLoadTests(db);
  const rows = await db
    .insert(loadTestRun)
    .values({ ...input, status: 'scheduled' })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

/** No recent heartbeat from a role the guard reads: the run cannot see what people feel. */
export class NoMetrics extends Error {}

/**
 * True when a worker role runs apart from the web and collaboration roles. Otherwise (`all`
 * mode) the load clients share the event loop of the live server.
 */
export async function separateWorker(store: MonitorStore, now = Date.now()) {
  return (await store.beats()).some((b) => now - b.at < ALIVE_MS && b.role === 'worker');
}

/**
 * What the board roles report in their heartbeats, as the CLI reads it from /metrics. Throws
 * `NoMetrics` without a recent heartbeat of a collaboration role.
 */
export async function readBoardRoles(
  store: MonitorStore,
  db: Database,
  now = Date.now(),
): Promise<ServerReading> {
  const beats = (await store.beats()).filter(
    (b) => now - b.at < ALIVE_MS && (b.role === 'collab' || b.role === 'all'),
  );
  if (!beats.length) throw new NoMetrics('No heartbeat from the collaboration roles');
  const max = (values: Array<number | undefined>) => {
    const list = values.filter((v): v is number => v !== undefined);
    return list.length ? Math.max(...list) : null;
  };
  return {
    rssBytes: beats.reduce((n, b) => n + b.memory, 0),
    openBoards: beats.reduce((n, b) => n + (b.presence?.length ?? 0), 0),
    boardBytes: beats.some((b) => b.boardBytes !== undefined)
      ? beats.reduce((n, b) => n + (b.boardBytes ?? 0), 0)
      : null,
    shared: beats.some((b) => b.role === 'all'),
    storeP95Ms: max(beats.map((b) => b.stores?.p95)),
    storeMaxMs: max(beats.map((b) => b.stores?.max)),
    poolWaitMaxMs: max(beats.map((b) => b.stores?.waitMax)),
    dbConnections: (await database(db)).connections,
  };
}

/**
 * The API answers of the web roles over `windowMs`: the slowest p95 of a sample, answers and
 * server errors. shortcut: the test's own requests count too; in the run phase they are a tus
 * upload a minute per editor, whose chunks do not count (recordsLatency), so the rest is people.
 * Throws `NoMetrics` without a recent heartbeat of a web role.
 */
export async function readApi(store: MonitorStore, windowMs: number, now = Date.now()) {
  const beats = (await store.beats()).filter(
    (b) => now - b.at < ALIVE_MS && (b.role === 'web' || b.role === 'all'),
  );
  if (!beats.length) throw new NoMetrics('No heartbeat from the web roles');
  const points = await store.points('raw', beats.map(processKey), now - windowMs);
  let p95: number | null = null;
  let requests = 0;
  let errors = 0;
  let cpu = 0;
  for (const list of points.values())
    for (const p of list) {
      if (p.p95 != null) p95 = Math.max(p95 ?? 0, p.p95);
      requests += p.req ?? 0;
      errors += p.err ?? 0;
      if (p.cc > 0) cpu = Math.max(cpu, p.c / p.cc);
    }
  return { p95, requests, errors, cpu };
}

/**
 * A backup, an export or an import that is queued or running, or null. A load test does not
 * start next to one, and stops when one starts during it (the guard): the backup matters more.
 */
export async function otherWork(db: Database) {
  const [backup] = await db
    .select({ id: instanceBackup.id })
    .from(instanceBackup)
    .where(eq(instanceBackup.status, 'running'))
    .limit(1);
  if (backup) return 'backup_running';
  const [transfer] = await db
    .select({ id: projectTransfer.id })
    .from(projectTransfer)
    .where(inArray(projectTransfer.status, ['queued', 'running']))
    .limit(1);
  if (transfer) return 'transfer_running';
  return null;
}

/**
 * Why a run cannot start now, or null. Fails closed: without the heartbeats of the web and
 * collaboration roles (or when they cannot be read) the answer is `no_metrics`, since the guard
 * would be blind. `large` needs a worker role of its own (`shared_process`).
 */
export async function busyReason(
  db: Database,
  store: MonitorStore,
  preset?: LoadTestPreset,
  now = Date.now(),
) {
  try {
    const other = await otherWork(db);
    if (other) return other;
    if (preset === 'large' && !(await separateWorker(store, now))) return 'shared_process';
    const api = await readApi(store, BUSY_WINDOW_MS, now);
    if ((api.p95 ?? 0) > BUSY.apiP95Ms || api.cpu > BUSY.cpu) return 'under_load';
    const boards = await readBoardRoles(store, db, now);
    if ((boards.storeP95Ms ?? 0) > BUSY.storeP95Ms) return 'under_load';
    return null;
  } catch {
    return 'no_metrics';
  }
}

export interface GuardReading {
  /** False when a role's heartbeat is missing or could not be read: a breach (`no_metrics`). */
  metrics: boolean;
  storeP95Ms: number | null;
  apiP95Ms: number | null;
  apiRequests: number;
  apiErrors: number;
  editP95Ms: number | null;
}

/** The first guard limit a reading is past, or null. */
export function guardBreach(r: GuardReading, guard = GUARD): string | null {
  if (!r.metrics) return 'no_metrics';
  if ((r.storeP95Ms ?? 0) > guard.storeP95Ms) return 'store_slow';
  if ((r.apiP95Ms ?? 0) > guard.apiP95Ms) return 'api_slow';
  if (r.apiRequests >= GUARD_MIN_REQUESTS && r.apiErrors / r.apiRequests > guard.apiErrorRate)
    return 'api_errors';
  if ((r.editP95Ms ?? 0) > guard.editP95Ms) return 'edits_slow';
  return null;
}

/** Stops on the `GUARD_BREACHES`th reading in a row past a limit: one slow moment is not. */
export function makeGuard(guard = GUARD, breaches = GUARD_BREACHES) {
  let streak = 0;
  return (r: GuardReading): string | null => {
    const reason = guardBreach(r, guard);
    streak = reason ? streak + 1 : 0;
    return streak >= breaches ? reason : null;
  };
}

/** The CLI report's numbers and text, without the raw samples. */
export function toReport(result: Result): LoadTestReport {
  const limits = PRESETS[result.preset].limits;
  const failures = evaluate(result, limits);
  const times = (values: number[]) => ({
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    n: values.length,
  });
  return {
    preset: result.preset,
    durationS: result.durationS,
    editors: result.editors,
    readers: result.readers,
    boards: result.boards,
    edits: result.edits,
    switches: result.switches,
    uploads: result.uploads,
    editMs: times(result.editMs),
    deliveryMs: times(result.deliveryMs),
    errors: result.errors.length,
    reconnects: result.reconnects,
    server: result.server,
    limits,
    failures,
    text: formatReport(result, limits, failures),
  };
}

export interface LoadTestDeps {
  db: Database;
  store: MonitorStore;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Deletes stored files once their rows are gone (removeFilesLater). */
  removeFiles(keys: string[]): Promise<void>;
  /** Where the worker reaches the instance, and the public origin its requests carry. */
  target: { baseUrl: string; collabUrl?: string; origin: string };
  /** Worker shutdown: the run stops and cleans up before the process goes. */
  shutdown?: AbortSignal;
  /** Tests: a shorter run, a quicker heartbeat. */
  durationS?: number;
  heartbeatMs?: number;
}

/** Deletes the test project (boards, files) and account of a run, then marks it cleaned. */
export async function deleteTestData(
  deps: Pick<LoadTestDeps, 'db' | 'removeFiles' | 'log'>,
  row: Pick<LoadTestRow, 'id' | 'testUserId' | 'testProjectId'>,
) {
  const { db } = deps;
  const keys = await db.transaction(async (tx) => {
    // Also the projects the account made but the run never recorded (a crash between the
    // project's creation and onProject): by creator id, never by name.
    const made = row.testUserId
      ? await tx
          .select({ id: project.id })
          .from(project)
          .where(eq(project.createdBy, row.testUserId))
      : [];
    const projects = [
      ...new Set([...(row.testProjectId ? [row.testProjectId] : []), ...made.map((p) => p.id)]),
    ];
    // The projects, then their files, each in one order, as the account deletion does (#879).
    if (projects.length)
      await tx
        .select({ id: project.id })
        .from(project)
        .where(inArray(project.id, projects))
        .orderBy(project.id)
        .for('update');
    if (projects.length || row.testUserId)
      await tx
        .select({ id: asset.id })
        .from(asset)
        .where(
          or(
            projects.length ? inArray(asset.projectId, projects) : undefined,
            row.testUserId ? eq(asset.createdBy, row.testUserId) : undefined,
          ),
        )
        .orderBy(asset.id)
        .for('update');
    const files = await projectFiles(tx, projects);
    if (projects.length) await tx.delete(project).where(inArray(project.id, projects));
    if (row.testUserId) {
      await pseudonymizeAudit(tx, row.testUserId);
      // Sessions, tokens and memberships cascade.
      await tx.delete(user).where(eq(user.id, row.testUserId));
    }
    await recordDeletions(tx, files);
    await tx.update(loadTestRun).set({ cleanedAt: new Date() }).where(eq(loadTestRun.id, row.id));
    return files;
  });
  // Files go after the rows: a failure leaves orphan files, never rows without files.
  await deps
    .removeFiles(keys)
    .catch((err) => deps.log.warn({ err }, 'load test files not removed'));
}

/**
 * Marks runs whose process is gone: `running` with a silent heartbeat, `scheduled` long past
 * its time. Cheap; the page calls it before listing.
 */
export async function reapLoadTests(db: Database, staleMs = STALE_MS, now = Date.now()) {
  const stale = await db
    .update(loadTestRun)
    .set({ status: 'interrupted', finishedAt: new Date(now) })
    .where(
      or(
        and(
          eq(loadTestRun.status, 'running'),
          lt(loadTestRun.heartbeatAt, new Date(now - staleMs)),
        ),
        and(
          eq(loadTestRun.status, 'scheduled'),
          lt(loadTestRun.scheduledFor, new Date(now - MISSED_MS)),
        ),
        and(
          eq(loadTestRun.status, 'scheduled'),
          isNull(loadTestRun.scheduledFor),
          lt(loadTestRun.createdAt, new Date(now - MISSED_MS)),
        ),
      ),
    )
    .returning({ id: loadTestRun.id });
  return stale.length;
}

/**
 * At worker start and every 5 minutes: runs left by a crash or a restart are marked, and the test
 * data of every finished run is deleted (also a stop's or a failed cleanup's), then the history
 * is pruned.
 */
export async function sweepLoadTests(
  deps: Pick<LoadTestDeps, 'db' | 'removeFiles' | 'log'>,
  staleMs = STALE_MS,
) {
  const { db } = deps;
  const interrupted = await reapLoadTests(db, staleMs);
  const left = await db
    .select()
    .from(loadTestRun)
    .where(and(notInArray(loadTestRun.status, [...ACTIVE]), isNull(loadTestRun.cleanedAt)));
  let cleaned = 0;
  for (const row of left) {
    try {
      await deleteTestData(deps, row);
      cleaned += 1;
    } catch (err) {
      deps.log.error({ err, run: row.id }, 'load test data not deleted');
    }
  }
  await pruneHistory(db);
  if (interrupted || cleaned) deps.log.warn({ interrupted, cleaned }, 'load test data swept');
  return { interrupted, cleaned };
}

/** Keeps the newest `HISTORY` finished runs; one whose data is still there stays for the sweep. */
async function pruneHistory(db: Database) {
  const keep = await db
    .select({ id: loadTestRun.id })
    .from(loadTestRun)
    .orderBy(desc(loadTestRun.createdAt))
    .limit(HISTORY);
  await db.delete(loadTestRun).where(
    and(
      notInArray(loadTestRun.status, [...ACTIVE]),
      isNotNull(loadTestRun.cleanedAt),
      keep.length
        ? notInArray(
            loadTestRun.id,
            keep.map((k) => k.id),
          )
        : undefined,
    ),
  );
}

const finish = async (
  db: Database,
  id: string,
  set: Partial<typeof loadTestRun.$inferInsert> & { status: LoadTestRow['status'] },
) => {
  await db
    .update(loadTestRun)
    .set({ ...set, finishedAt: new Date() })
    .where(eq(loadTestRun.id, id));
  await recordAudit(db, {
    action: 'loadtest.finished',
    targetType: 'load_test',
    targetId: id,
    details: { status: set.status, reason: set.reason ?? null },
  }).catch(() => {});
};

/** The worker job: claims a scheduled run, runs it, writes the report, deletes the data. */
export async function runLoadTestJob(deps: LoadTestDeps, id: string) {
  const { db, store, log } = deps;
  const now = new Date();
  const [row] = await db
    .update(loadTestRun)
    .set({ status: 'running', startedAt: now, heartbeatAt: now })
    .where(and(eq(loadTestRun.id, id), eq(loadTestRun.status, 'scheduled')))
    .returning();
  // Cancelled, or delivered again after it ran: nothing to do.
  if (!row) return { skipped: true };
  const busy = await busyReason(db, store, row.preset);
  if (busy) {
    await finish(db, id, { status: 'refused', reason: busy, cleanedAt: new Date() });
    return { refused: busy };
  }
  const preset = PRESETS[row.preset];
  const stop = new AbortController();
  const onShutdown = () => stop.abort();
  deps.shutdown?.addEventListener('abort', onShutdown);
  let latest: LoadTestProgress | null = null;
  let apiP95Ms: number | null = null;
  // Whether the last reading of the board roles came: missing, the guard counts a breach.
  let boardsRead = true;
  const beat = async () => {
    const [current] = await db
      .update(loadTestRun)
      .set({ heartbeatAt: new Date(), ...(latest ? { progress: latest } : {}) })
      .where(and(eq(loadTestRun.id, id), eq(loadTestRun.status, 'running')))
      .returning({ stop: loadTestRun.stopRequestedAt });
    // Stopped from the page, or marked interrupted by someone who thought this process gone.
    if (!current || current.stop) stop.abort();
  };
  const heartbeat = setInterval(
    () => void beat().catch((err) => log.warn({ err }, 'load test heartbeat not saved')),
    deps.heartbeatMs ?? HEARTBEAT_MS,
  );
  const guard = makeGuard();
  let outcome: Awaited<ReturnType<typeof runLoad>> | null = null;
  let failure: unknown = null;
  try {
    // The test account: made here, so the run needs neither open registration nor a password.
    const short = randomBytes(4).toString('hex');
    const token = await db.transaction(async (tx) => {
      const [made] = await tx
        .insert(user)
        .values({
          name: `Load test ${short}`,
          email: `loadtest-${short}-${id.slice(0, 8)}@example.invalid`,
          emailVerified: true,
          canCreateProjects: true,
          storageLimit: 0,
        })
        .returning({ id: user.id });
      if (!made) throw new Error('Test account insert returned nothing');
      await tx.update(loadTestRun).set({ testUserId: made.id }).where(eq(loadTestRun.id, id));
      return (await issueToken(tx, made.id, { name: 'Load test' })).token;
    });
    outcome = await runLoad({
      baseUrl: deps.target.baseUrl,
      ...(deps.target.collabUrl ? { collabUrl: deps.target.collabUrl } : {}),
      origin: deps.target.origin,
      auth: { token },
      presetName: row.preset,
      preset,
      durationS: deps.durationS ?? preset.durationS,
      signal: stop.signal,
      scrape: async () => {
        try {
          const reading = await readBoardRoles(store, db);
          boardsRead = true;
          return reading;
        } catch (err) {
          boardsRead = false;
          throw err;
        }
      },
      log: (line) => log.info({ run: id }, line),
      onProject: async (projectId) => {
        await db
          .update(loadTestRun)
          .set({ testProjectId: projectId })
          .where(eq(loadTestRun.id, id));
      },
      onProgress: (p) => {
        latest = { ...p, apiP95Ms };
      },
      guard: async (p) => {
        // A backup, export or import that starts during the run stops it at once.
        const other = await otherWork(db).catch(() => null);
        if (other) return other;
        const api = await readApi(store, API_WINDOW_MS).catch(() => null);
        apiP95Ms = api?.p95 ?? null;
        latest = { ...p, apiP95Ms };
        return guard({
          metrics: boardsRead && api !== null,
          storeP95Ms: p.storeP95Ms,
          apiP95Ms,
          apiRequests: api?.requests ?? 0,
          apiErrors: api?.errors ?? 0,
          editP95Ms: p.editP95Ms,
        });
      },
    });
  } catch (err) {
    failure = err;
    log.error({ err, run: id }, 'load test failed');
  } finally {
    clearInterval(heartbeat);
    deps.shutdown?.removeEventListener('abort', onShutdown);
  }
  const [after] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, id));
  try {
    if (after) await deleteTestData(deps, after);
  } catch (err) {
    // The sweep (every 5 minutes) and the next start try again.
    log.error({ err, run: id }, 'load test data not deleted');
  }
  const report = outcome ? toReport(outcome.result) : null;
  const status: LoadTestRow['status'] = failure
    ? 'failed'
    : deps.shutdown?.aborted || after?.status === 'interrupted'
      ? 'interrupted'
      : after?.stopRequestedAt
        ? 'stopped'
        : outcome?.aborted
          ? 'aborted'
          : report?.failures.length
            ? 'failed'
            : 'passed';
  await finish(db, id, {
    status,
    reason: failure ? 'internal' : (outcome?.aborted ?? null),
    report,
    ...(latest ? { progress: latest } : {}),
  });
  await pruneHistory(db).catch(() => {});
  return { status };
}

/** The newest runs, for the page. */
export async function listLoadTests(db: Database) {
  await reapLoadTests(db);
  const rows = await db
    .select()
    .from(loadTestRun)
    .orderBy(desc(loadTestRun.createdAt))
    .limit(HISTORY);
  return rows.map(toLoadTestRun);
}
