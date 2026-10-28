import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import {
  invitation as invitationTable,
  project,
  session as sessionTable,
  verification,
} from '../db/schema.ts';
import { memoryMailer } from '../mailer.ts';
import { pkceChallenge } from '../secrets.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const PASSWORD = 'correct-horse-battery';

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

describe.skipIf(!url)('sharing, invitations, tokens and accounts (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'invite',
    CLIPPER_EXTENSION_IDS: EXTENSION_ID,
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const mailer = memoryMailer();
  let auth: ReturnType<typeof createAuth>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';

  type Who = 'owner' | 'editor' | 'viewer' | 'guest' | 'outsider' | 'newbie';
  const as = {} as Record<Who, { cookie: string; id: string; email: string }>;
  let projectId = '';
  let root = '';
  let pre = '';
  let mood = '';

  async function call(
    who: Who | { cookie?: string; bearer?: string } | null,
    method: string,
    path: string,
    payload?: unknown,
  ) {
    const auth = who === null ? {} : typeof who === 'string' ? { cookie: as[who].cookie } : who;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        origin: config.PUBLIC_URL,
        ...(auth.cookie ? { cookie: auth.cookie } : {}),
        ...('bearer' in auth && auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await res.text();
    return {
      status: res.status,
      cookies: res.headers.getSetCookie(),
      readableHeaders: [...res.headers].filter(([name]) => name !== 'set-cookie'),
      body: text ? JSON.parse(text) : null,
    };
  }

  const cookieOf = (cookies: string[], name: string) =>
    cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? '';

  async function expectPrivateSession(res: Awaited<ReturnType<typeof call>>) {
    expect(res.status).toBe(200);
    // Check keys and actual values without printing credentials if the regression returns.
    const text = JSON.stringify(res.body);
    expect(/"token"\s*:/.test(text)).toBe(false);
    const tokens = await db.select({ token: sessionTable.token }).from(sessionTable);
    const readable = text + JSON.stringify(res.readableHeaders);
    expect(tokens.some(({ token }) => readable.includes(token))).toBe(false);
  }

  async function expectSessionCookie(res: Awaited<ReturnType<typeof call>>) {
    await expectPrivateSession(res);
    const cookie = cookieOf(res.cookies, 'inkadra.session_token');
    expect(Boolean(cookie.split('=')[1])).toBe(true);
    expect(
      res.cookies.some((c) => c.startsWith('inkadra.session_token=') && /httponly/i.test(c)),
    ).toBe(true);
    expect((await call({ cookie }, 'GET', '/api/v1/me')).status).toBe(200);
    await expectPrivateSession(await call({ cookie }, 'GET', '/api/auth/get-session'));
    return cookie;
  }

  async function signUp(who: Who, invitationCookie = '') {
    const email = `${who}@example.com`;
    const res = await call({ cookie: invitationCookie }, 'POST', '/api/auth/sign-up/email', {
      email,
      password: PASSWORD,
      name: who[0]?.toUpperCase() + who.slice(1),
    });
    if (res.status === 200)
      as[who] = {
        cookie: cookieOf(res.cookies, 'inkadra.session_token'),
        id: res.body.user.id,
        email,
      };
    return res;
  }

  async function claim(invitationUrl: string) {
    const token = invitationUrl.split('/join/')[1];
    const res = await call(null, 'POST', `/api/v1/invitations/by-token/${token}/claim`);
    return { ...res, cookie: cookieOf(res.cookies, 'inkadra.invitation'), token };
  }

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting, verification cascade`);
    auth = createAuth(config, db, { mailer });
    // Revocation must be observed on the next request, including with the old cookies.
    expect(auth.options).not.toHaveProperty('session.cookieCache.enabled', true);
    expect(auth.options).not.toHaveProperty('secondaryStorage');
    app = await createApp({ config, db, auth, log, mailer, ...testDeps(db, log) });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    expect((await signUp('owner')).status).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('keeps the current session token out of get-session, including refreshes', async () => {
    const current = await call('owner', 'GET', '/api/auth/get-session');
    await expectPrivateSession(current);
    expect(current.body.user.id).toBe(as.owner.id);
    expect(current.body.session.id).toBeTypeOf('string');
    await db
      .update(sessionTable)
      .set({ expiresAt: new Date(Date.now() + 28 * 86_400_000) })
      .where(eq(sessionTable.userId, as.owner.id));
    await expectSessionCookie(await call('owner', 'GET', '/api/auth/get-session'));
    expect((await call(null, 'GET', '/api/auth/get-session')).body).toBeNull();
    // No additional session fields are configured, so this endpoint rejects every update.
    const update = await call('owner', 'POST', '/api/auth/update-session', {});
    expect(update.status).toBe(400);
    expect(/"token"\s*:/.test(JSON.stringify(update.body))).toBe(false);
  });

  it('keeps social sign-in JSON private and preserves OAuth redirects', async () => {
    const context = await auth.$context;
    await context.internalAdapter.updateUser(as.owner.id, { emailVerified: true });
    const provider = context.socialProviders.find((p) => p.id === 'google');
    if (!provider) throw new Error('Missing test provider');
    // Only the external identity provider is stubbed; Better Auth and HTTP are real.
    const options = provider.options;
    provider.options = { ...options, verifyIdToken: async () => true };
    const info = vi.spyOn(provider, 'getUserInfo').mockResolvedValue({
      user: { email: as.owner.email, name: 'Owner', emailVerified: true },
      data: { sub: 'test-google-owner' },
    });
    const exchange = vi.spyOn(provider, 'validateAuthorizationCode').mockResolvedValue({});
    try {
      const signedIn = await expectSessionCookie(
        await call(null, 'POST', '/api/auth/sign-in/social', {
          provider: 'google',
          idToken: { token: 'test-provider-id-token' },
        }),
      );
      expect((await call({ cookie: signedIn }, 'POST', '/api/auth/sign-out', {})).status).toBe(200);
      const start = await call(null, 'POST', '/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: '/',
        disableRedirect: true,
      });
      await expectPrivateSession(start);
      const state = new URL(start.body.url).searchParams.get('state') ?? '';
      const callback = await fetch(
        `${base}/api/auth/callback/google?code=test&state=${encodeURIComponent(state)}`,
        {
          redirect: 'manual',
          headers: { cookie: start.cookies.map((c) => c.split(';')[0]).join('; ') },
        },
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe('/');
      const cookie = cookieOf(callback.headers.getSetCookie(), 'inkadra.session_token');
      expect((await call({ cookie }, 'GET', '/api/v1/me')).status).toBe(200);
      const internal = await auth.api.getSession({ headers: new Headers({ cookie }) });
      expect(typeof internal?.session.token).toBe('string');
      expect((await call({ cookie }, 'POST', '/api/auth/sign-out', {})).status).toBe(200);
    } finally {
      provider.options = options;
      info.mockRestore();
      exchange.mockRestore();
    }
  });

  it('lets new people sign up only through an invitation', async () => {
    const closed = await signUp('editor');
    expect(closed.status).toBe(403);
    expect(closed.body.code).toBe('REGISTRATION_CLOSED');

    // Only administrators invite to the instance alone.
    const link = await call('owner', 'POST', '/api/v1/invitations', { kind: 'link' });
    expect(link.status).toBe(201);
    const { invitation } = link.body;
    expect(invitation).toMatchObject({ kind: 'link', projectId: null, maxUses: null });
    const token = invitation.url.split('/join/')[1];
    const preview = await call(null, 'GET', `/api/v1/invitations/by-token/${token}`);
    expect(preview.body).toMatchObject({ status: 'valid', invitedBy: 'Owner', role: null });

    const claimed = await claim(invitation.url);
    expect(claimed.status).toBe(204);
    for (const who of ['editor', 'viewer', 'guest', 'outsider'] as const)
      await expectSessionCookie(await signUp(who, claimed.cookie));
  });

  it('sets up a project with nested boards', async () => {
    const p = await call('owner', 'POST', '/api/v1/projects', { name: 'Ultima corsa' });
    projectId = p.body.id;
    root = p.body.rootBoardId;
    const a = await call('owner', 'POST', `/api/v1/projects/${projectId}/boards`, {
      parentBoardId: root,
      title: 'Pre-produzione',
    });
    pre = a.body.id;
    const b = await call('owner', 'POST', `/api/v1/projects/${projectId}/boards`, {
      parentBoardId: pre,
      title: 'Moodboard',
    });
    mood = b.body.id;
    for (const [who, role] of [
      ['editor', 'editor'],
      ['viewer', 'viewer'],
    ] as const)
      expect(
        (
          await call('owner', 'PUT', `/api/v1/projects/${projectId}/members/${as[who].id}`, {
            role,
          })
        ).status,
      ).toBe(200);
  });

  it('lets editors add people but keeps role changes for owners', async () => {
    const members = `/api/v1/projects/${projectId}/members`;
    expect(
      (await call('editor', 'PUT', `${members}/${as.outsider.id}`, { role: 'owner' })).status,
    ).toBe(403);
    expect(
      (await call('editor', 'PUT', `${members}/${as.outsider.id}`, { role: 'viewer' })).status,
    ).toBe(200);
    expect(
      (await call('editor', 'PUT', `${members}/${as.outsider.id}`, { role: 'editor' })).status,
    ).toBe(403);
    expect(
      (await call('viewer', 'PUT', `${members}/${as.guest.id}`, { role: 'viewer' })).status,
    ).toBe(403);
    expect((await call('owner', 'DELETE', `${members}/${as.outsider.id}`)).status).toBe(204);
  });

  it('shares one board and what is inside it', async () => {
    const granted = await call('editor', 'PUT', `/api/v1/boards/${pre}/grants/${as.guest.id}`, {
      role: 'editor',
    });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({
      role: 'editor',
      source: { kind: 'board', boardId: pre, boardTitle: 'Pre-produzione' },
      projectRole: null,
    });

    expect((await call('guest', 'GET', '/api/v1/projects')).body.items).toEqual([]);
    const shared = await call('guest', 'GET', '/api/v1/shared-boards');
    expect(shared.body.items.map((b: { id: string }) => b.id)).toEqual([pre]);
    const boards = await call('guest', 'GET', `/api/v1/projects/${projectId}/boards`);
    expect(boards.body.items.map((b: { id: string; myRole: string }) => [b.id, b.myRole])).toEqual(
      expect.arrayContaining([
        [pre, 'editor'],
        [mood, 'editor'],
      ]),
    );
    expect(boards.body.items).toHaveLength(2);
    const detail = await call('guest', 'GET', `/api/v1/boards/${mood}`);
    expect(detail.body.breadcrumb).toEqual([{ id: pre, title: 'Pre-produzione' }]);
    expect((await call('guest', 'GET', `/api/v1/boards/${root}`)).status).toBe(404);
    expect((await call('guest', 'GET', `/api/v1/projects/${projectId}`)).status).toBe(404);
    // AppLayout requests boards even on /p/:id. Its network responses must not disclose
    // whether an inaccessible project exists.
    for (const suffix of ['', '/boards']) {
      const foreign = await call('outsider', 'GET', `/api/v1/projects/${projectId}${suffix}`);
      const missing = await call(
        'outsider',
        'GET',
        `/api/v1/projects/00000000-0000-4000-8000-000000000000${suffix}`,
      );
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(foreign.status);
      expect(missing.body).toEqual(foreign.body);
    }
    const child = (parentBoardId: string) =>
      call('guest', 'POST', `/api/v1/projects/${projectId}/boards`, {
        parentBoardId,
        title: 'Costumi',
      });
    expect((await child(mood)).status).toBe(201);
    expect((await child(root)).status).toBe(404);

    const access = await call('viewer', 'GET', `/api/v1/boards/${mood}/access`);
    expect(access.body.canManage).toBe(false);
    const byName = Object.fromEntries(
      access.body.items.map(
        (e: { user: { id: string }; role: string; source: { kind: string } }) => [
          e.user.id,
          [e.role, e.source.kind],
        ],
      ),
    );
    expect(byName).toEqual({
      [as.owner.id]: ['owner', 'project'],
      [as.editor.id]: ['editor', 'project'],
      [as.viewer.id]: ['viewer', 'project'],
      [as.guest.id]: ['editor', 'board'],
    });
    // Addresses only for the people who share.
    expect(access.body.items.every((e: { user: { email: null } }) => e.user.email === null)).toBe(
      true,
    );
    const managed = await call('editor', 'GET', `/api/v1/boards/${mood}/access`);
    expect(managed.body.items.map((e: { user: { email: string } }) => e.user.email)).toContain(
      as.viewer.email,
    );
  });

  it('keeps grants within the role of the person sharing', async () => {
    const grant = (who: Who, board: string, userId: string, role: string) =>
      call(who, 'PUT', `/api/v1/boards/${board}/grants/${userId}`, { role });
    expect((await grant('editor', pre, as.guest.id, 'owner')).status).toBe(403);
    expect((await grant('editor', pre, as.owner.id, 'viewer')).status).toBe(403);
    expect((await grant('owner', root, as.guest.id, 'viewer')).status).toBe(400);
    expect((await grant('viewer', pre, as.outsider.id, 'viewer')).status).toBe(403);
  });

  it('lets a grant lower the inherited role', async () => {
    expect(
      (
        await call('owner', 'PUT', `/api/v1/boards/${pre}/grants/${as.editor.id}`, {
          role: 'viewer',
        })
      ).status,
    ).toBe(200);
    expect((await call('editor', 'GET', `/api/v1/boards/${mood}`)).body.myRole).toBe('viewer');
    expect((await call('editor', 'PATCH', `/api/v1/boards/${mood}`, { title: 'X' })).status).toBe(
      403,
    );
    expect(
      (await call('owner', 'DELETE', `/api/v1/boards/${pre}/grants/${as.editor.id}`)).status,
    ).toBe(204);
    expect((await call('editor', 'GET', `/api/v1/boards/${mood}`)).body.myRole).toBe('editor');
  });

  it('invites by email and adds the person when they sign up', async () => {
    mailer.sent.length = 0;
    const invite = (who: Who, body: Record<string, unknown>) =>
      call(who, 'POST', '/api/v1/invitations', { kind: 'email', ...body });
    expect(
      (await invite('viewer', { email: 'newbie@example.com', projectId, role: 'viewer' })).status,
    ).toBe(403);
    expect(
      (await invite('editor', { email: 'newbie@example.com', projectId, role: 'owner' })).status,
    ).toBe(403);

    const created = await invite('editor', {
      email: 'Newbie@Example.com',
      projectId,
      role: 'commenter',
    });
    expect(created.status).toBe(201);
    const { invitation } = created.body;
    expect(invitation).toMatchObject({ email: 'newbie@example.com', emailSent: true, maxUses: 1 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain(invitation.url);

    // Email invitations keep no copy of their link.
    const listed = await call('editor', 'GET', `/api/v1/invitations?projectId=${projectId}`);
    expect(listed.body.items.map((i: { id: string; url: string | null }) => [i.id, i.url])).toEqual(
      [[invitation.id, null]],
    );

    // Sending it again makes a new link; the old one stops working. At most once a minute.
    const again = `/api/v1/invitations/${invitation.id}/resend`;
    expect((await call('editor', 'POST', again)).status).toBe(429);
    await db
      .update(invitationTable)
      .set({ lastSentAt: new Date(Date.now() - 120_000) })
      .where(eq(invitationTable.id, invitation.id));
    const resent = await call('editor', 'POST', again);
    expect(resent.status).toBe(200);
    expect(resent.body.url).not.toBe(invitation.url);
    expect((await claim(invitation.url)).status).toBe(404);

    const claimed = await claim(resent.body.url);
    // The link is for that address: no other account can accept it or sign up with it.
    const intruder = await call({ cookie: claimed.cookie }, 'POST', '/api/auth/sign-up/email', {
      email: 'intruder@example.com',
      password: PASSWORD,
      name: 'Intruder',
    });
    expect(intruder.status).toBe(403);
    expect(intruder.body.code).toBe('INVITATION_EMAIL_MISMATCH');
    const forwarded = `/api/v1/invitations/by-token/${claimed.token}/accept`;
    expect((await call('outsider', 'POST', forwarded)).status).toBe(403);

    expect((await signUp('newbie', claimed.cookie)).status).toBe(200);
    const projects = await call('newbie', 'GET', '/api/v1/projects');
    expect(
      projects.body.items.map((p: { id: string; myRole: string }) => [p.id, p.myRole]),
    ).toEqual([[projectId, 'commenter']]);
    const used = await call(null, 'GET', `/api/v1/invitations/by-token/${claimed.token}`);
    expect(used.body.status).toBe('used');
    // Back on the link after signing up elsewhere (Google, OIDC): it leads to the project,
    // without counting another use; other accounts still cannot use it.
    const back = await call('newbie', 'POST', forwarded);
    expect(back.status).toBe(200);
    expect(back.body).toEqual({ projectId, boardId: null });
    const [row] = await db
      .select({ uses: invitationTable.uses })
      .from(invitationTable)
      .where(eq(invitationTable.id, invitation.id));
    expect(row?.uses).toBe(1);
    expect((await call('outsider', 'POST', forwarded)).status).toBe(404);
  });

  it('gives the role straight away to people who have an account', async () => {
    const res = await call('editor', 'POST', '/api/v1/invitations', {
      kind: 'email',
      email: as.outsider.email,
      boardId: mood,
      role: 'viewer',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'added', entry: { role: 'viewer' } });
    const shared = await call('outsider', 'GET', '/api/v1/shared-boards');
    expect(shared.body.items.map((b: { id: string }) => b.id)).toEqual([mood]);
  });

  it('accepts a link with an account and stops a revoked link', async () => {
    const link = await call('owner', 'POST', '/api/v1/invitations', {
      kind: 'link',
      projectId,
      role: 'viewer',
    });
    const token = link.body.invitation.url.split('/join/')[1];
    const accepted = await call('outsider', 'POST', `/api/v1/invitations/by-token/${token}/accept`);
    expect(accepted.body).toEqual({ projectId, boardId: null });
    expect((await call('outsider', 'GET', `/api/v1/projects/${projectId}`)).body.myRole).toBe(
      'viewer',
    );

    expect(
      (await call('editor', 'DELETE', `/api/v1/invitations/${link.body.invitation.id}`)).status,
    ).toBe(204);
    expect((await call(null, 'POST', `/api/v1/invitations/by-token/${token}/claim`)).status).toBe(
      404,
    );
  });

  it('caps invitation links at editor; owners are named from the people page', async () => {
    const own = await call('owner', 'POST', '/api/v1/projects', { name: 'Eredità' });
    const legacyProject = own.body.id;
    for (const target of [{ projectId: legacyProject }, { boardId: mood }]) {
      const res = await call('owner', 'POST', '/api/v1/invitations', {
        kind: 'link',
        ...target,
        role: 'owner',
      });
      expect(res.status).toBe(400);
    }

    // A link made with owner before API 0.6.0 stays, and gives editor.
    const link = await call('owner', 'POST', '/api/v1/invitations', {
      kind: 'link',
      projectId: legacyProject,
      role: 'editor',
    });
    await db
      .update(invitationTable)
      .set({ role: 'owner' })
      .where(eq(invitationTable.id, link.body.invitation.id));
    const token = link.body.invitation.url.split('/join/')[1];
    expect((await call(null, 'GET', `/api/v1/invitations/by-token/${token}`)).body.role).toBe(
      'editor',
    );
    const listed = await call('owner', 'GET', `/api/v1/invitations?projectId=${legacyProject}`);
    expect(listed.body.items).toMatchObject([{ id: link.body.invitation.id, role: 'editor' }]);
    await call('outsider', 'POST', `/api/v1/invitations/by-token/${token}/accept`);
    const project = `/api/v1/projects/${legacyProject}`;
    expect((await call('outsider', 'GET', project)).body.myRole).toBe('editor');
    const [row] = await db
      .select({ role: invitationTable.role })
      .from(invitationTable)
      .where(eq(invitationTable.id, link.body.invitation.id));
    expect(row?.role).toBe('owner');

    const promoted = await call('owner', 'PUT', `${project}/members/${as.outsider.id}`, {
      role: 'owner',
    });
    expect(promoted.status).toBe(200);
    expect((await call('outsider', 'GET', project)).body.myRole).toBe('owner');
  });

  it('searches people only for those who can share', async () => {
    expect((await call('viewer', 'GET', '/api/v1/users/search?q=out')).status).toBe(403);
    const found = await call('editor', 'GET', '/api/v1/users/search?q=out');
    expect(found.body.items.map((p: { email: string }) => p.email)).toEqual([as.outsider.email]);
  });

  it('signs in with personal tokens, which cannot manage the account', async () => {
    const created = await call('owner', 'POST', '/api/v1/me/tokens', { name: 'Script' });
    expect(created.status).toBe(201);
    const { token, id } = created.body;
    expect(token).toMatch(/^ink_/);
    const bearer = { bearer: token };
    expect(new Date(created.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(89 * 86_400_000);
    expect((await call(bearer, 'GET', '/api/v1/instance/members')).status).toBe(403);
    expect((await call(bearer, 'GET', '/api/v1/diagnostics')).status).toBe(403);
    expect((await call(bearer, 'GET', '/api/v1/me')).body.id).toBe(as.owner.id);
    expect((await call(bearer, 'POST', '/api/v1/me/tokens', { name: 'More' })).status).toBe(403);
    expect((await call(bearer, 'DELETE', '/api/v1/me', { password: PASSWORD })).status).toBe(403);
    const listed = await call('owner', 'GET', '/api/v1/me/tokens');
    expect(listed.body.items[0]).toMatchObject({ id, name: 'Script', client: null });
    expect(listed.body.items[0].lastUsedAt).not.toBeNull();
    expect((await call(bearer, 'DELETE', `/api/v1/me/tokens/${id}`)).status).toBe(204);
    expect((await call(bearer, 'GET', '/api/v1/me')).status).toBe(401);
  });

  it('requires a fresh cookie session to create tokens and app authorizations', async () => {
    await db.update(sessionTable).set({ createdAt: new Date(Date.now() - 16 * 60_000) }).where(eq(sessionTable.userId, as.owner.id));
    try {
      expect((await call('owner', 'POST', '/api/v1/me/tokens', { name: 'Stale' })).status).toBe(403);
      expect((await call('owner', 'POST', '/api/v1/app-authorizations', {})).status).toBe(403);
    } finally {
      await db.update(sessionTable).set({ createdAt: new Date() }).where(eq(sessionTable.userId, as.owner.id));
    }
  });

  it('lists sessions without tokens and ends only your own, by id', async () => {
    const signIn = await call(null, 'POST', '/api/auth/sign-in/email', {
      email: as.owner.email,
      password: PASSWORD,
    });
    await expectSessionCookie(signIn);
    const other = { cookie: cookieOf(signIn.cookies, 'inkadra.session_token') };
    const listed = await call('owner', 'GET', '/api/v1/me/sessions');
    expect(listed.status).toBe(200);
    expect((await call(null, 'GET', '/api/v1/me/sessions')).status).toBe(401);
    const tokens = await db.select({ token: sessionTable.token }).from(sessionTable);
    for (const { token } of tokens) expect(JSON.stringify(listed.body)).not.toContain(token);
    for (const item of listed.body.items) {
      expect(Object.keys(item).sort()).toEqual([
        'createdAt',
        'current',
        'expiresAt',
        'id',
        'ipAddress',
        'updatedAt',
        'userAgent',
      ]);
      expect(item.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    const mine = listed.body.items.find((s: { current: boolean }) => s.current);
    const second = listed.body.items.find((s: { current: boolean }) => !s.current);
    expect(mine && second).toBeTruthy();
    // Better Auth's endpoints that hand out or take session tokens are off.
    const raw = (method: string, path: string) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          origin: config.PUBLIC_URL,
          cookie: as.owner.cookie,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify({ token: 'x' }) } : {}),
      });
    expect((await raw('GET', '/api/auth/list-sessions')).status).toBe(404);
    expect((await raw('POST', '/api/auth/revoke-session')).status).toBe(404);
    for (const endpoint of ['list-sessions', 'revoke-session']) {
      for (const path of [
        `/api/auth/${endpoint}?x=1`,
        `/api/auth/${endpoint}/`,
        `/api/auth//${endpoint}`,
        `/api/auth/${endpoint.replace('-', '%2D')}`,
        `/api/auth/${endpoint.toUpperCase()}`,
        `/api/auth/x/../${endpoint}`,
        `/api/auth%2F${endpoint}`,
        `/api/auth/${endpoint};x`,
      ]) {
        for (const method of ['GET', 'POST', 'HEAD', 'DELETE', 'PUT', 'OPTIONS']) {
          const response = await raw(method, path);
          expect([404, 405], `${method} ${path}`).toContain(response.status);
          await response.arrayBuffer();
        }
      }
    }

    // Someone else's session is not found, and tokens cannot end sessions.
    const theirs = (await call('editor', 'GET', '/api/v1/me/sessions')).body.items[0];
    expect((await call('owner', 'DELETE', `/api/v1/me/sessions/${theirs.id}`)).status).toBe(404);
    expect((await call('editor', 'GET', '/api/v1/me')).status).toBe(200);
    const created = await call('owner', 'POST', '/api/v1/me/tokens', { name: 'Sessions' });
    const bearer = { bearer: created.body.token };
    expect((await call(bearer, 'GET', '/api/v1/me/sessions')).status).toBe(403);
    expect((await call(bearer, 'DELETE', `/api/v1/me/sessions/${second.id}`)).status).toBe(403);

    expect((await call(other, 'GET', '/api/v1/me')).status).toBe(200);
    expect((await call('owner', 'DELETE', `/api/v1/me/sessions/${second.id}`)).status).toBe(204);
    expect((await call(other, 'GET', '/api/v1/me')).status).toBe(401);
    expect((await call('owner', 'GET', '/api/v1/me')).status).toBe(200);
    expect((await call('owner', 'DELETE', `/api/v1/me/sessions/${second.id}`)).status).toBe(404);

    const again = await call(null, 'POST', '/api/auth/sign-in/email', {
      email: as.owner.email,
      password: PASSWORD,
    });
    const fresh = { cookie: cookieOf(again.cookies, 'inkadra.session_token') };
    const self = (await call(fresh, 'GET', '/api/v1/me/sessions')).body.items.find(
      (s: { current: boolean }) => s.current,
    );
    expect((await call(fresh, 'DELETE', `/api/v1/me/sessions/${self.id}`)).status).toBe(204);
    expect((await call(fresh, 'GET', '/api/v1/me')).status).toBe(401);
    expect((await call('owner', 'POST', '/api/auth/revoke-other-sessions', {})).status).toBe(200);
    expect((await call('owner', 'GET', '/api/v1/me')).status).toBe(200);
  });

  it('tells a denied app only on its exact redirect address, with the state', async () => {
    const redirectUri = `https://${EXTENSION_ID}.chromiumapp.org/auth`;
    const deny = (body: Record<string, unknown>, who: Who | null = 'editor') =>
      call(who, 'POST', '/api/v1/app-authorizations/deny', {
        clientId: 'clipper',
        redirectUri,
        state: 'xyz',
        ...body,
      });
    expect((await deny({}, null)).status).toBe(401);
    for (const bad of [
      'https://evilevilevilevilevilevilevilevil.chromiumapp.org/auth',
      `https://${EXTENSION_ID}.chromiumapp.org/other`,
      'inkadra://auth',
      `${redirectUri}?state=leaked`,
      `${redirectUri}#fragment`,
      `${redirectUri}/../other`,
      `${redirectUri}.evil.example`,
      `https://${EXTENSION_ID}.chromiumapp.org@evil.example/auth`,
    ])
      expect((await deny({ redirectUri: bad })).status).toBe(400);
    expect((await deny({ clientId: 'mobile' })).status).toBe(400);

    const token = await call('owner', 'POST', '/api/v1/me/tokens', { name: 'Deny test' });
    expect(
      (
        await call({ bearer: token.body.token }, 'POST', '/api/v1/app-authorizations/deny', {
          clientId: 'mobile',
          redirectUri: 'inkadra://auth',
        })
      ).status,
    ).toBe(403);
    for (const origin of [
      'https://evil.example',
      'http://sibling.localhost:3000',
      'null',
      undefined,
    ]) {
      const response = await fetch(`${base}/api/v1/app-authorizations/deny`, {
        method: 'POST',
        headers: {
          cookie: as.editor.cookie,
          'content-type': 'application/json',
          ...(origin === undefined ? {} : { origin }),
        },
        body: JSON.stringify({ clientId: 'clipper', redirectUri, state: 'private-state' }),
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).not.toContain('private-state');
    }

    const before = await db.select().from(verification);
    const denied = await deny({});
    expect(await db.select().from(verification)).toEqual(before);
    expect(denied.status).toBe(200);
    const target = new URL(denied.body.redirectTo);
    expect(target.origin + target.pathname).toBe(redirectUri);
    expect(Object.fromEntries(target.searchParams)).toEqual({
      error: 'access_denied',
      state: 'xyz',
    });
    const mobile = new URL(
      (await deny({ clientId: 'mobile', redirectUri: 'inkadra://auth', state: undefined })).body
        .redirectTo,
    );
    expect(mobile.searchParams.get('error')).toBe('access_denied');
    expect(mobile.searchParams.has('code')).toBe(false);
  });

  it('gives the official apps a token with a PKCE code', async () => {
    const verifier = randomBytes(32).toString('base64url');
    const redirectUri = `https://${EXTENSION_ID}.chromiumapp.org/auth`;
    const authorize = (body: Record<string, unknown>) =>
      call('editor', 'POST', '/api/v1/app-authorizations', {
        clientId: 'clipper',
        redirectUri,
        codeChallenge: pkceChallenge(verifier),
        codeChallengeMethod: 'S256',
        state: 'xyz',
        deviceName: 'Chrome su MacBook',
        ...body,
      });
    expect(
      (
        await authorize({
          redirectUri: 'https://evilevilevilevilevilevilevilevil.chromiumapp.org/auth',
        })
      ).status,
    ).toBe(400);

    const exchange = (code: string, codeVerifier = verifier) =>
      call(null, 'POST', '/api/v1/app-authorizations/token', {
        clientId: 'clipper',
        code,
        codeVerifier,
        redirectUri,
      });
    const first = new URL((await authorize({})).body.redirectTo);
    expect(first.origin + first.pathname).toBe(redirectUri);
    expect(first.searchParams.get('state')).toBe('xyz');
    expect((await exchange(first.searchParams.get('code') ?? '', 'x'.repeat(43))).status).toBe(400);

    const second = new URL((await authorize({})).body.redirectTo);
    const code = second.searchParams.get('code') ?? '';
    const issued = await exchange(code);
    expect(issued.status).toBe(200);
    expect(issued.body.user.id).toBe(as.editor.id);
    expect((await exchange(code)).status).toBe(400);
    const me = await call({ bearer: issued.body.token }, 'GET', '/api/v1/me');
    expect(me.body.email).toBe(as.editor.email);
    const tokens = await call('editor', 'GET', '/api/v1/me/tokens');
    expect(tokens.body.items).toEqual([
      expect.objectContaining({ name: 'Chrome su MacBook', client: 'clipper' }),
    ]);
  });

  it('emails sign-in links only to people who may sign in', async () => {
    mailer.sent.length = 0;
    const ask = (email: string) => call(null, 'POST', '/api/auth/sign-in/magic-link', { email });
    expect((await ask(as.editor.email)).status).toBe(200);
    expect((await ask('stranger@example.com')).status).toBe(200);
    expect(mailer.sent.map((m) => m.to)).toEqual([as.editor.email]);
    expect(mailer.sent[0]?.text).toContain('/api/auth/magic-link/verify');
    const link = new URL(mailer.sent[0]?.text.match(/https?:\/\/\S+/)?.[0] ?? '');
    // Removing callbackURL selects Better Auth's page-readable JSON response.
    link.searchParams.delete('callbackURL');
    await expectSessionCookie(await call(null, 'GET', `${link.pathname}${link.search}`));
  });

  it('asks for a code after enabling two-factor authentication', async () => {
    const enabled = await call('viewer', 'POST', '/api/auth/two-factor/enable', {
      password: PASSWORD,
    });
    expect(enabled.status).toBe(200);
    const secret = new URL(enabled.body.totpURI).searchParams.get('secret') ?? '';
    expect(enabled.body.backupCodes.length).toBeGreaterThan(0);
    const verified = await call(
      { cookie: [as.viewer.cookie, ...enabled.cookies.map((c) => c.split(';')[0])].join('; ') },
      'POST',
      '/api/auth/two-factor/verify-totp',
      { code: totp(secret) },
    );
    expect(verified.status).toBe(200);
    await expectSessionCookie(verified);
    // Turning it on replaces the session.
    as.viewer.cookie = cookieOf(verified.cookies, 'inkadra.session_token');
    expect((await call('viewer', 'GET', '/api/v1/me')).body.twoFactorEnabled).toBe(true);

    mailer.sent.length = 0;
    const magic = await call(null, 'POST', '/api/auth/sign-in/magic-link', { email: as.viewer.email });
    expect(magic.status).toBe(200);
    const link = new URL(mailer.sent[0]?.text.match(/https?:\/\/\S+/)?.[0] ?? '');
    const response = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?twoFactor=true');
    const challenge = response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    expect((await call({ cookie: challenge }, 'GET', '/api/v1/me')).status).toBe(401);
    const completed = await call({ cookie: challenge }, 'POST', '/api/auth/two-factor/verify-totp', { code: totp(secret) });
    await expectSessionCookie(completed);

    const signIn = await call(null, 'POST', '/api/auth/sign-in/email', {
      email: as.viewer.email,
      password: PASSWORD,
    });
    expect(signIn.body.twoFactorRedirect).toBe(true);
    await expectPrivateSession(signIn);
    expect(cookieOf(signIn.cookies, 'inkadra.session_token').split('=')[1] ?? '').toBe('');
    const second = await call(
      { cookie: signIn.cookies.map((c) => c.split(';')[0]).join('; ') },
      'POST',
      '/api/auth/two-factor/verify-totp',
      { code: totp(secret) },
    );
    expect(second.status).toBe(200);
    await expectSessionCookie(second);
    const again = await call(null, 'POST', '/api/auth/sign-in/email', {
      email: as.viewer.email,
      password: PASSWORD,
    });
    await expectSessionCookie(
      await call(
        { cookie: again.cookies.map((c) => c.split(';')[0]).join('; ') },
        'POST',
        '/api/auth/two-factor/verify-backup-code',
        { code: enabled.body.backupCodes[0] },
      ),
    );
  });

  it('rotates the password session only through its httpOnly cookie', async () => {
    const issued = await call('guest', 'POST', '/api/v1/me/tokens', { name: 'Before password change' });
    expect(issued.status).toBe(201);
    const changed = await call('guest', 'POST', '/api/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: `${PASSWORD}-changed`,
      revokeOtherSessions: true,
    });
    await expectSessionCookie(changed);
    expect((await call({ bearer: issued.body.token }, 'GET', '/api/v1/me')).status).toBe(401);
    expect(mailer.sent.some((m) => m.to === as.guest.email && m.subject === 'Password modificata')).toBe(true);
    expect((await call('guest', 'GET', '/api/v1/me')).status).toBe(401);
  });

  it('deletes an account, but not while it is the only owner of a shared project', async () => {
    const blocked = await call('owner', 'DELETE', '/api/v1/me', { password: PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.soleOwnerOf).toEqual([
      { id: projectId, name: 'Ultima corsa' },
    ]);

    const solo = await call('newbie', 'POST', '/api/v1/projects', { name: 'Solo' });
    // A project shared only through a board counts as shared.
    const lent = await call('newbie', 'POST', '/api/v1/projects', { name: 'Prestito' });
    const lentBoard = await call('newbie', 'POST', `/api/v1/projects/${lent.body.id}/boards`, {
      parentBoardId: lent.body.rootBoardId,
      title: 'Sopralluoghi',
    });
    const grant = `/api/v1/boards/${lentBoard.body.id}/grants/${as.outsider.id}`;
    expect((await call('newbie', 'PUT', grant, { role: 'viewer' })).status).toBe(200);
    const withGuest = await call('newbie', 'DELETE', '/api/v1/me', { password: PASSWORD });
    expect(withGuest.status).toBe(409);
    expect(withGuest.body.error.details.soleOwnerOf).toEqual([
      { id: lent.body.id, name: 'Prestito' },
    ]);
    expect((await call('newbie', 'DELETE', grant)).status).toBe(204);

    expect(
      (await call('newbie', 'DELETE', '/api/v1/me', { password: 'wrong-password-123' })).status,
    ).toBe(403);
    expect((await call('newbie', 'DELETE', '/api/v1/me', {})).status).toBe(400);
    expect((await call('newbie', 'DELETE', '/api/v1/me', { password: PASSWORD })).status).toBe(204);
    expect(await db.select().from(project).where(eq(project.id, solo.body.id))).toEqual([]);
    expect((await call('newbie', 'GET', '/api/v1/me')).status).toBe(401);
    // The shared project stays, without the person.
    const members = await call('owner', 'GET', `/api/v1/projects/${projectId}/members`);
    expect(members.body.items.map((m: { user: { id: string } }) => m.user.id)).not.toContain(
      as.newbie.id,
    );
  });
});
