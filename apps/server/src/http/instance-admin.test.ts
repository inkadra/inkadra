import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { InstanceMember, InstanceSettings, StorageUsage } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disableAdminTwoFactor } from '../admin-two-factor.ts';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  account,
  asset,
  assetVariant,
  boardElementIndex,
  boardGrant,
  instanceSetting,
  personalToken,
  projectMember,
  session,
  twoFactor,
  user,
} from '../db/schema.ts';
import { memoryMailer } from '../mailer.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { createApp } from './app.ts';

/** RFC 6238 code (SHA-1, 30 s, 6 digits) for a base32 secret, as authenticator apps do. */
function totp(base32: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of base32.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

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

  it('enforces enrollment for session, token and account endpoints, and unlocks after enrollment', async () => {
    const token = await issueToken(db, people.admin!.id, { name: 'Enrollment regression' });
    const [previousSettings] = await db
      .select()
      .from(instanceSetting)
      .where(eq(instanceSetting.key, 'administration'));
    await db
      .insert(instanceSetting)
      .values({ key: 'administration', value: { requireAdminTwoFactor: true } })
      .onConflictDoUpdate({
        target: instanceSetting.key,
        set: { value: { requireAdminTwoFactor: true } },
      });
    try {
      for (const path of ['/projects', '/instance/settings']) {
        const response = await request('admin', 'GET', path);
        expect(response.statusCode).toBe(403);
        expect(response.json().error.details.reason).toBe('admin_two_factor_required');
      }
      expect((await request('admin', 'GET', '/me')).statusCode).toBe(200);
      expect(
        (await request('admin', 'POST', '/me/tokens', { name: 'Blocked creation' })).statusCode,
      ).toBe(403);
      const sessionsList = await request('admin', 'GET', '/me/sessions');
      expect(sessionsList.statusCode).toBe(200);
      expect(sessionsList.json().items.length).toBeGreaterThan(0);
      const ownSessions = await db
        .select()
        .from(session)
        .where(eq(session.userId, people.admin!.id));
      expect(
        sessionsList
          .json()
          .items.every((row: { id: string }) => ownSessions.some((own) => own.id === row.id)),
      ).toBe(true);
      expect(JSON.stringify(sessionsList.json())).not.toContain('"token":');
      const tokensList = await request('admin', 'GET', '/me/tokens');
      expect(tokensList.statusCode).toBe(200);
      expect(tokensList.json().items.map((row: { id: string }) => row.id)).toContain(token.row.id);
      expect(JSON.stringify(tokensList.json())).not.toContain(token.token);

      expect((await request('member', 'GET', '/projects')).statusCode).toBe(200);
      expect(
        (
          await app.inject({
            url: '/api/v1/projects',
            headers: { authorization: `Bearer ${token.token}` },
          })
        ).statusCode,
      ).toBe(403);
      const beforeSessions = await db
        .select()
        .from(session)
        .where(eq(session.userId, people.admin!.id));
      expect((await signIn('admin')).statusCode).toBe(200);
      const afterSessions = await db
        .select()
        .from(session)
        .where(eq(session.userId, people.admin!.id));
      const otherSession = afterSessions.find(
        (row) => !beforeSessions.some((old) => old.id === row.id),
      )!;
      expect((await request('admin', 'DELETE', `/me/sessions/${otherSession.id}`)).statusCode).toBe(
        204,
      );
      expect((await request('admin', 'DELETE', `/me/tokens/${token.row.id}`)).statusCode).toBe(204);
      const [memberSession] = await db
        .select()
        .from(session)
        .where(eq(session.userId, people.member!.id));
      const memberToken = await issueToken(db, people.member!.id, { name: 'Other owner' });
      const ownTokensAfterRevocation = await request('admin', 'GET', '/me/tokens');
      expect(ownTokensAfterRevocation.statusCode).toBe(200);
      expect(
        ownTokensAfterRevocation.json().items.map((row: { id: string }) => row.id),
      ).not.toContain(memberToken.row.id);

      expect(
        (await request('admin', 'DELETE', `/me/sessions/${memberSession!.id}`)).statusCode,
      ).toBe(404);
      expect(
        (await request('admin', 'DELETE', `/me/tokens/${memberToken.row.id}`)).statusCode,
      ).toBe(404);
      await db.delete(personalToken).where(eq(personalToken.id, memberToken.row.id));

      await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, people.admin!.id));
      expect((await request('admin', 'GET', '/projects')).statusCode).toBe(200);
      expect((await request('admin', 'GET', '/instance/settings')).statusCode).toBe(200);
    } finally {
      await db
        .update(instanceSetting)
        .set({ value: previousSettings?.value ?? {} })
        .where(eq(instanceSetting.key, 'administration'));
      await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, people.admin!.id));
      await db.delete(personalToken).where(eq(personalToken.id, token.row.id));
    }
  });

  it('lets a passwordless administrator enroll and unlocks only after a verified TOTP', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/two-factor/enable',
          headers: { cookie: people.admin!.cookie, origin: config.PUBLIC_URL },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    const registered = await signUp('passwordless');
    expect(registered.statusCode).toBe(200);
    const id = registered.json().user.id;
    const cookie = String(registered.headers['set-cookie']).split(';')[0] ?? '';
    await db.delete(account).where(eq(account.userId, id));
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, id));
    const [previousSettings] = await db
      .select()
      .from(instanceSetting)
      .where(eq(instanceSetting.key, 'administration'));
    await db
      .insert(instanceSetting)
      .values({ key: 'administration', value: { requireAdminTwoFactor: true } })
      .onConflictDoUpdate({
        target: instanceSetting.key,
        set: { value: { requireAdminTwoFactor: true } },
      });
    try {
      const headers = { cookie, origin: config.PUBLIC_URL };
      expect((await app.inject({ url: '/api/v1/projects', headers })).statusCode).toBe(403);
      const enabled = await app.inject({
        method: 'POST',
        url: '/api/auth/two-factor/enable',
        headers,
        payload: {},
      });
      expect(enabled.statusCode).toBe(200);
      expect(enabled.json().backupCodes.length).toBeGreaterThan(0);
      expect((await app.inject({ url: '/api/v1/projects', headers })).statusCode).toBe(403);
      const secret = new URL(enabled.json().totpURI).searchParams.get('secret') ?? '';
      const verified = await app.inject({
        method: 'POST',
        url: '/api/auth/two-factor/verify-totp',
        headers,
        payload: { code: totp(secret) },
      });
      expect(verified.statusCode).toBe(200);
      const newCookie = String(verified.headers['set-cookie']).split(';')[0] ?? '';
      expect(
        (await app.inject({ url: '/api/v1/projects', headers: { cookie: newCookie } })).statusCode,
      ).toBe(200);
      const [beforeRecovery] = await db.select().from(twoFactor).where(eq(twoFactor.userId, id));
      await db
        .update(session)
        .set({ createdAt: new Date(Date.now() - 16 * 60_000) })
        .where(eq(session.userId, id));
      const recoveryPaths = ['/two-factor/get-totp-uri', '/two-factor/generate-backup-codes'];
      const recoveryStatuses = [];
      for (const path of recoveryPaths)
        recoveryStatuses.push(
          (
            await app.inject({
              method: 'POST',
              url: `/api/auth${path}`,
              headers: { cookie: newCookie, origin: config.PUBLIC_URL },
              payload: {},
            })
          ).statusCode,
        );
      expect(recoveryStatuses).toEqual([403, 403]);
      const [afterRecovery] = await db.select().from(twoFactor).where(eq(twoFactor.userId, id));
      expect(afterRecovery?.backupCodes).toBe(beforeRecovery?.backupCodes);
      await db.update(session).set({ createdAt: new Date() }).where(eq(session.userId, id));
      for (const path of recoveryPaths)
        expect(
          (
            await app.inject({
              method: 'POST',
              url: `/api/auth${path}`,
              headers: { cookie: newCookie, origin: config.PUBLIC_URL },
              payload: {},
            })
          ).statusCode,
        ).toBe(200);
    } finally {
      await db
        .update(instanceSetting)
        .set({ value: previousSettings?.value ?? {} })
        .where(eq(instanceSetting.key, 'administration'));
      await db.update(user).set({ role: 'member' }).where(eq(user.id, id));
    }
  });

  it('can disable the administrator requirement locally without losing unrelated settings', async () => {
    const [previous] = await db
      .select()
      .from(instanceSetting)
      .where(eq(instanceSetting.key, 'administration'));
    await db
      .insert(instanceSetting)
      .values({
        key: 'administration',
        value: {
          name: 'Recovery studio',
          registration: 'invite',
          requireAdminTwoFactor: true,
          retained: 'yes',
        },
      })
      .onConflictDoUpdate({
        target: instanceSetting.key,
        set: {
          value: {
            name: 'Recovery studio',
            registration: 'invite',
            requireAdminTwoFactor: true,
            retained: 'yes',
          },
        },
      });
    try {
      expect((await request('admin', 'GET', '/projects')).statusCode).toBe(403);
      await disableAdminTwoFactor(db);
      const [saved] = await db
        .select()
        .from(instanceSetting)
        .where(eq(instanceSetting.key, 'administration'));
      expect(saved?.value).toEqual({
        name: 'Recovery studio',
        registration: 'invite',
        requireAdminTwoFactor: false,
        retained: 'yes',
      });
      expect((await request('admin', 'GET', '/projects')).statusCode).toBe(200);
      await disableAdminTwoFactor(db);
    } finally {
      await db
        .update(instanceSetting)
        .set({ value: previous?.value ?? {} })
        .where(eq(instanceSetting.key, 'administration'));
    }
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
    ).toEqual({
      name: 'Studio',
      registration: 'invite',
      requireAdminTwoFactor: false,
      // Decision 0041: on by default, the behaviour before the setting existed.
      membersCanCreateProjects: true,
    });
    expect((await app.inject('/api/v1/instance')).json()).toMatchObject({
      name: 'Studio',
      registration: 'invite',
    });
    expect((await signUp('blocked')).statusCode).toBe(403);
  });
  it('refuses policy activation by an administrator without verified two-factor authentication', async () => {
    const [previous] = await db
      .select()
      .from(instanceSetting)
      .where(eq(instanceSetting.key, 'administration'));
    try {
      const rejected = await request('admin', 'PATCH', '/instance/settings', {
        requireAdminTwoFactor: true,
      });
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json().error.details.reason).toBe(
        'admin_two_factor_enrollment_required_to_enable',
      );
      expect(
        (await request('admin', 'GET', '/instance/settings')).json().requireAdminTwoFactor,
      ).toBe(false);
    } finally {
      await db
        .update(instanceSetting)
        .set({ value: previous?.value ?? {} })
        .where(eq(instanceSetting.key, 'administration'));
    }
  });

  it('defaults the enrollment policy off, validates it and preserves it across partial writes', async () => {
    expect((await request('admin', 'GET', '/instance/settings')).json().requireAdminTwoFactor).toBe(
      false,
    );
    expect(
      (await request('admin', 'PATCH', '/instance/settings', { requireAdminTwoFactor: 'true' }))
        .statusCode,
    ).toBe(400);
    const [previous] = await db
      .select()
      .from(instanceSetting)
      .where(eq(instanceSetting.key, 'administration'));
    // Enroll the fixture administrator so this also remains valid with auth enforcement applied.
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, people.admin!.id));
    try {
      expect(
        (
          await request('admin', 'PATCH', '/instance/settings', { requireAdminTwoFactor: true })
        ).json().requireAdminTwoFactor,
      ).toBe(true);
      expect(
        (await request('admin', 'PATCH', '/instance/settings', { name: 'Studio' })).json()
          .requireAdminTwoFactor,
      ).toBe(true);
    } finally {
      await db
        .update(instanceSetting)
        .set({ value: previous?.value ?? {} })
        .where(eq(instanceSetting.key, 'administration'));
      await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, people.admin!.id));
    }
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
