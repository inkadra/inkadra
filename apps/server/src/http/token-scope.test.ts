import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiError } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { board, personalToken, project, projectMember, user } from '../db/schema.ts';
import { pkceChallenge } from '../secrets.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { OFFICIAL_CLIPPER_IDS } from './account-routes.ts';
import { createApp } from './app.ts';
import { requireActor } from './auth-routes.ts';

const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('token scopes (decision 0137)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const log = pino({ level: 'silent' });
  const other = randomUUID();
  const mine = randomUUID();
  const theirs = randomUUID();
  const myBoard = randomUUID();
  const theirBoard = randomUUID();
  let me = '';
  let cookie = '';
  let app: Awaited<ReturnType<typeof createApp>>;
  const auth = createAuth(config, db);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const call = (token: string, method: string, path: string, payload?: object) =>
    app.inject({
      method: method as 'GET',
      url: `/api/v1${path}`,
      headers: bearer(token),
      ...(payload ? { payload } : {}),
    });

  /** A Clipper token the way the extension gets one: /authorize, then the code exchange. */
  async function clipperSignIn() {
    const verifier = randomBytes(32).toString('base64url');
    const redirectUri = `https://${OFFICIAL_CLIPPER_IDS[0]}.chromiumapp.org/auth`;
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/app-authorizations',
      headers: { cookie, origin: config.PUBLIC_URL },
      payload: {
        clientId: 'clipper',
        redirectUri,
        codeChallenge: pkceChallenge(verifier),
        codeChallengeMethod: 'S256',
      },
    });
    expect(allowed.statusCode).toBe(200);
    const code = new URL(allowed.json().redirectTo).searchParams.get('code');
    const exchanged = await app.inject({
      method: 'POST',
      url: '/api/v1/app-authorizations/token',
      payload: { clientId: 'clipper', redirectUri, code, codeVerifier: verifier },
    });
    expect(exchanged.statusCode).toBe(200);
    return exchanged.json() as { token: string; tokenId: string };
  }

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrations);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth,
      log,
      ...testDeps(db, log),
      boards: { addCard: async () => ({ ok: true, elementId: randomUUID() }) },
    });
    // A route nobody listed: a limited token must not reach it.
    app.get('/api/v1/test-only/new-route', async (req) => {
      await requireActor(auth, req, db);
      return { ok: true };
    });
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: 'clips@example.com', password: 'correct-horse-battery', name: 'Clips' },
    });
    cookie = String(signUp.headers['set-cookie']).split(';')[0] ?? '';
    me = signUp.json().user.id;
    await db.insert(user).values({ id: other, name: 'Other', email: 'other@example.com' });
    await db.insert(project).values([
      { id: mine, name: 'Mine', position: 'a0' },
      { id: theirs, name: 'Theirs', position: 'a1' },
    ]);
    await db.insert(projectMember).values([
      { projectId: mine, userId: me, role: 'owner' },
      { projectId: theirs, userId: other, role: 'owner' },
    ]);
    await db.insert(board).values([
      { id: myBoard, projectId: mine, title: 'Refs', position: 'a0' },
      { id: theirBoard, projectId: theirs, title: 'Private', position: 'a0' },
    ]);
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('marks the Clipper token at issue, and nothing else', async () => {
    const { tokenId } = await clipperSignIn();
    const scopeOf = async (id: string) =>
      (await db.select().from(personalToken).where(eq(personalToken.id, id)))[0]?.scope;
    expect(await scopeOf(tokenId)).toBe('clip');
    const phone = await issueToken(db, me, { name: 'Phone', client: 'mobile' });
    expect(phone.row.scope).toBe('full');
    const script = await issueToken(db, me, { name: 'Script' });
    expect(script.row.scope).toBe('full');
  });

  it('lets a Clipper token do everything the Clipper does', async () => {
    const { token } = await clipperSignIn();
    for (const [method, path, payload, status] of [
      ['GET', '/me/clip-boards', undefined, 200],
      ['GET', '/projects?limit=200', undefined, 200],
      ['GET', `/projects/${mine}/boards`, undefined, 200],
      ['GET', '/shared-boards', undefined, 200],
      ['GET', `/boards/${myBoard}/columns`, undefined, 200],
      ['GET', '/search?q=refs&limit=20', undefined, 200],
      ['POST', '/clip', { boardId: myBoard, text: 'Quote' }, 201],
      ['DELETE', `/me/clip-boards/${myBoard}`, undefined, 204],
    ] as const) {
      const res = await call(token, method, path, payload);
      expect(res.statusCode, `${method} ${path}`).toBe(status);
    }
    // Per-project access still applies on top of the scope.
    expect((await call(token, 'GET', `/projects/${theirs}/boards`)).statusCode).not.toBe(200);
    expect(
      (await call(token, 'POST', '/clip', { boardId: theirBoard, text: 'No' })).statusCode,
    ).not.toBe(201);
  });

  it('refuses a Clipper token everywhere else with the usual 403', async () => {
    const { token, tokenId } = await clipperSignIn();
    const phone = await issueToken(db, me, { name: 'Phone', client: 'mobile' });
    for (const [method, path, payload] of [
      ['DELETE', `/projects/${mine}`, undefined],
      ['PATCH', `/projects/${mine}`, { name: 'Renamed' }],
      ['PUT', `/projects/${mine}/members/${other}`, { role: 'editor' }],
      ['GET', `/boards/${myBoard}`, undefined],
      ['GET', `/boards/${theirBoard}`, undefined],
      ['DELETE', `/boards/${myBoard}`, undefined],
      ['GET', '/me', undefined],
      ['PATCH', '/me', { name: 'Someone' }],
      ['GET', '/instance/members', undefined],
      ['GET', '/instance/version', undefined],
      ['POST', '/me/token-proof-key', undefined],
      ['POST', '/uploads', undefined],
      ['GET', '/test-only/new-route', undefined],
      // Signing out revokes its own token only.
      ['DELETE', `/me/tokens/${phone.row.id}`, undefined],
    ] as const) {
      const res = await call(token, method, path, payload);
      expect(res.statusCode, `${method} ${path}`).toBe(403);
      expect(ApiError.parse(res.json()).error.code).toBe('forbidden');
    }
    // Nothing changed.
    const [still] = await db.select().from(project).where(eq(project.id, mine));
    expect(still?.name).toBe('Mine');
    expect(
      await db.select().from(personalToken).where(eq(personalToken.id, phone.row.id)),
    ).toHaveLength(1);
    // Signing out of the Clipper still works.
    expect((await call(token, 'DELETE', `/me/tokens/${tokenId}`)).statusCode).toBe(204);
    expect((await call(token, 'GET', '/me/clip-boards')).statusCode).toBe(401);
  });

  it('leaves app tokens, personal tokens and sessions as they were', async () => {
    const phone = await issueToken(db, me, { name: 'Phone', client: 'mobile' });
    const script = await issueToken(db, me, { name: 'Script' });
    for (const token of [phone.token, script.token]) {
      expect((await call(token, 'GET', '/me')).statusCode).toBe(200);
      expect((await call(token, 'GET', `/boards/${myBoard}`)).statusCode).toBe(200);
      expect((await call(token, 'GET', '/test-only/new-route')).statusCode).toBe(200);
    }
    expect((await call(phone.token, 'POST', '/me/token-proof-key')).statusCode).toBe(200);
    const session = await app.inject({ url: '/api/v1/me', headers: { cookie } });
    expect(session.statusCode).toBe(200);
  });

  it('limits Clipper tokens issued before the scope, and only those (migration 0057)', async () => {
    const backfill = readFileSync(`${migrations}/0057_token_scope.sql`, 'utf8')
      .split('--> statement-breakpoint')
      .filter((s) => /^\s*(--.*\n\s*)*UPDATE/i.test(s));
    expect(backfill).toHaveLength(1);
    // Rows as an older server wrote them: every one `full`, as the new column's default makes them.
    const rows = await Promise.all(
      (['clipper', 'mobile', undefined] as const).map((c) =>
        issueToken(db, me, { name: `Old ${c}`, ...(c ? { client: c } : {}) }),
      ),
    );
    const ids = rows.map((r) => r.row.id);
    for (const id of ids)
      await db.update(personalToken).set({ scope: 'full' }).where(eq(personalToken.id, id));
    await db.execute(sql.raw(backfill[0] ?? ''));
    const scopes = await Promise.all(
      ids.map(
        async (id) =>
          (await db.select().from(personalToken).where(eq(personalToken.id, id)))[0]?.scope,
      ),
    );
    expect(scopes).toEqual(['clip', 'full', 'full']);
    expect((await call(rows[0]?.token ?? '', 'GET', '/me')).statusCode).toBe(403);
    expect((await call(rows[1]?.token ?? '', 'GET', '/me')).statusCode).toBe(200);
  });
});
