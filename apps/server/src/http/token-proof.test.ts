import { createHmac, randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { TokenProof, TokenProofKey } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { instanceSetting, personalToken, user } from '../db/schema.ts';
import { memoryMailer } from '../mailer.ts';
import { testDeps } from '../test-deps.ts';
import { proofKeyFor } from '../token-proof.ts';
import { issueToken, revokeTokens } from '../tokens.ts';
import { createApp } from './app.ts';

/** What a client computes on its own, from its copy of the key (decision 0112). */
const expected = (key: string, instanceId: string, keyId: string, nonce: string) =>
  createHmac('sha256', Buffer.from(key, 'base64url'))
    .update(`inkadra-token-proof/v1\nunlock-network\n${instanceId}\n${keyId}\n${nonce}`)
    .digest('base64url');
const nonce = () => randomBytes(32).toString('base64url');
const keyIdLike = () => randomBytes(16).toString('base64url');

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('token proof', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const logged: string[] = [];
  const log = pino(
    { level: 'trace' },
    new Writable({
      write(chunk, _enc, done) {
        logged.push(String(chunk));
        done();
      },
    }),
  );
  let app: Awaited<ReturnType<typeof createApp>>;
  let userId = '';
  // Each test proves from its own address, so no test spends another's per-address budget.
  let address = 0;
  let from = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const askKey = (token: string) =>
    app.inject({ method: 'POST', url: '/api/v1/me/token-proof-key', headers: bearer(token) });
  const prove = (keyId: string, n: string, remoteAddress = from) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/token-proof',
      payload: { keyId, nonce: n },
      remoteAddress,
    });
  const appToken = (name = 'Phone') => issueToken(db, userId, { name, client: 'mobile' });

  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log,
      mailer: memoryMailer(),
      ...testDeps(db, log),
    });
    const [owner] = await db
      .insert(user)
      .values({ name: 'Phone owner', email: 'proof@example.com' })
      .returning();
    userId = owner!.id;
  });
  beforeEach(() => {
    address++;
    from = `203.0.113.${address}`;
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('writes nothing when asked without a token', async () => {
    const before = await db.select().from(personalToken);
    expect((await prove(keyIdLike(), nonce())).statusCode).toBe(404);
    expect(await db.select().from(instanceSetting)).toEqual([]);
    expect(await db.select().from(personalToken)).toEqual(before);
  });

  it('lists the capability', async () => {
    const { token } = await appToken();
    const res = await app.inject({ url: '/api/v1/instance/version', headers: bearer(token) });
    expect(res.json().capabilities).toContain('token-proof');
  });

  it('gives an app token one key, the same again, and proves fresh nonces with it', async () => {
    const { token } = await appToken();
    const first = await askKey(token);
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const key = TokenProofKey.parse(first.json());
    expect(TokenProofKey.parse((await askKey(token)).json())).toEqual(key);

    const n = nonce();
    const res = await prove(key.keyId, n);
    expect(res.statusCode).toBe(200);
    const answer = TokenProof.parse(res.json());
    expect(answer.instanceId).toBe(key.instanceId);
    expect(answer.proof).toBe(expected(key.key, key.instanceId, key.keyId, n));
    // Another nonce, another proof: an answer recorded once is no use later.
    const other = TokenProof.parse((await prove(key.keyId, nonce())).json());
    expect(other.proof).not.toBe(answer.proof);
    // Another token's key never proves for this one.
    const { token: second } = await appToken('Tablet');
    const secondKey = TokenProofKey.parse((await askKey(second)).json());
    expect(secondKey.key).not.toBe(key.key);
    expect(secondKey.instanceId).toBe(key.instanceId);
  });

  it('makes one key for two first calls at once', async () => {
    const { token } = await appToken();
    const [a, b] = await Promise.all([askKey(token), askKey(token)]);
    expect(TokenProofKey.parse(a.json())).toEqual(TokenProofKey.parse(b.json()));
  });

  it('gives a key only to app tokens: not to a browser session, not to a personal API token', async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { name: 'Browser', email: 'browser@example.com', password: 'correct-horse-battery' },
    });
    expect(signUp.statusCode).toBe(200);
    const cookie = String(signUp.headers['set-cookie']).split(';')[0] ?? '';
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/me/token-proof-key',
      headers: { cookie, origin: config.PUBLIC_URL },
    });
    expect(session.statusCode).toBe(403);
    expect(session.json().error.message).toBe('Only an app token has a proof key.');
    const script = await issueToken(db, userId, { name: 'Script' });
    const scripted = await askKey(script.token);
    expect(scripted.statusCode).toBe(403);
    expect(scripted.json().error.message).toBe('Only an app token has a proof key.');
    const anonymous = await app.inject({ method: 'POST', url: '/api/v1/me/token-proof-key' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('stores the key sealed, and never logs it, its id, the nonce or the answer', async () => {
    const { token, row } = await appToken();
    const key = TokenProofKey.parse((await askKey(token)).json());
    const [stored] = await db.select().from(personalToken).where(eq(personalToken.id, row.id));
    expect(stored?.proofKeyId).toBe(key.keyId);
    expect(stored?.proofKey).not.toContain(key.key);
    const n = nonce();
    const proof = TokenProof.parse((await prove(key.keyId, n)).json()).proof;
    expect((await prove(`${key.keyId}x`, n)).statusCode).toBe(404);
    const all = logged.join('');
    expect(all).not.toContain(key.key);
    expect(all).not.toContain(key.keyId);
    expect(all).not.toContain(n);
    expect(all).not.toContain(proof);
    expect(all).not.toContain(token);
  });

  it('answers unknown, revoked, expired and deactivated keys with the same 404 body', async () => {
    const unknown = await prove(keyIdLike(), nonce());
    expect(unknown.statusCode).toBe(404);

    const revoked = await appToken('Lost phone');
    const revokedKey = TokenProofKey.parse((await askKey(revoked.token)).json());
    await revokeTokens(db, eq(personalToken.id, revoked.row.id), 'token_revoked');

    const expiring = await appToken('Old phone');
    const expiredKey = TokenProofKey.parse((await askKey(expiring.token)).json());
    await db
      .update(personalToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(personalToken.id, expiring.row.id));

    const [other] = await db
      .insert(user)
      .values({ name: 'Leaver', email: 'leaver@example.com' })
      .returning();
    const leaving = await issueToken(db, other!.id, { name: 'Phone', client: 'mobile' });
    const leaverKey = TokenProofKey.parse((await askKey(leaving.token)).json());
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, other!.id));

    for (const keyId of [revokedKey.keyId, expiredKey.keyId, leaverKey.keyId]) {
      const res = await prove(keyId, nonce());
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(unknown.body);
    }
  });

  it('replaces a key that no longer opens (AUTH_SECRET rotated); the old one proves nothing', async () => {
    const { token, row } = await appToken();
    const old = TokenProofKey.parse((await askKey(token)).json());
    const rotated = await proofKeyFor(db, 'another-secret-another-secret-another-0123', row.id);
    if (!rotated || rotated === 'not_app') throw new Error('no key after rotation');
    expect(rotated.keyId).not.toBe(old.keyId);
    // The key now sealed with the other secret does not open here: 404, never a proof.
    expect((await prove(rotated.keyId, nonce())).statusCode).toBe(404);
    expect((await prove(old.keyId, nonce())).statusCode).toBe(404);
  });

  it('refuses malformed requests before looking anything up', async () => {
    expect((await prove('short', nonce())).statusCode).toBe(400);
    expect((await prove(keyIdLike(), 'tooshort')).statusCode).toBe(400);
    expect((await prove(`${keyIdLike()}\n`, nonce())).statusCode).toBe(400);
    expect((await prove(keyIdLike(), `${nonce()}\nx`)).statusCode).toBe(400);
    expect((await prove(`${keyIdLike()}+/`, nonce())).statusCode).toBe(400);
  });

  it('is rate limited to 10 a minute per key, from any address', async () => {
    const keyId = keyIdLike();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++)
      codes.push((await prove(keyId, nonce(), `198.51.100.${i + 1}`)).statusCode);
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(404));
    expect(codes[10]).toBe(429);
  });

  it('is rate limited to 30 a minute per address, whatever the key', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await prove(keyIdLike(), nonce())).statusCode);
    expect(codes.slice(0, 30)).toEqual(Array(30).fill(404));
    expect(codes[30]).toBe(429);
  });
});
