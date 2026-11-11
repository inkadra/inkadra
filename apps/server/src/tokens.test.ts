import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations } from './db/client.ts';
import { personalToken, user } from './db/schema.ts';
import {
  actorFromToken,
  invalidTokenReason,
  issueToken,
  purgeInvalidTokens,
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
  it('recognizes only exact hashes, never authenticates revoked tokens, and purges old reasons', async () => {
    const issued = await issueToken(db, userId, { name: 'Device' });
    expect(await actorFromToken(db, issued.token)).toMatchObject({ id: userId });
    await db
      .update(personalToken)
      .set({ revokedAt: new Date(), revocationReason: 'token_revoked' })
      .where(eq(personalToken.id, issued.row.id));
    expect(await actorFromToken(db, issued.token)).toBeNull();
    expect(await invalidTokenReason(db, issued.token)).toBe('token_revoked');
    expect(await invalidTokenReason(db, `${issued.token}x`)).toBeUndefined();
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
    const old = new Date(Date.now() - TOKEN_REASON_RETENTION_MS - 1000);
    await db
      .update(personalToken)
      .set({ revokedAt: old })
      .where(eq(personalToken.id, issued.row.id));
    await db
      .update(personalToken)
      .set({ expiresAt: old })
      .where(eq(personalToken.id, expired.row.id));
    expect(await invalidTokenReason(db, issued.token)).toBeUndefined();
    await purgeInvalidTokens(db);
    expect(await invalidTokenReason(db, expired.token)).toBeUndefined();
    expect(await db.select().from(personalToken)).toHaveLength(1);
  });
});
