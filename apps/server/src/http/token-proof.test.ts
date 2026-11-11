import { createHmac, randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { TokenProof, TokenProofKey } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { personalToken, user } from '../db/schema.ts';
import { memoryMailer } from '../mailer.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken, revokeTokens } from '../tokens.ts';
import { createApp } from './app.ts';

/** What a client computes on its own, from its copy of the key (decision 0110). */
const expected = (key: string, instanceId: string, keyId: string, nonce: string) =>
  createHmac('sha256', Buffer.from(key, 'base64url'))
    .update(`inkadra-token-proof/v1\nunlock-network\n${instanceId}\n${keyId}\n${nonce}`)
    .digest('base64url');
const nonce = () => randomBytes(32).toString('base64url');

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
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const askKey = (token: string) =>
    app.inject({ method: 'POST', url: '/api/v1/me/token-proof-key', headers: bearer(token) });
  const prove = (keyId: string, n: string) =>
    app.inject({ method: 'POST', url: '/api/v1/token-proof', payload: { keyId, nonce: n } });

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
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('lists the capability', async () => {
    const { token } = await issueToken(db, userId, { name: 'Phone', client: 'mobile' });
    const res = await app.inject({ url: '/api/v1/instance/version', headers: bearer(token) });
    expect(res.json().capabilities).toContain('token-proof');
  });

  it('gives a token one key, the same again, and proves fresh nonces with it', async () => {
    const { token } = await issueToken(db, userId, { name: 'Phone', client: 'mobile' });
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
    const { token: second } = await issueToken(db, userId, { name: 'Tablet', client: 'mobile' });
    const secondKey = TokenProofKey.parse((await askKey(second)).json());
    expect(secondKey.key).not.toBe(key.key);
    expect(secondKey.instanceId).toBe(key.instanceId);
  });

  it('stores the key sealed, and never logs it or the nonce answer', async () => {
    const { token, row } = await issueToken(db, userId, { name: 'Phone', client: 'mobile' });
    const key = TokenProofKey.parse((await askKey(token)).json());
    const [stored] = await db.select().from(personalToken).where(eq(personalToken.id, row.id));
    expect(stored?.proofKeyId).toBe(key.keyId);
    expect(stored?.proofKey).not.toContain(key.key);
    const proof = TokenProof.parse((await prove(key.keyId, nonce())).json()).proof;
    const all = logged.join('');
    expect(all).not.toContain(key.key);
    expect(all).not.toContain(proof);
    expect(all).not.toContain(token);
  });

  it('answers 404 for an unknown key and for a revoked or expired token', async () => {
    expect((await prove('AAAAAAAAAAAAAAAAAAAAAA', nonce())).statusCode).toBe(404);
    const revoked = await issueToken(db, userId, { name: 'Lost phone', client: 'mobile' });
    const key = TokenProofKey.parse((await askKey(revoked.token)).json());
    await revokeTokens(db, eq(personalToken.id, revoked.row.id), 'token_revoked');
    expect((await prove(key.keyId, nonce())).statusCode).toBe(404);
    const expiring = await issueToken(db, userId, { name: 'Old phone', client: 'mobile' });
    const old = TokenProofKey.parse((await askKey(expiring.token)).json());
    await db
      .update(personalToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(personalToken.id, expiring.row.id));
    expect((await prove(old.keyId, nonce())).statusCode).toBe(404);
  });

  it('needs a token for the key and refuses malformed requests', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/me/token-proof-key' })).statusCode,
    ).toBe(401);
    expect((await prove('short', nonce())).statusCode).toBe(400);
    expect((await prove('AAAAAAAAAAAAAAAAAAAAAA', 'tooshort')).statusCode).toBe(400);
  });

  it('is rate limited per address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 31; i++)
      codes.push((await prove('AAAAAAAAAAAAAAAAAAAAAA', nonce())).statusCode);
    expect(codes).toContain(429);
  });
});
