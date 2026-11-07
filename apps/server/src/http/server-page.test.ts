import { fileURLToPath } from 'node:url';
import { ServerStatus } from '@inkadra/shared';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { notification, user } from '../db/schema.ts';
import { memoryMailer } from '../mailer.ts';
import { sendServerAlert } from '../monitor/alerts.ts';
import { checkHealth } from '../monitor/health.ts';
import { memoryStore } from '../monitor/store.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

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
