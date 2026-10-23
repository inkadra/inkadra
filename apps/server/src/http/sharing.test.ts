import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { invitation as invitationTable, project } from '../db/schema.ts';
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
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const mailer = memoryMailer();
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
      body: text ? JSON.parse(text) : null,
    };
  }

  const cookieOf = (cookies: string[], name: string) =>
    cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? '';

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
    const auth = createAuth(config, db, { mailer });
    app = await createApp({ config, db, auth, log, mailer, ...testDeps(db, log) });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    expect((await signUp('owner')).status).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
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
      expect((await signUp(who, claimed.cookie)).status).toBe(200);
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
    expect((await call(bearer, 'GET', '/api/v1/me')).body.id).toBe(as.owner.id);
    expect((await call(bearer, 'POST', '/api/v1/me/tokens', { name: 'More' })).status).toBe(403);
    expect((await call(bearer, 'DELETE', '/api/v1/me', { password: PASSWORD })).status).toBe(403);
    const listed = await call('owner', 'GET', '/api/v1/me/tokens');
    expect(listed.body.items[0]).toMatchObject({ id, name: 'Script', client: null });
    expect(listed.body.items[0].lastUsedAt).not.toBeNull();
    expect((await call(bearer, 'DELETE', `/api/v1/me/tokens/${id}`)).status).toBe(204);
    expect((await call(bearer, 'GET', '/api/v1/me')).status).toBe(401);
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
    // Turning it on replaces the session.
    as.viewer.cookie = cookieOf(verified.cookies, 'inkadra.session_token');
    expect((await call('viewer', 'GET', '/api/v1/me')).body.twoFactorEnabled).toBe(true);

    const signIn = await call(null, 'POST', '/api/auth/sign-in/email', {
      email: as.viewer.email,
      password: PASSWORD,
    });
    expect(signIn.body.twoFactorRedirect).toBe(true);
    expect(cookieOf(signIn.cookies, 'inkadra.session_token').split('=')[1] ?? '').toBe('');
    const second = await call(
      { cookie: signIn.cookies.map((c) => c.split(';')[0]).join('; ') },
      'POST',
      '/api/auth/two-factor/verify-totp',
      { code: totp(secret) },
    );
    expect(second.status).toBe(200);
    expect(cookieOf(second.cookies, 'inkadra.session_token').split('=')[1]).toBeTruthy();
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
