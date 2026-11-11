import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations } from './db/client.ts';
import { personalToken, revokedToken, user } from './db/schema.ts';
import {
  actorFromToken,
  invalidTokenReason,
  issueToken,
  purgeRevokedTokens,
  revokeTokens,
  TOKEN_REASON_RETENTION_MS,
} from './tokens.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('recognizable invalid tokens', () => {
  const { db, sql: client } = createDatabase(url ?? 'postgres://unused', 2);
  let userId = '';
  beforeAll(async () => {
    await runMigrations(url!, fileURLToPath(new URL('../drizzle', import.meta.url)));
    await db.execute(sql`truncate table "user" cascade`);
    const [owner] = await db
      .insert(user)
      .values({ name: 'Token owner', email: 'tokens@example.com' })
      .returning();
    userId = owner!.id;
  });
  afterAll(() => client.end());

  it('deletes revoked tokens, recognizes only exact hashes and purges old reasons', async () => {
    const issued = await issueToken(db, userId, { name: 'Device' });
    expect(await actorFromToken(db, issued.token)).toMatchObject({ id: userId });
    await revokeTokens(db, eq(personalToken.id, issued.row.id), 'token_revoked');
    // The token row is gone, as before: code that knows nothing of revoked_token (an older
    // server image after a rollback) cannot authenticate it.
    expect(await db.select().from(personalToken).where(eq(personalToken.id, issued.row.id))).toEqual(
      [],
    );
    expect(await actorFromToken(db, issued.token)).toBeNull();
    expect(await invalidTokenReason(db, issued.token)).toBe('token_revoked');
    expect(await invalidTokenReason(db, `${issued.token}x`)).toBeUndefined();
    expect(await invalidTokenReason(db, 'not-a-token')).toBeUndefined();

    const expired = await issueToken(db, userId, {
      name: 'Expired',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await actorFromToken(db, expired.token)).toBeNull();
    expect(await invalidTokenReason(db, expired.token)).toBe('token_expired');

    const active = await issueToken(db, userId, { name: 'Active' });
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId));
    expect(await actorFromToken(db, active.token)).toBeNull();
    expect(await invalidTokenReason(db, active.token)).toBe('account_deactivated');
    await revokeTokens(db, eq(personalToken.id, active.row.id), 'account_deactivated');
    await db.update(user).set({ deactivatedAt: null }).where(eq(user.id, userId));
    expect(await invalidTokenReason(db, active.token)).toBe('account_deactivated');

    const old = new Date(Date.now() - TOKEN_REASON_RETENTION_MS - 1000);
    await db
      .update(revokedToken)
      .set({ revokedAt: old })
      .where(eq(revokedToken.tokenHash, issued.row.tokenHash));
    expect(await invalidTokenReason(db, issued.token)).toBeUndefined();
    await purgeRevokedTokens(db);
    expect((await db.select().from(revokedToken)).map((r) => r.reason)).toEqual([
      'account_deactivated',
    ]);
  });
});
