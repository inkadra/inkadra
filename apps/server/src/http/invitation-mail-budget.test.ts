import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { invitation, user } from '../db/schema.ts';
import { memoryMailer } from '../mailer.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe.skipIf(!url)('hourly budgets of invitation emails (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-mails',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  const mailer = memoryMailer();
  let app: Awaited<ReturnType<typeof createApp>>;
  const cookies: Record<string, string> = {};

  const call = (who: string, method: string, path: string, payload?: unknown) =>
    app.inject({
      method: method as 'GET',
      url: `/api/v1${path}`,
      headers: { cookie: cookies[who] ?? '', origin: config.PUBLIC_URL },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  async function signUp(name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
    });
    cookies[name] = String(res.headers['set-cookie']).split(';')[0] ?? '';
  }
  async function newProject(who: string, name: string) {
    const res = await call(who, 'POST', '/projects', { name });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }
  const invite = (who: string, projectId: string, email: string) =>
    call(who, 'POST', '/invitations', { kind: 'email', email, projectId, role: 'viewer' });
  /** Sends an invitation again, as if its last email went out two minutes ago. */
  async function resend(who: string, id: string) {
    await db
      .update(invitation)
      .set({ lastSentAt: new Date(Date.now() - 120_000) })
      .where(eq(invitation.id, id));
    return call(who, 'POST', `/invitations/${id}/resend`);
  }

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, mailer, ...testDeps(db, log) });
    for (const name of ['admin', 'anna', 'bruno']) await signUp(name);
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('caps the invitation emails one address gets in an hour, from everyone', async () => {
    const annas = await newProject('anna', 'Anna');
    const brunos = await newProject('bruno', 'Bruno');
    const first = await invite('anna', annas, 'carla@example.com');
    expect(first.statusCode).toBe(201);
    const id = first.json().invitation.id;
    for (let i = 0; i < 8; i++) expect((await resend('anna', id)).statusCode).toBe(200);
    // The tenth email, from someone else.
    expect((await invite('bruno', brunos, 'carla@example.com')).statusCode).toBe(201);
    const refused = await resend('anna', id);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    const another = await newProject('bruno', 'Bruno again');
    expect((await invite('bruno', another, 'Carla@example.com')).statusCode).toBe(429);
    // Refused before the row was made.
    const rows = await db.select().from(invitation).where(eq(invitation.projectId, another));
    expect(rows).toEqual([]);
  });

  it('takes no email from the budget for a duplicate or when the instance sends none', async () => {
    const projectId = await newProject('anna', 'Duplicates');
    const first = await invite('anna', projectId, 'dora@example.com');
    expect(first.statusCode).toBe(201);
    for (let i = 0; i < 3; i++)
      expect((await invite('anna', projectId, 'dora@example.com')).statusCode).toBe(409);
    // The pending invitation took one of the ten emails; the duplicates took none.
    const id = first.json().invitation.id;
    for (let i = 0; i < 9; i++) expect((await resend('anna', id)).statusCode).toBe(200);
    expect((await resend('anna', id)).statusCode).toBe(429);

    // Without email, invitations are links to copy: more than ten to one address all work.
    Object.assign(mailer, { enabled: false });
    try {
      for (let i = 0; i < 11; i++) {
        const scope = await newProject('anna', `No email ${i}`);
        const res = await invite('anna', scope, 'erin@example.com');
        expect(res.statusCode).toBe(201);
        expect(res.json().invitation.emailSent).toBe(false);
      }
    } finally {
      Object.assign(mailer, { enabled: true });
    }
    const sent = await invite('anna', await newProject('anna', 'Email again'), 'erin@example.com');
    expect(sent.statusCode).toBe(201);
    expect(sent.json().invitation.emailSent).toBe(true);
  });

  it('charges a resend to whoever sends it, not to whoever invited', async () => {
    await signUp('dario');
    const [dario] = await db.select().from(user).where(eq(user.email, 'dario@example.com'));
    const projectId = await newProject('bruno', 'Shared');
    const member = await call('bruno', 'PUT', `/projects/${projectId}/members/${dario?.id}`, {
      role: 'editor',
    });
    expect(member.statusCode).toBe(200);
    const brunos = await invite('bruno', projectId, 'fabio@example.com');
    expect(brunos.statusCode).toBe(201);
    const ids: string[] = [];
    for (let i = 0; i < 49; i++) {
      const res = await invite('dario', projectId, `dario-guest${i}@example.com`);
      expect(res.statusCode).toBe(201);
      ids.push(res.json().invitation.id);
    }
    // Dario's fiftieth email is Bruno's invitation sent again; the next one is refused.
    expect((await resend('dario', brunos.json().invitation.id)).statusCode).toBe(200);
    const refused = await resend('dario', ids[0] ?? '');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('rate_limited');
  });

  it('counts resends in the hourly budget of whoever sends them', async () => {
    const projectId = await newProject('admin', 'Admin');
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await invite('admin', projectId, `guest${i}@example.com`);
      expect(res.statusCode).toBe(201);
      ids.push(res.json().invitation.id);
    }
    // Two resends of each of ten invitations stay under every address's own cap.
    for (const id of ids.slice(0, 10))
      for (let i = 0; i < 2; i++) expect((await resend('admin', id)).statusCode).toBe(200);
    // Fifty emails in the hour: the 51st is refused, whether new or sent again.
    const created = await invite('admin', projectId, 'guest-new@example.com');
    expect(created.statusCode).toBe(429);
    expect(created.json().error.code).toBe('rate_limited');
    expect((await resend('admin', ids[29] ?? '')).statusCode).toBe(429);
    const [made] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(invitation)
      .where(eq(invitation.projectId, projectId));
    expect(made?.n).toBe(30);
    // Links send no email: they only count in the invitations created in the hour.
    const link = await call('admin', 'POST', '/invitations', {
      kind: 'link',
      projectId,
      role: 'viewer',
    });
    expect(link.statusCode).toBe(201);
  });
});
