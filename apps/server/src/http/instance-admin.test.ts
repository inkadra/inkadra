import { fileURLToPath } from 'node:url';
import { InstanceMember, InstanceSettings, StorageUsage } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  asset,
  assetVariant,
  boardElementIndex,
  boardGrant,
  personalToken,
  projectMember,
  session,
  user,
} from '../db/schema.ts';
import { memoryMailer } from '../mailer.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('instance administration', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    // Fixture setup creates many accounts on one loopback network. Auth limits have dedicated tests.
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const log = pino({ level: 'silent' });
  const people: Record<string, { id: string; cookie: string }> = {};
  let app: Awaited<ReturnType<typeof createApp>>;
  const request = (
    who: string | null,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: who ? { cookie: people[who]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload ? { payload } : {}),
    });
  const signUp = (name: string, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL, ...(cookie ? { cookie } : {}) },
      payload: { name, email: `${name}@example.com`, password: 'correct-horse-battery' },
    });
  const signIn = (name: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: `${name}@example.com`, password: 'correct-horse-battery' },
    });
  const memberPath = (name: string) => `/instance/members/${people[name]?.id}`;
  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log,
      mailer: memoryMailer(),
      ...testDeps(db, log),
    });
    for (const name of ['admin', 'member', 'second']) {
      const res = await signUp(name);
      expect(res.statusCode).toBe(200);
      people[name] = {
        id: res.json().user.id,
        cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
      };
    }
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('protects every endpoint before parsing input, including storage and invitations', async () => {
    const routes = [
      ['GET', '/instance/members'],
      ['GET', '/instance/settings'],
      ['PATCH', '/instance/settings'],
      ['PATCH', memberPath('member')],
      ['GET', '/instance/storage'],
    ] as const;
    for (const [method, path] of routes) {
      expect(
        (await request(null, method, path, method === 'PATCH' ? {} : undefined)).statusCode,
      ).toBe(401);
      expect(
        (await request('member', method, path, method === 'PATCH' ? {} : undefined)).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await request('member', 'POST', '/invitations', {
          kind: 'email',
          email: 'invitee@example.com',
        })
      ).statusCode,
    ).toBe(403);
  });
  it('returns real directory data without auth credentials', async () => {
    await request('member', 'POST', '/projects', { name: 'Production' });
    await db
      .update(session)
      .set({ updatedAt: new Date('2026-01-01T12:00:00Z') })
      .where(eq(session.userId, people.member!.id));
    const token = await issueToken(db, people.member!.id, { name: 'Activity' });
    await db
      .update(personalToken)
      .set({ lastUsedAt: new Date('2026-02-01T12:00:00Z') })
      .where(eq(personalToken.id, token.row.id));
    const res = await request('admin', 'GET', '/instance/members');
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(3);
    for (const row of res.json().items)
      expect(InstanceMember.strict().safeParse(row).success).toBe(true);
    expect(res.json().items.find((m: InstanceMember) => m.id === people.member?.id)).toMatchObject({
      projectsCount: 1,
      role: 'member',
      image: null,
      lastActiveAt: '2026-02-01T12:00:00.000Z',
      deactivatedAt: null,
    });
    expect((await request('admin', 'GET', '/instance/storage')).json()).toEqual({
      originalBytes: 0,
      byType: ['images', 'videos', 'audio', 'documents', 'other'].map((type) => ({
        type,
        bytes: 0,
      })),
      byProject: [],
    });
  });
  it('aggregates original assets once, excludes pending/derived files and hides inaccessible project labels', async () => {
    const own = (await request('admin', 'POST', '/projects', { name: 'Visible shoot' })).json();
    const hidden = (await request('second', 'POST', '/projects', { name: 'Private shoot' })).json();
    const [image] = await db
      .insert(asset)
      .values({
        projectId: own.id,
        kind: 'image',
        mime: 'image/jpeg',
        filename: 'photo.jpg',
        size: 1000,
        storageKey: 'test-photo',
        status: 'ready',
      })
      .returning();
    await db.insert(asset).values([
      {
        projectId: hidden.id,
        kind: 'video',
        mime: 'video/mp4',
        filename: 'movie.mp4',
        size: 3000,
        storageKey: 'test-video',
        status: 'processing',
      },
      {
        projectId: own.id,
        kind: 'file',
        mime: 'application/pdf',
        filename: 'failed.pdf',
        size: 500,
        storageKey: 'test-failed',
        status: 'failed',
      },
      {
        projectId: own.id,
        kind: 'image',
        mime: 'image/png',
        filename: 'incomplete.png',
        size: 9000,
        storageKey: 'test-pending',
        status: 'pending',
      },
    ]);
    await db.insert(assetVariant).values({
      assetId: image!.id,
      size: '512',
      width: 512,
      height: 512,
      storageKey: 'derived-test',
    });
    // Repeated and cross-project references never multiply or reassign the owning asset.
    await db.insert(boardElementIndex).values([
      {
        boardId: own.rootBoardId,
        projectId: own.id,
        elementId: 'photo-one',
        type: 'image',
        assetId: image!.id,
      },
      {
        boardId: own.rootBoardId,
        projectId: own.id,
        elementId: 'photo-two',
        type: 'image',
        assetId: image!.id,
      },
      {
        boardId: hidden.rootBoardId,
        projectId: hidden.id,
        elementId: 'photo-three',
        type: 'image',
        assetId: image!.id,
      },
    ]);
    const response = await request('admin', 'GET', '/instance/storage');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const result = StorageUsage.parse(response.json());
    expect(result.originalBytes).toBe(4500);
    expect(result.byType.reduce((sum, row) => sum + row.bytes, 0)).toBe(4500);
    expect(result.byProject.reduce((sum, row) => sum + row.bytes, 0)).toBe(4500);
    expect(result.byProject).toEqual([
      { projectId: null, name: null, scope: 'restricted', bytes: 3000 },
      { projectId: own.id, name: 'Visible shoot', scope: 'project', bytes: 1500 },
    ]);
    expect(JSON.stringify(result)).not.toContain(hidden.id);
    expect(JSON.stringify(result)).not.toContain('Private shoot');
    await db
      .insert(boardGrant)
      .values({ boardId: hidden.rootBoardId, userId: people.admin!.id, role: 'viewer' });
    const granted = StorageUsage.parse((await request('admin', 'GET', '/instance/storage')).json());
    expect(granted.originalBytes).toBe(4500);
    expect(granted.byProject[0]).toEqual({
      projectId: hidden.id,
      name: 'Private shoot',
      scope: 'project',
      bytes: 3000,
    });
  });

  it('validates settings, persists partial overrides and updates public metadata', async () => {
    expect(
      InstanceSettings.parse((await request('admin', 'GET', '/instance/settings')).json()),
    ).toMatchObject({ name: config.INSTANCE_NAME, registration: 'open' });
    for (const payload of [{ name: '' }, { registration: 'first-user' }, { auth: {} }])
      expect((await request('admin', 'PATCH', '/instance/settings', payload)).statusCode).toBe(400);
    expect(
      (await request('admin', 'PATCH', '/instance/settings', { name: 'Studio' })).statusCode,
    ).toBe(200);
    expect(
      (await request('admin', 'PATCH', '/instance/settings', { registration: 'invite' })).json(),
    ).toEqual({ name: 'Studio', registration: 'invite' });
    expect((await app.inject('/api/v1/instance')).json()).toMatchObject({
      name: 'Studio',
      registration: 'invite',
    });
    expect((await signUp('blocked')).statusCode).toBe(403);
  });
  it('reuses address-bound instance invitations; closed blocks even a claimed invite', async () => {
    const invite = await request('admin', 'POST', '/invitations', {
      kind: 'email',
      email: 'invited@example.com',
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().invitation).toMatchObject({ projectId: null, boardId: null, role: null });
    const token = new URL(invite.json().invitation.url).pathname.split('/').at(-1);
    const claim = await request(null, 'POST', `/invitations/by-token/${token}/claim`, {});
    const cookie = String(claim.headers['set-cookie']).split(';')[0];
    await request('admin', 'PATCH', '/instance/settings', { registration: 'closed' });
    expect((await signUp('invited', cookie)).statusCode).toBe(403);
    expect((await signUp('uninvited')).statusCode).toBe(403);
    expect((await signIn('member')).statusCode).toBe(200);
    await request('admin', 'PATCH', '/instance/settings', { registration: 'invite' });
    const joined = await signUp('invited', cookie);
    expect(joined.statusCode).toBe(200);
    expect(joined.json().user.role).toBe('member');
    await request('admin', 'PATCH', '/instance/settings', { registration: 'open' });
    expect((await signUp('public')).statusCode).toBe(200);
  });
  it('rejects invalid roles, missing members and attempts to remove the last admin', async () => {
    expect(
      (await request('admin', 'PATCH', memberPath('member'), { role: 'owner' })).statusCode,
    ).toBe(400);
    expect(
      (await request('admin', 'PATCH', memberPath('member'), { deactivatedAt: null })).statusCode,
    ).toBe(400);
    expect(
      (
        await request('admin', 'PATCH', '/instance/members/00000000-0000-4000-8000-000000000000', {
          active: false,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await request('admin', 'PATCH', memberPath('admin'), { role: 'member' })).statusCode,
    ).toBe(409);
    expect(
      (await request('admin', 'PATCH', memberPath('admin'), { active: false })).statusCode,
    ).toBe(409);
    expect(
      (await request('admin', 'DELETE', '/me', { password: 'correct-horse-battery' })).statusCode,
    ).toBe(409);
  });
  it('uses current database roles even with an existing session', async () => {
    await request('admin', 'PATCH', memberPath('second'), { role: 'admin' });
    expect((await request('second', 'GET', '/instance/members')).statusCode).toBe(200);
    await request('admin', 'PATCH', memberPath('second'), { role: 'member' });
    expect((await request('second', 'GET', '/instance/members')).statusCode).toBe(403);
  });
  it('soft deactivates, revokes both access methods, preserves memberships and supports reactivation', async () => {
    const token = await issueToken(db, people.member!.id, { name: 'Revoked' });
    expect(
      (await request('admin', 'PATCH', memberPath('member'), { active: false })).statusCode,
    ).toBe(200);
    expect(
      (await db.select().from(user).where(eq(user.id, people.member!.id)))[0]?.deactivatedAt,
    ).toBeInstanceOf(Date);
    expect(
      await db.select().from(projectMember).where(eq(projectMember.userId, people.member!.id)),
    ).toHaveLength(1);
    expect(
      await db.select().from(session).where(eq(session.userId, people.member!.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(personalToken).where(eq(personalToken.userId, people.member!.id)),
    ).toHaveLength(0);
    expect((await request('member', 'GET', '/me')).statusCode).toBe(401);
    expect((await request('member', 'GET', '/me/sessions')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${token.token}` } }))
        .statusCode,
    ).toBe(401);
    expect((await signIn('member')).statusCode).not.toBe(200);
    expect(
      (await request('admin', 'PATCH', memberPath('member'), { active: true })).statusCode,
    ).toBe(200);
    expect((await signIn('member')).statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${token.token}` } }))
        .statusCode,
    ).toBe(401);
  });
  it('serializes concurrent self-demotions so one active administrator survives', async () => {
    await request('admin', 'PATCH', memberPath('second'), { role: 'admin' });
    const attempts = await Promise.all(
      ['admin', 'second'].map((name) =>
        request(name, 'PATCH', memberPath(name), { role: 'member' }),
      ),
    );
    expect(attempts.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const remaining = await db.select().from(user).where(eq(user.role, 'admin'));
    expect(remaining.filter((u) => !u.deactivatedAt)).toHaveLength(1);
  });
});
