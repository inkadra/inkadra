import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { boardAccess, boardRole } from './access.ts';
import { readExpiry, sweepAccessExpiry } from './access-expiry.ts';
import { createAuth } from './auth.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { boardGrant, notification, projectMember } from './db/schema.ts';
import { createApp } from './http/app.ts';
import { testDeps } from './test-deps.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const DAY = 86_400_000;

describe('readExpiry', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  it('keeps, clears or checks an end date', () => {
    expect(readExpiry(undefined, 'editor', now)).toBeUndefined();
    expect(readExpiry(null, 'editor', now)).toBeNull();
    expect(readExpiry('2026-12-15T10:00:00Z', 'viewer', now)).toEqual(
      new Date('2026-12-15T10:00:00Z'),
    );
    expect(() => readExpiry('2026-11-30T10:00:00Z', 'viewer', now)).toThrow(/future/);
    expect(() => readExpiry('2028-01-01T10:00:00Z', 'viewer', now)).toThrow(/366/);
    expect(() => readExpiry('2026-12-15T10:00:00Z', 'owner', now)).toThrow(/Owners/);
  });
});

describe.skipIf(!url)('expiring access and project creation (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0041',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  let projectId = '';
  let root = '';
  let child = '';

  async function signUp(name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
    });
    people[name] = {
      cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
      id: res.json().user.id,
    };
  }
  const id = (name: string) => people[name]?.id ?? '';
  const call = (name: string, method: string, path: string, payload?: unknown) =>
    app.inject({
      method: method as 'GET',
      url: `/api/v1${path}`,
      headers: { cookie: people[name]?.cookie ?? '', origin: config.PUBLIC_URL },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, ...testDeps(db, log) });
    // The first account is the administrator.
    for (const name of ['admin', 'owner', 'anna', 'bruno', 'carla']) await signUp(name);
    const created = await call('owner', 'POST', '/projects', { name: 'Last Train' });
    expect(created.statusCode).toBe(201);
    projectId = created.json().id;
    root = created.json().rootBoardId;
    const board = await call('owner', 'POST', `/projects/${projectId}/boards`, {
      title: 'Costumes',
      parentBoardId: root,
    });
    child = board.json().id;
  });

  afterEach(() => vi.useRealTimers());

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('sets, keeps and removes the end date of a member; owners only', async () => {
    const until = inDays(10);
    const added = await call('owner', 'PUT', `/projects/${projectId}/members/${id('anna')}`, {
      role: 'editor',
      expiresAt: until,
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().expiresAt).toBe(until);
    // Leaving the field out (older clients) keeps it.
    const kept = await call('owner', 'PUT', `/projects/${projectId}/members/${id('anna')}`, {
      role: 'commenter',
    });
    expect(kept.json().expiresAt).toBe(until);
    // An editor cannot give an end date, even when adding someone.
    await call('owner', 'PUT', `/projects/${projectId}/members/${id('bruno')}`, { role: 'editor' });
    const byEditor = await call('bruno', 'PUT', `/projects/${projectId}/members/${id('carla')}`, {
      role: 'viewer',
      expiresAt: inDays(5),
    });
    expect(byEditor.statusCode).toBe(403);
    const cleared = await call('owner', 'PUT', `/projects/${projectId}/members/${id('anna')}`, {
      role: 'editor',
      expiresAt: null,
    });
    expect(cleared.json().expiresAt).toBeNull();
  });

  it('never lets an owner expire', async () => {
    const res = await call('owner', 'PUT', `/projects/${projectId}/members/${id('anna')}`, {
      role: 'owner',
      expiresAt: inDays(3),
    });
    expect(res.statusCode).toBe(400);
    await call('owner', 'PUT', `/projects/${projectId}/members/${id('anna')}`, {
      role: 'viewer',
      expiresAt: inDays(3),
    });
    // Promoting clears the end date.
    const promoted = await call('owner', 'PUT', `/projects/${projectId}/members/${id('anna')}`, {
      role: 'owner',
    });
    expect(promoted.json()).toMatchObject({ role: 'owner', expiresAt: null });
    // The database refuses an owner with an end date whatever the code path.
    await expect(
      db
        .update(projectMember)
        .set({ expiresAt: new Date(Date.now() + DAY) })
        .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, id('anna')))),
    ).rejects.toThrow();
    await call('owner', 'PUT', `/projects/${projectId}/members/${id('anna')}`, {
      role: 'editor',
    });
  });

  it('treats an ended membership as gone before any sweep', async () => {
    await call('owner', 'PUT', `/projects/${projectId}/members/${id('carla')}`, {
      role: 'editor',
      expiresAt: inDays(1),
    });
    expect((await boardRole(db, { id: id('carla') }, root))?.role).toBe('editor');
    // The clock passes the end date: the row is still there, the role is not.
    await db
      .update(projectMember)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, id('carla'))));
    expect((await boardRole(db, { id: id('carla') }, root))?.role).toBeNull();
    expect((await call('carla', 'GET', `/projects/${projectId}`)).statusCode).toBe(404);
    const members = (await call('owner', 'GET', `/projects/${projectId}/members`)).json().items;
    expect(members.map((m: { user: { id: string } }) => m.user.id)).not.toContain(id('carla'));
  });

  it('lets an ended grant fall back to the inherited role', async () => {
    await call('owner', 'PUT', `/projects/${projectId}/members/${id('bruno')}`, {
      role: 'viewer',
    });
    const granted = await call('owner', 'PUT', `/boards/${child}/grants/${id('bruno')}`, {
      role: 'editor',
      expiresAt: inDays(4),
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({ role: 'editor', source: { kind: 'board' } });
    const access = (await call('owner', 'GET', `/boards/${child}/access`)).json();
    const entry = access.items.find((e: { user: { id: string } }) => e.user.id === id('bruno'));
    expect(entry.expiresAt).not.toBeNull();
    // Owner grants take no end date.
    const ownerGrant = await call('owner', 'PUT', `/boards/${child}/grants/${id('bruno')}`, {
      role: 'owner',
      expiresAt: inDays(4),
    });
    expect(ownerGrant.statusCode).toBe(400);
    await db
      .update(boardGrant)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(boardGrant.boardId, child), eq(boardGrant.userId, id('bruno'))));
    const after = await boardAccess(db, { id: id('bruno') }, child);
    expect(after).toMatchObject({ role: 'viewer', grantBoardId: null });
  });

  it('warns three days before, removes at the end and notifies once (fake clock)', async () => {
    // Leftovers of the tests above end first.
    await sweepAccessExpiry(db);
    await db.delete(notification);
    await call('owner', 'PUT', `/projects/${projectId}/members/${id('carla')}`, {
      role: 'commenter',
      expiresAt: inDays(5),
    });
    const end = Date.now() + 5 * DAY;
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(end - 4 * DAY);
    expect(await sweepAccessExpiry(db)).toMatchObject({ warned: 0 });

    vi.setSystemTime(end - 2 * DAY);
    expect(await sweepAccessExpiry(db)).toMatchObject({ warned: 1, expired: 0 });
    // Again, as a second worker or a retry would: nothing new.
    expect(await sweepAccessExpiry(db)).toMatchObject({ warned: 0, expired: 0 });
    const warned = await db.select().from(notification);
    expect(warned.map((n) => [n.type, n.userId]).sort()).toEqual(
      [
        ['access_expiring', id('carla')],
        ['access_expiring', id('owner')],
      ].sort(),
    );

    vi.setSystemTime(end + 60_000);
    const [both] = await Promise.all([sweepAccessExpiry(db), sweepAccessExpiry(db)]).then((r) => [
      r[0].expired + r[1].expired,
    ]);
    expect(both).toBe(1);
    expect(await sweepAccessExpiry(db)).toMatchObject({ expired: 0 });
    vi.useRealTimers();

    const left = await db
      .select()
      .from(projectMember)
      .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, id('carla'))));
    expect(left).toHaveLength(0);
    const ended = await db
      .select()
      .from(notification)
      .where(eq(notification.type, 'access_expired'));
    expect(ended).toHaveLength(2);
    // The person keeps seeing it after losing access; owners see whose access it was.
    const mine = (await call('carla', 'GET', '/me/notifications')).json().items;
    expect(mine.map((n: { type: string }) => n.type)).toContain('access_expired');
    expect((await call('carla', 'GET', '/me/notifications/unread-count')).json().unread).toBe(2);
    const theirs = (await call('owner', 'GET', '/me/notifications')).json().items;
    expect(theirs.find((n: { type: string }) => n.type === 'access_expired')).toMatchObject({
      subject: { id: id('carla') },
      projectName: 'Last Train',
    });
  });

  it('gives an invitation its end date when accepted', async () => {
    const until = inDays(20);
    const res = await call('owner', 'POST', '/invitations', {
      kind: 'email',
      email: 'carla@example.com',
      projectId,
      role: 'viewer',
      accessExpiresAt: until,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'added', entry: { expiresAt: until } });
    const link = await call('owner', 'POST', '/invitations', {
      kind: 'link',
      boardId: child,
      role: 'commenter',
      accessExpiresAt: inDays(7),
    });
    expect(link.json().invitation.accessExpiresAt).not.toBeNull();
    const owner = await call('owner', 'POST', '/invitations', {
      kind: 'email',
      email: 'new@example.com',
      projectId,
      role: 'owner',
      accessExpiresAt: until,
    });
    expect(owner.statusCode).toBe(400);
  });

  it('lets only the people allowed create or import projects', async () => {
    const off = await call('admin', 'PATCH', '/instance/settings', {
      membersCanCreateProjects: false,
    });
    expect(off.json().membersCanCreateProjects).toBe(false);
    const refused = await call('bruno', 'POST', '/projects', { name: 'Night Shift' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toEqual({ reason: 'project_creation_disabled' });
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/import',
      headers: {
        cookie: people.bruno?.cookie ?? '',
        origin: config.PUBLIC_URL,
        'content-type': 'application/zip',
      },
      payload: Buffer.from('PK'),
    });
    expect(imported.statusCode).toBe(403);
    expect((await call('bruno', 'GET', '/me')).json().canCreateProjects).toBe(false);
    // Members still work in projects they are in.
    expect((await call('bruno', 'GET', `/projects/${projectId}`)).statusCode).toBe(200);
    // Administrators always can.
    expect((await call('admin', 'POST', '/projects', { name: 'Admin' })).statusCode).toBe(201);

    // A per-account override wins over the instance setting, both ways.
    await call('admin', 'PATCH', `/instance/members/${id('bruno')}`, { canCreateProjects: true });
    expect((await call('bruno', 'POST', '/projects', { name: 'Night Shift' })).statusCode).toBe(
      201,
    );
    const members = (await call('admin', 'GET', '/instance/members')).json().items;
    expect(members.find((m: { id: string }) => m.id === id('bruno'))).toMatchObject({
      canCreateProjects: true,
      canCreateProjectsOverride: true,
    });
    await call('admin', 'PATCH', '/instance/settings', { membersCanCreateProjects: true });
    await call('admin', 'PATCH', `/instance/members/${id('carla')}`, { canCreateProjects: false });
    expect((await call('carla', 'POST', '/projects', { name: 'No' })).statusCode).toBe(403);
    await call('admin', 'PATCH', `/instance/members/${id('carla')}`, { canCreateProjects: null });
    expect((await call('carla', 'POST', '/projects', { name: 'Yes' })).statusCode).toBe(201);
    // Non-administrators cannot change the override.
    expect(
      (
        await call('bruno', 'PATCH', `/instance/members/${id('carla')}`, {
          canCreateProjects: true,
        })
      ).statusCode,
    ).toBe(403);
  });
});
