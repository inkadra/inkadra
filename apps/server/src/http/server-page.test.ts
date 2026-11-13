import { fileURLToPath } from 'node:url';
import { ServerLive, ServerStatus } from '@inkadra/shared';
import type { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  asset,
  board,
  boardElementIndex,
  boardGrant,
  instanceBackup,
  notification,
  user,
} from '../db/schema.ts';
import { memoryMailer } from '../mailer.ts';
import { sendServerAlert } from '../monitor/alerts.ts';
import { checkHealth } from '../monitor/health.ts';
import { serverStatus } from '../monitor/status.ts';
import { memoryStore } from '../monitor/store.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

// A disk almost full, when a test asks for one.
const disk = vi.hoisted(() => ({ full: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const statfs = ((path: string, opts?: object) =>
    disk.full
      ? Promise.resolve({ blocks: 1000, bsize: 1e6, bavail: 10 })
      : real.statfs(path, opts as never)) as typeof real.statfs;
  return { ...real, statfs, default: { ...real, statfs } };
});

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('Server page (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const store = memoryStore();
  const mailer = memoryMailer();
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  const boards: Record<string, string> = {};

  const request = (as: string, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL },
      ...(payload ? { payload } : {}),
    });
  const alertDeps = () => ({
    db,
    store,
    mailer,
    log,
    config,
    instanceName: 'Studio',
    publicUrl: config.PUBLIC_URL,
  });

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrations);
    await db.execute(
      sql`truncate table "user", project, instance_setting, instance_backup cascade`,
    );
    const deps = testDeps(db, log);
    app = await createApp({
      config: { ...config, DATA_DIR: deps.root },
      db,
      auth: createAuth(config, db),
      log,
      ...deps,
      monitor: { store },
    });
    for (const name of ['admin', 'member']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
      });
      people[name] = {
        id: response.json().user.id,
        cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
      };
    }
    await db.update(user).set({ role: 'admin' }).where(eq(user.email, 'admin@example.com'));
    await db.update(user).set({ role: 'member' }).where(eq(user.email, 'member@example.com'));
    boards.admin = (
      await request('admin', 'POST', '/projects', { name: 'Spot' })
    ).json().rootBoardId;
    boards.member = (
      await request('member', 'POST', '/projects', { name: 'Secret film' })
    ).json().rootBoardId;
  });

  afterAll(async () => {
    await app.close();
    await client.end({ timeout: 5 });
  });

  it('is for administrators only', async () => {
    expect((await request('member', 'GET', '/instance/server')).statusCode).toBe(403);
  });

  it('names the boards the administrator can open and only counts the others', async () => {
    const now = Date.now();
    // Shared with the administrator alone: still a project they are not a member of.
    await db.insert(boardGrant).values({
      boardId: boards.member as string,
      userId: people.admin?.id as string,
      role: 'viewer',
    });
    await store.beat({
      role: 'collab',
      host: 'c1',
      startedAt: now - 60_000,
      at: now,
      cpu: 0.1,
      memory: 1e8,
      presence: [
        { boardId: boards.admin as string, since: now - 1000, users: [people.admin?.id as string] },
        {
          boardId: boards.member as string,
          since: now - 2000,
          users: [people.member?.id as string],
        },
      ],
    });
    const response = await request('admin', 'GET', '/instance/server?range=15m');
    expect(response.statusCode).toBe(200);
    const status = ServerStatus.parse(response.json());
    expect(status.presence.people).toBe(2);
    const open = status.presence.boards.find((b) => b.boardId === boards.admin);
    expect(open).toMatchObject({ projectName: 'Spot', people: [{ name: 'admin' }] });
    const hidden = status.presence.boards.find((b) => b.boardId === null);
    expect(hidden).toMatchObject({ title: null, projectName: null, count: 1, people: [] });
    expect(JSON.stringify(status)).not.toContain('Secret film');
    expect(status.services.find((s) => s.id === 'collab')?.status).toBe('ok');
  });

  it('gives the live values from the monitor store, without the database aggregates', async () => {
    expect((await request('member', 'GET', '/instance/server/live')).statusCode).toBe(403);
    const now = Date.now();
    await store.beat({
      role: 'web',
      host: 'w1',
      startedAt: now - 60_000,
      at: now,
      cpu: 0,
      memory: 0,
    });
    await store.push('raw', 'web@w1', {
      t: now - 1000,
      c: 1,
      cc: 2,
      m: 5e8,
      ml: 2e9,
      rx: 10,
      tx: 20,
      pc: 0.5,
      pm: 1e8,
      p95: 42,
      req: 4,
      err: 0,
    });
    // Signing in reads the session; nothing runs raw SQL as the full status does.
    const execute = vi.spyOn(db, 'execute');
    try {
      const response = await request('admin', 'GET', '/instance/server/live?range=15m');
      expect(response.statusCode).toBe(200);
      const live = ServerLive.parse(response.json());
      expect(live).toMatchObject({ range: '15m', step: 5 });
      expect(live.now.p95).toBe(42);
      expect(live.history.length).toBeGreaterThan(0);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
    }
  });

  it('tells when the last backup that succeeded ended, after one that failed', async () => {
    const ended = new Date(Date.now() - 86_400_000);
    await db.insert(instanceBackup).values([
      { trigger: 'scheduled', status: 'ready', startedAt: ended, finishedAt: ended },
      { trigger: 'scheduled', status: 'failed', startedAt: new Date(), finishedAt: new Date() },
    ]);
    const status = ServerStatus.parse((await request('admin', 'GET', '/instance/server')).json());
    expect(status.backup.lastStatus).toBe('failed');
    expect(status.backup.lastSuccessAt).toBe(ended.toISOString());
    await db.delete(instanceBackup);
  });

  it('marks problems seen, and refuses to run again what is gone', async () => {
    await store.record({
      id: 'job_failed:maintenance:x',
      kind: 'job_failed',
      severity: 'error',
      role: 'worker',
      technical: 'worker · maintenance · x',
      assetId: null,
      service: null,
      job: { queue: 'maintenance', id: '1' },
      at: Date.now(),
    });
    expect(
      (await request('admin', 'POST', '/instance/server/problems/job_failed:maintenance:x/retry'))
        .statusCode,
    ).toBe(409);
    expect(
      (await request('admin', 'POST', '/instance/server/problems/job_failed:maintenance:x/seen'))
        .statusCode,
    ).toBe(204);
    const status = ServerStatus.parse((await request('admin', 'GET', '/instance/server')).json());
    expect(status.problems.find((p) => p.id === 'job_failed:maintenance:x')?.seen).toBe(true);
  });

  it('names a failed file by a board of a project the administrator is a member of', async () => {
    const [own] = await db
      .select({ projectId: board.projectId, title: board.title })
      .from(board)
      .where(eq(board.id, boards.admin as string));
    const [secret] = await db
      .select({ projectId: board.projectId })
      .from(board)
      .where(eq(board.id, boards.member as string));
    const [file] = await db
      .insert(asset)
      .values({
        projectId: own?.projectId as string,
        kind: 'video',
        mime: 'video/quicktime',
        filename: 'Spot finale.mov',
        size: 10,
        storageKey: 'x',
        status: 'ready',
        proxyStatus: 'ready',
      })
      .returning({ id: asset.id });
    const assetId = file?.id as string;
    // On a board of the member's project first, then on one of the administrator's.
    await db.insert(boardElementIndex).values([
      {
        boardId: boards.member as string,
        projectId: secret?.projectId as string,
        elementId: 'a',
        type: 'video',
        assetId,
      },
      {
        boardId: boards.admin as string,
        projectId: own?.projectId as string,
        elementId: 'b',
        type: 'video',
        assetId,
      },
    ]);
    await store.record({
      id: `video_failed:${assetId}`,
      kind: 'video_failed',
      severity: 'error',
      role: 'worker',
      technical: 'worker · media-proxies · make',
      assetId,
      service: null,
      job: null,
      at: Date.now(),
    });
    const status = ServerStatus.parse((await request('admin', 'GET', '/instance/server')).json());
    expect(status.problems.find((p) => p.id === `video_failed:${assetId}`)).toMatchObject({
      file: 'Spot finale.mov',
      board: own?.title,
    });
    // Its copy got made since: nothing to run again.
    expect(
      (await request('admin', 'POST', `/instance/server/problems/video_failed:${assetId}/retry`))
        .statusCode,
    ).toBe(409);
  });

  it('shows the queue down instead of waiting for it', async () => {
    const stuck = { getJobCounts: () => new Promise(() => {}), toKey: () => 'x' };
    const queues = Object.fromEntries(
      ['media', 'maintenance', 'transfers', 'proxies', 'office', 'email'].map((id) => [
        id,
        { ...stuck, getActive: () => new Promise(() => {}) },
      ]),
    ) as unknown as Record<'media', Queue>;
    const status = await serverStatus(
      {
        config,
        db,
        store,
        jobs: testDeps(db, log).jobs,
        queues: queues as never,
        redis: { info: async () => 'redis_version:7.2.0' } as never,
      },
      people.admin?.id as string,
      '1h',
      [],
    );
    expect(status.services.find((s) => s.id === 'queue')?.status).toBe('down');
    expect(status.queues).toEqual([]);
  }, 10_000);

  it('saves the alert settings', async () => {
    const saved = await request('admin', 'PATCH', '/instance/server/alerts', { email: true });
    expect(saved.json()).toEqual({ enabled: true, email: true });
    expect(
      (await request('member', 'PATCH', '/instance/server/alerts', { email: false })).statusCode,
    ).toBe(403);
  });

  it('tells administrators once an hour, by email only about serious problems', async () => {
    const alert = {
      kind: 'backup_failed' as const,
      service: null,
      free: null,
      total: null,
      weeksLeft: null,
      count: null,
    };
    expect(await sendServerAlert(alertDeps(), alert, true)).toBe(true);
    expect(await sendServerAlert(alertDeps(), alert, true)).toBe(false);
    const rows = await db
      .select()
      .from(notification)
      .where(and(eq(notification.type, 'server_alert')));
    expect(rows.map((r) => r.userId)).toEqual([people.admin?.id]);
    expect(rows[0]?.serverAlert).toMatchObject({ kind: 'backup_failed' });
    expect(mailer.sent.map((m) => m.to)).toEqual(['admin@example.com']);
    const inbox = await request('admin', 'GET', '/me/notifications');
    expect(inbox.json().items[0]).toMatchObject({ type: 'server_alert', serverAlert: alert });
  });

  it('tells about a disk almost full once, not at every check', async () => {
    const before = mailer.sent.length;
    let clock = Date.now();
    const own = memoryStore(() => clock);
    const deps = { ...alertDeps(), store: own };
    disk.full = true;
    try {
      // Two checks an hour apart, past the hourly limit of the alerts themselves.
      await checkHealth(deps, clock);
      clock += 3_700_000;
      await checkHealth(deps, clock);
    } finally {
      disk.full = false;
    }
    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, people.admin?.id as string));
    expect(rows.filter((r) => r.serverAlert?.kind === 'disk_full')).toHaveLength(1);
    expect((await own.problems()).find((p) => p.id === 'disk_full')?.count).toBe(1);
    expect(mailer.sent.length - before).toBeLessThanOrEqual(1);
  });

  it('finds a stopped worker, once per outage', async () => {
    const now = Date.now();
    await store.beat({
      role: 'worker',
      host: 'w1',
      startedAt: now - 600_000,
      at: now - 300_000,
      cpu: 0,
      memory: 0,
    });
    await checkHealth(alertDeps(), now);
    const [down] = (await store.problems()).filter((p) => p.id === 'service_down:worker');
    expect(down).toMatchObject({ kind: 'service_down', service: 'worker', count: 1 });
    const status = ServerStatus.parse((await request('admin', 'GET', '/instance/server')).json());
    expect(status.services.find((s) => s.id === 'worker')?.status).toBe('down');
  });
});
