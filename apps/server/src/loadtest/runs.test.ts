import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { LoadTests, LoadTestRun as RunSchema } from '@inkadra/shared';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../auth.ts';
import { attachCollab, createCollabServer } from '../collab.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  auditEvent,
  instanceBackup,
  loadTestRun,
  personalToken,
  project,
  user,
} from '../db/schema.ts';
import { createApp } from '../http/app.ts';
import { type MonitorStore, memoryStore } from '../monitor/store.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { runLoad } from './generator.ts';
import { PRESETS, type Result } from './report.ts';
import {
  busyReason,
  deleteTestData,
  GUARD,
  guardBreach,
  HISTORY,
  MAX_AHEAD_MS,
  makeGuard,
  reapLoadTests,
  runLoadTestJob,
  scheduleTime,
  sweepLoadTests,
  toReport,
} from './runs.ts';

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const url = process.env.DATABASE_URL;

/** Heartbeats of a running role, every second as long as the test needs them. */
const alive = (store: MonitorStore, role: 'all' | 'web' | 'collab' | 'worker' = 'all') => {
  const beat = () => {
    const at = Date.now();
    void store.beat({ role, host: `${role}-1`, startedAt: at - 60_000, at, cpu: 0, memory: 1 });
  };
  beat();
  return setInterval(beat, 1000);
};

describe('scheduleTime (#908)', () => {
  const now = new Date(2026, 10, 15, 14, 30);
  it('reads the date and time in the server time zone', () => {
    expect(scheduleTime({ date: '2026-11-16', time: '03:00' }, now)).toEqual(
      new Date(2026, 10, 16, 3, 0),
    );
  });
  it('refuses a time already past and one more than 7 days ahead', () => {
    expect(scheduleTime({ date: '2026-11-15', time: '14:30' }, now)).toBeNull();
    expect(scheduleTime({ date: '2026-11-14', time: '23:00' }, now)).toBeNull();
    expect(scheduleTime({ date: '2026-11-23', time: '14:31' }, now)).toBeNull();
    expect(scheduleTime({ date: '2026-11-22', time: '14:30' }, now)?.getTime()).toBeLessThanOrEqual(
      now.getTime() + MAX_AHEAD_MS,
    );
  });
});

describe('the guard (#908)', () => {
  const calm = {
    metrics: true,
    storeP95Ms: 40,
    apiP95Ms: 80,
    apiRequests: 100,
    apiErrors: 0,
    editP95Ms: 5,
  };
  it('names the first limit a reading is past', () => {
    expect(guardBreach(calm)).toBeNull();
    expect(guardBreach({ ...calm, storeP95Ms: GUARD.storeP95Ms + 1 })).toBe('store_slow');
    expect(guardBreach({ ...calm, apiP95Ms: GUARD.apiP95Ms + 1 })).toBe('api_slow');
    expect(guardBreach({ ...calm, apiErrors: 6 })).toBe('api_errors');
    expect(guardBreach({ ...calm, editP95Ms: GUARD.editP95Ms + 1 })).toBe('edits_slow');
  });
  it('counts a missing reading as a breach, with the same two-in-a-row rule', () => {
    expect(guardBreach({ ...calm, metrics: false })).toBe('no_metrics');
    const guard = makeGuard();
    expect(guard({ ...calm, metrics: false })).toBeNull();
    expect(guard(calm)).toBeNull();
    expect(guard({ ...calm, metrics: false })).toBeNull();
    expect(guard({ ...calm, metrics: false })).toBe('no_metrics');
  });
  it('ignores the error rate of a handful of answers', () => {
    expect(guardBreach({ ...calm, apiRequests: 4, apiErrors: 2 })).toBeNull();
  });
  it('stops on the second reading in a row, not on one slow moment', () => {
    const guard = makeGuard();
    const slow = { ...calm, storeP95Ms: 5000 };
    expect(guard(slow)).toBeNull();
    expect(guard(calm)).toBeNull();
    expect(guard(slow)).toBeNull();
    expect(guard(slow)).toBe('store_slow');
  });
});

describe('toReport (#908)', () => {
  it('keeps the fields and limits of the CLI report, without the samples', () => {
    const result: Result = {
      preset: 'small',
      url: 'http://localhost:3000',
      durationS: 60,
      editors: 5,
      readers: 2,
      boards: 50,
      edits: 10,
      editMs: [1, 2, 3, 900],
      deliveryMs: [2],
      switches: 3,
      uploads: { ok: 1, failed: 0 },
      errors: [],
      reconnects: 0,
      server: null,
    };
    const report = toReport(result);
    expect(report.limits).toEqual(PRESETS.small.limits);
    expect(report.editMs).toEqual({ p50: 2, p95: 900, p99: 900, n: 4 });
    expect(report.failures).toEqual(['edit round trip p95 900 ms > 500 ms']);
    expect(report.text).toContain('FAILED');
    expect(report).not.toHaveProperty('editMs.length');
  });
});

describe.skipIf(!url)('load tests from Settings → Server (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 6);
  const store = memoryStore();
  const runLoadTest = vi.fn(async (_id: string, _delay: number) => {});
  const cancelLoadTest = vi.fn(async (_id: string) => {});
  let app: Awaited<ReturnType<typeof createApp>>;
  let collab: ReturnType<typeof createCollabServer>;
  let base = '';
  const people: Record<string, string> = {};
  // The instance's own roles beat for the whole suite (`all` mode).
  let beating: ReturnType<typeof setInterval> | undefined;

  const request = (as: string | null, method: 'GET' | 'POST', path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: as ? { cookie: people[as] ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload }),
    });
  const jobDeps = () => ({
    db,
    store,
    log,
    removeFiles: async () => {},
    target: { baseUrl: base, origin: config.PUBLIC_URL },
    heartbeatMs: 200,
  });

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrations);
    await db.execute(
      sql`truncate table "user", project, load_test_run, instance_backup, project_transfer, audit_event cascade`,
    );
    const deps = testDeps(db, log);
    const auth = createAuth(config, db);
    collab = createCollabServer({ db, auth, log, publicUrl: config.PUBLIC_URL });
    app = await createApp({
      config: { ...config, DATA_DIR: deps.root },
      db,
      auth,
      log,
      ...deps,
      jobs: { ...deps.jobs, runLoadTest, cancelLoadTest },
      monitor: { store },
    });
    attachCollab(app.server, collab);
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    for (const name of ['admin', 'member']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
      });
      people[name] = String(response.headers['set-cookie']).split(';')[0] ?? '';
    }
    await db.update(user).set({ role: 'admin' }).where(eq(user.email, 'admin@example.com'));
    beating = alive(store);
  });
  beforeEach(async () => {
    await db.delete(loadTestRun);
    await db.delete(instanceBackup);
    runLoadTest.mockClear();
    cancelLoadTest.mockClear();
  });
  afterAll(async () => {
    clearInterval(beating);
    await collab?.destroy();
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('is for administrators with a session only, and says so in the capabilities', async () => {
    expect((await request(null, 'GET', '/instance/load-tests')).statusCode).toBe(401);
    expect((await request('member', 'GET', '/instance/load-tests')).statusCode).toBe(403);
    expect(
      (await request('member', 'POST', '/instance/load-tests', { preset: 'small' })).statusCode,
    ).toBe(403);
    const page = await request('admin', 'GET', '/instance/load-tests');
    expect(page.statusCode).toBe(200);
    const body = LoadTests.parse(page.json());
    expect(body.available).toBe(true);
    expect(body.presets.map((p) => p.name)).toEqual(['small', 'medium', 'large']);
    const version = await request('admin', 'GET', '/instance/version');
    expect(version.json().capabilities).toContain('load-test');
    expect(runLoadTest).not.toHaveBeenCalled();
  });

  it('starts one run at a time, records it, and cancels a scheduled one', async () => {
    const now = await request('admin', 'POST', '/instance/load-tests', { preset: 'small' });
    expect(now.statusCode).toBe(202);
    const run = RunSchema.parse(now.json());
    expect(run).toMatchObject({ status: 'scheduled', scheduledFor: null, cleanedUp: false });
    expect(runLoadTest).toHaveBeenCalledWith(run.id, 0);
    const second = await request('admin', 'POST', '/instance/load-tests', { preset: 'medium' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.details).toEqual({ reason: 'loadtest_running' });

    const stop = await request('admin', 'POST', `/instance/load-tests/${run.id}/stop`);
    expect(stop.json()).toMatchObject({ status: 'cancelled', cleanedUp: true });
    expect(cancelLoadTest).toHaveBeenCalledWith(run.id);
    expect((await request('admin', 'POST', `/instance/load-tests/${run.id}/stop`)).statusCode).toBe(
      409,
    );
    const actions = await db
      .select({ action: auditEvent.action })
      .from(auditEvent)
      .where(eq(auditEvent.targetId, run.id));
    expect(actions.map((a) => a.action).sort()).toEqual(['loadtest.started', 'loadtest.stopped']);
  });

  it('schedules a run at a time of the server time zone', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const later = await request('admin', 'POST', '/instance/load-tests', {
      preset: 'medium',
      at: { date, time: '03:00' },
    });
    expect(later.statusCode).toBe(202);
    const expected = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 3);
    expect(later.json().scheduledFor).toBe(expected.toISOString());
    const delay = runLoadTest.mock.calls[0]?.[1] ?? 0;
    expect(Math.abs(delay - (expected.getTime() - Date.now()))).toBeLessThan(5000);
    const past = await request('admin', 'POST', '/instance/load-tests', {
      preset: 'small',
      at: { date: '2020-01-01', time: '03:00' },
    });
    expect(past.statusCode).toBe(400);
  });

  it('refuses to start while a backup runs', async () => {
    await db.insert(instanceBackup).values({ trigger: 'manual' });
    const busy = await request('admin', 'POST', '/instance/load-tests', { preset: 'small' });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.details).toEqual({ reason: 'backup_running' });
    expect(runLoadTest).not.toHaveBeenCalled();
  });

  it('refuses when the instance is under load already', async () => {
    // A store of its own: the runs below must not see this load.
    const store = memoryStore();
    const at = Date.now();
    await store.beat({ role: 'web', host: 'w1', startedAt: at - 60_000, at, cpu: 0, memory: 1 });
    await store.push('raw', 'web@w1', {
      t: at - 5000,
      c: 0.2,
      cc: 4,
      m: 1,
      ml: null,
      rx: null,
      tx: null,
      pc: 0.1,
      pm: 1,
      p95: 4000,
      req: 50,
      err: 0,
    });
    expect(await busyReason(db, store)).toBe('under_load');
  });

  it('fails closed: no start without the heartbeats the guard reads', async () => {
    // No role beats at all, only a worker, or a monitor that cannot be read.
    expect(await busyReason(db, memoryStore())).toBe('no_metrics');
    const worker = memoryStore();
    const beats = alive(worker, 'worker');
    try {
      expect(await busyReason(db, worker)).toBe('no_metrics');
    } finally {
      clearInterval(beats);
    }
    const broken = {
      ...memoryStore(),
      beats: async () => {
        throw new Error('Valkey is down');
      },
    } as MonitorStore;
    expect(await busyReason(db, broken)).toBe('no_metrics');
    expect(await busyReason(db, store)).toBeNull();
    // The scheduled job refuses as well.
    const [row] = await db
      .insert(loadTestRun)
      .values({ preset: 'small', status: 'scheduled' })
      .returning();
    expect(await runLoadTestJob({ ...jobDeps(), store: memoryStore() }, row!.id)).toEqual({
      refused: 'no_metrics',
    });
  });

  it('keeps large for a separate worker role: the load would share the server otherwise', async () => {
    const page = LoadTests.parse((await request('admin', 'GET', '/instance/load-tests')).json());
    expect(page.separateWorker).toBe(false);
    const refused = await request('admin', 'POST', '/instance/load-tests', { preset: 'large' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({ reason: 'shared_process' });
    expect(await busyReason(db, store, 'large')).toBe('shared_process');
    const worker = alive(store, 'worker');
    try {
      const page = LoadTests.parse((await request('admin', 'GET', '/instance/load-tests')).json());
      expect(page.separateWorker).toBe(true);
      expect(await busyReason(db, store, 'large')).toBeNull();
    } finally {
      clearInterval(worker);
    }
    expect(runLoadTest).not.toHaveBeenCalled();
  });

  it('refuses a scheduled run whose time comes while a backup runs', async () => {
    const [row] = await db
      .insert(loadTestRun)
      .values({ preset: 'small', status: 'scheduled', scheduledFor: new Date() })
      .returning();
    await db.insert(instanceBackup).values({ trigger: 'manual' });
    expect(await runLoadTestJob(jobDeps(), row!.id)).toEqual({ refused: 'backup_running' });
    const [after] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
    expect(after).toMatchObject({ status: 'refused', reason: 'backup_running' });
    // A second delivery of the job finds the run claimed.
    expect(await runLoadTestJob(jobDeps(), row!.id)).toEqual({ skipped: true });
  });

  it('sweeps the account and project of a run whose process stopped', async () => {
    const [account] = await db
      .insert(user)
      .values({
        name: 'Load test x',
        email: 'loadtest-x@example.invalid',
        canCreateProjects: true,
      })
      .returning();
    const { token } = await issueToken(db, account!.id, { name: 'Load test' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}`, origin: config.PUBLIC_URL },
      payload: { name: 'Load test x' },
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().id as string;
    const [row] = await db
      .insert(loadTestRun)
      .values({
        preset: 'small',
        status: 'running',
        startedAt: new Date(Date.now() - 120_000),
        heartbeatAt: new Date(Date.now() - 120_000),
        testUserId: account!.id,
        testProjectId: projectId,
      })
      .returning();
    expect(await sweepLoadTests({ db, log, removeFiles: async () => {} })).toEqual({
      interrupted: 1,
      cleaned: 1,
    });
    const [after] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
    expect(after?.status).toBe('interrupted');
    expect(after?.cleanedAt).not.toBeNull();
    expect(await db.select().from(user).where(eq(user.id, account!.id))).toEqual([]);
    expect(await db.select().from(project).where(eq(project.id, projectId))).toEqual([]);
    // Nothing left: the next sweep has nothing to do.
    expect(await sweepLoadTests({ db, log, removeFiles: async () => {} })).toEqual({
      interrupted: 0,
      cleaned: 0,
    });
  });

  it('deletes a project the run never recorded (a crash before onProject), never by name', async () => {
    const [account] = await db
      .insert(user)
      .values({ name: 'Load test y', email: 'loadtest-y@example.invalid', canCreateProjects: true })
      .returning();
    const { token } = await issueToken(db, account!.id, { name: 'Load test' });
    // The account creates its project, then the process dies before recording it on the run.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}`, origin: config.PUBLIC_URL },
      payload: { name: 'Load test y' },
    });
    expect(created.statusCode).toBe(201);
    const orphan = created.json().id as string;
    // Someone else's project with the same kind of name stays.
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: people.member ?? '', origin: config.PUBLIC_URL },
      payload: { name: 'Load test y' },
    });
    expect(other.statusCode).toBe(201);
    const [row] = await db
      .insert(loadTestRun)
      .values({
        preset: 'small',
        status: 'running',
        startedAt: new Date(Date.now() - 120_000),
        heartbeatAt: new Date(Date.now() - 120_000),
        testUserId: account!.id,
      })
      .returning();
    expect(row?.testProjectId).toBeNull();
    expect(await sweepLoadTests({ db, log, removeFiles: async () => {} })).toEqual({
      interrupted: 1,
      cleaned: 1,
    });
    expect(await db.select().from(project).where(eq(project.id, orphan))).toEqual([]);
    expect(await db.select().from(user).where(eq(user.id, account!.id))).toEqual([]);
    expect(
      await db.select({ id: project.id }).from(project).where(eq(project.id, other.json().id)),
    ).toHaveLength(1);
  });

  it('keeps the test account out of the members list, its changes and the people search', async () => {
    const [account] = await db
      .insert(user)
      .values({ name: 'Load test z', email: 'loadtest-z@example.invalid' })
      .returning();
    await db.insert(loadTestRun).values({
      preset: 'small',
      status: 'running',
      heartbeatAt: new Date(),
      testUserId: account!.id,
    });
    const members = await request('admin', 'GET', '/instance/members');
    const ids = (members.json().items as Array<{ id: string }>).map((m) => m.id);
    expect(ids).not.toContain(account!.id);
    expect(ids.length).toBeGreaterThan(0);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/instance/members/${account!.id}`,
      headers: { cookie: people.admin ?? '', origin: config.PUBLIC_URL },
      payload: { role: 'admin' },
    });
    expect(patch.statusCode).toBe(404);
    // A sharer looking the account up by its exact address does not find it.
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: people.admin ?? '', origin: config.PUBLIC_URL },
      payload: { name: 'Shared' },
    });
    const search = await app.inject({
      method: 'GET',
      url: '/api/v1/users/search?q=loadtest-z@example.invalid',
      headers: { cookie: people.admin ?? '', origin: config.PUBLIC_URL },
    });
    expect(search.statusCode).toBe(200);
    expect(JSON.stringify(search.json())).not.toContain(account!.id);
    await db.delete(loadTestRun);
    await db.delete(user).where(eq(user.id, account!.id));
  });

  it('keeps a short history', async () => {
    for (let i = 0; i < HISTORY + 3; i++)
      await db.insert(loadTestRun).values({
        preset: 'small',
        status: 'passed',
        createdAt: new Date(Date.now() - i * 1000),
        cleanedAt: new Date(),
      });
    await sweepLoadTests({ db, log, removeFiles: async () => {} });
    const page = LoadTests.parse((await request('admin', 'GET', '/instance/load-tests')).json());
    expect(page.items).toHaveLength(HISTORY);
    expect((await db.select().from(loadTestRun)).length).toBe(HISTORY);
  });

  it('marks a scheduled run whose job never came', async () => {
    await db.insert(loadTestRun).values({
      preset: 'small',
      status: 'scheduled',
      scheduledFor: new Date(Date.now() - 60 * 60_000),
    });
    expect(await reapLoadTests(db)).toBe(1);
  });

  it('runs against the instance, reports, and deletes its account and project', async () => {
    const [row] = await db
      .insert(loadTestRun)
      .values({ preset: 'small', status: 'scheduled' })
      .returning();
    const done = await runLoadTestJob({ ...jobDeps(), durationS: 3 }, row!.id);
    expect(['passed', 'failed']).toContain(done.status);
    const [after] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
    expect(after?.report?.boards).toBe(50);
    expect(after?.report?.edits).toBeGreaterThan(0);
    expect(after?.report?.text).toContain('Inkadra load test · preset small');
    expect(after?.cleanedAt).not.toBeNull();
    expect(await db.select().from(user).where(eq(user.id, after!.testUserId!))).toEqual([]);
    expect(await db.select().from(project).where(eq(project.id, after!.testProjectId!))).toEqual(
      [],
    );
    expect(await db.select().from(personalToken)).toEqual([]);
    const [finished] = await db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.action, 'loadtest.finished'), eq(auditEvent.targetId, row!.id)));
    expect(finished?.details).toMatchObject({ status: done.status });
  }, 90_000);

  it('stops when asked, and still cleans up', async () => {
    const [row] = await db
      .insert(loadTestRun)
      .values({ preset: 'small', status: 'scheduled' })
      .returning();
    const job = runLoadTestJob({ ...jobDeps(), durationS: 60 }, row!.id);
    // Once its project exists, ask it to stop as the page does.
    for (let i = 0; i < 100; i++) {
      const [now] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
      if (now?.testProjectId) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const stop = await request('admin', 'POST', `/instance/load-tests/${row!.id}/stop`);
    expect(stop.statusCode).toBe(200);
    const started = Date.now();
    expect(await job).toEqual({ status: 'stopped' });
    expect(Date.now() - started).toBeLessThan(30_000);
    const [after] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
    expect(after?.cleanedAt).not.toBeNull();
    expect(await db.select().from(project).where(eq(project.id, after!.testProjectId!))).toEqual(
      [],
    );
  }, 90_000);

  it('is stopped by the guard when the app slows down for other people', async () => {
    const own = memoryStore();
    const beats = alive(own);
    const [row] = await db
      .insert(loadTestRun)
      .values({ preset: 'small', status: 'scheduled' })
      .returning();
    const job = runLoadTestJob({ ...jobDeps(), store: own, durationS: 60 }, row!.id);
    // Once it started (past the check for a busy instance), people's answers get slow.
    for (let i = 0; i < 100; i++) {
      const [now] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
      if (now?.testProjectId) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const slow = setInterval(() => {
      const at = Date.now();
      void own.beat({ role: 'web', host: 'w1', startedAt: at - 60_000, at, cpu: 0, memory: 1 });
      void own.push('raw', 'web@w1', {
        t: at,
        c: 0.2,
        cc: 4,
        m: 1,
        ml: null,
        rx: null,
        tx: null,
        pc: 0.1,
        pm: 1,
        p95: GUARD.apiP95Ms * 2,
        req: 50,
        err: 0,
      });
    }, 1000);
    try {
      expect(await job).toEqual({ status: 'aborted' });
    } finally {
      clearInterval(slow);
      clearInterval(beats);
    }
    const [after] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
    expect(after).toMatchObject({ status: 'aborted', reason: 'api_slow' });
    expect(after?.cleanedAt).not.toBeNull();
    expect(after?.report?.text).toContain('Inkadra load test');
  }, 90_000);

  it('gives way to a backup that starts during the run, and cleans up', async () => {
    const [row] = await db
      .insert(loadTestRun)
      .values({ preset: 'small', status: 'scheduled' })
      .returning();
    const job = runLoadTestJob({ ...jobDeps(), durationS: 60 }, row!.id);
    for (let i = 0; i < 100; i++) {
      const [now] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
      if (now?.testProjectId) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // The nightly backup starts.
    await db.insert(instanceBackup).values({ trigger: 'scheduled' });
    const started = Date.now();
    expect(await job).toEqual({ status: 'aborted' });
    expect(Date.now() - started).toBeLessThan(30_000);
    const [after] = await db.select().from(loadTestRun).where(eq(loadTestRun.id, row!.id));
    expect(after).toMatchObject({ status: 'aborted', reason: 'backup_running' });
    expect(after?.cleanedAt).not.toBeNull();
    expect(await db.select().from(project).where(eq(project.id, after!.testProjectId!))).toEqual(
      [],
    );
  }, 90_000);

  it('runs the guard while seeding: a breach stops it before the run phase', async () => {
    const [account] = await db
      .insert(user)
      .values({ name: 'Load test s', email: 'loadtest-s@example.invalid', canCreateProjects: true })
      .returning();
    const { token } = await issueToken(db, account!.id, { name: 'Load test' });
    const phases = new Set<string>();
    const guarded: string[] = [];
    const started = Date.now();
    const outcome = await runLoad({
      baseUrl: base,
      origin: config.PUBLIC_URL,
      auth: { token },
      presetName: 'large',
      // More boards than any seeding finishes before the first reading.
      preset: { ...PRESETS.large, boards: 100_000 },
      durationS: 60,
      signal: new AbortController().signal,
      scrape: async () => null,
      onProgress: (p) => {
        phases.add(p.phase);
      },
      guard: (p) => {
        guarded.push(p.phase);
        return 'api_slow';
      },
    });
    expect(outcome.aborted).toBe('api_slow');
    expect(guarded).toEqual(['seeding']);
    expect(phases.has('running')).toBe(false);
    expect(outcome.result.edits).toBe(0);
    expect(Date.now() - started).toBeLessThan(30_000);
    // The caller cleans up as the job does: the project goes with the account.
    await deleteTestData(
      { db, log, removeFiles: async () => {} },
      { id: randomUUID(), testUserId: account!.id, testProjectId: outcome.projectId ?? null },
    );
    expect(await db.select().from(project).where(eq(project.id, outcome.projectId!))).toEqual([]);
  }, 90_000);

  it('runs at most one at a time, whatever the process (unique index)', async () => {
    await db
      .insert(loadTestRun)
      .values({ preset: 'small', status: 'running', heartbeatAt: new Date() });
    await expect(
      db.insert(loadTestRun).values({ id: randomUUID(), preset: 'small', status: 'scheduled' }),
    ).rejects.toThrow();
  });
});
