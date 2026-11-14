import { fileURLToPath } from 'node:url';
import { AUDIT_RETENTION_DAYS, AuditEvents } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { purgeAudit, recordAudit, recordSignInEvent } from '../audit.ts';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { auditEvent } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('audit log (#806, needs DATABASE_URL)', () => {
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
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  const request = (
    as: string | null,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: as ? { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const list = async (query = '') =>
    AuditEvents.parse((await request('admin', 'GET', `/instance/audit${query}`)).json());

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrations);
    await db.execute(sql`truncate table "user", project, instance_setting, audit_event cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
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
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('is for administrators only', async () => {
    expect((await request('member', 'GET', '/instance/audit')).statusCode).toBe(403);
    expect((await request(null, 'GET', '/instance/audit')).statusCode).toBe(401);
  });

  it('records a role change with who did it and what changed', async () => {
    const changed = await request('admin', 'PATCH', `/instance/members/${people.member?.id}`, {
      role: 'admin',
      canCreateProjects: true,
    });
    expect(changed.statusCode).toBe(200);
    const { items } = await list('?action=member.updated');
    expect(items[0]).toMatchObject({
      action: 'member.updated',
      actor: { id: people.admin?.id, name: 'admin' },
      targetType: 'user',
      targetId: people.member?.id,
      details: { name: 'member', changes: { role: ['member', 'admin'] } },
    });
    await request('admin', 'PATCH', `/instance/members/${people.member?.id}`, { role: 'member' });
  });

  it('records failed sign-ins, masked, and filters by group', async () => {
    const signIn = (email: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email, password: 'wrong-password-123' },
      });
    expect((await signIn('member@example.com')).statusCode).toBe(401);
    await vi.waitFor(async () => {
      const { items } = await list('?group=security');
      expect(items[0]).toMatchObject({
        action: 'auth.sign_in_failed',
        actor: null,
        targetId: people.member?.id,
        details: { email: 'm…@example.com', count: 1 },
      });
      expect(items.every((e) => e.action !== 'member.updated')).toBe(true);
    });
    // The same account from the same address adds to that row; no account, no row.
    expect((await signIn('member@example.com')).statusCode).toBe(401);
    expect((await signIn('nobody@example.com')).statusCode).toBe(401);
    await vi.waitFor(async () => {
      const { items } = await list('?action=auth.sign_in_failed');
      expect(items).toHaveLength(1);
      expect(items[0]?.details).toMatchObject({ count: 2 });
    });
  });

  it('bounds failed sign-ins: one row per account and address, a summary past the hourly cap', async () => {
    const userId = people.admin?.id as string;
    const limits = { windowS: 900, perHour: 3 };
    const fail = (ip: string) =>
      recordSignInEvent(db, { action: 'auth.sign_in_failed', userId, ip }, limits);
    expect(await fail('203.0.113.1')).toBe('added');
    expect(await fail('203.0.113.1')).toBe('counted');
    expect(await fail('203.0.113.2')).toBe('added');
    // The row of the test before makes three this hour: rotating addresses only add up.
    for (const ip of ['203.0.113.3', '203.0.113.4', '203.0.113.5'])
      expect(await fail(ip)).toBe('rate_limited');
    const rows = await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.action, 'auth.sign_in_failed'));
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.details.rateLimited)).toMatchObject({
      targetId: null,
      ip: null,
      details: { rateLimited: true, count: 3 },
    });
  });

  it('masks the address of an email invitation', async () => {
    const made = await request('admin', 'POST', '/invitations', {
      kind: 'email',
      email: 'guest@example.com',
    });
    expect(made.statusCode).toBe(201);
    expect((await request('admin', 'DELETE', `/invitations/${made.json().id}`)).statusCode).toBe(
      204,
    );
    for (const action of ['invitation.created', 'invitation.revoked']) {
      const { items } = await list(`?action=${action}`);
      expect(items[0]?.details).toMatchObject({ email: 'g…@example.com' });
    }
  });

  it('pages newest first and purges events past the retention', async () => {
    const first = await list('?limit=1');
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(`?limit=1&cursor=${first.nextCursor}`);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(Date.parse(second.items[0]?.at ?? '')).toBeLessThanOrEqual(
      Date.parse(first.items[0]?.at ?? ''),
    );

    await recordAudit(db, { action: 'settings.changed', targetId: 'old' });
    await db.execute(
      sql`update audit_event set at = now() - make_interval(days => ${AUDIT_RETENTION_DAYS + 1}) where target_id = 'old'`,
    );
    expect((await purgeAudit(db)).removed).toBe(1);
    expect((await db.select().from(auditEvent)).length).toBeGreaterThan(0);
  });

  it('pseudonymizes the events of a deleted account', async () => {
    const deleted = await request('member', 'DELETE', '/me', { password: 'correct-horse-battery' });
    expect(deleted.statusCode).toBe(204);
    const { items } = await list('?action=account.deleted');
    expect(items[0]).toMatchObject({ actor: null, targetType: 'user', ip: null });
    const opaque = items[0]?.details.actor as string;
    expect(opaque).toMatch(/^deleted-/);
    expect(items[0]?.targetId).toBe(opaque);
    // Earlier events about the person keep action and time, not the name, address or IP.
    const all = (await list('?limit=200')).items;
    const about = all.filter((e) => e.targetId === opaque);
    expect(about.map((e) => e.action)).toEqual(
      expect.arrayContaining(['member.updated', 'auth.sign_in_failed', 'account.deleted']),
    );
    for (const e of about) {
      expect(e.details.name).toBeUndefined();
      expect(e.details.email).toBeUndefined();
    }
    expect(about.find((e) => e.action === 'auth.sign_in_failed')?.ip).toBeNull();
    expect(JSON.stringify(all)).not.toContain(people.member?.id);
    expect(JSON.stringify(all)).not.toContain('m…@example.com');
  });
});
