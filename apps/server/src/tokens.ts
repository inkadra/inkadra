import type { AppClient, InvalidTokenReason, PersonalToken } from '@inkadra/shared';
import { and, eq, gt, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { Actor } from './access.ts';
import type { Database } from './db/client.ts';
import { personalToken, revokedToken, user } from './db/schema.ts';
import { newSecret, sha256 } from './secrets.ts';

type RevokedToken = typeof revokedToken.$inferSelect;

export const TOKEN_PREFIX = 'ink_';

export function isToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length + 20;
}

export function toPersonalToken(row: typeof personalToken.$inferSelect): PersonalToken {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export async function issueToken(
  db: Pick<Database, 'insert'>,
  userId: string,
  input: { name: string; client?: AppClient; expiresAt?: Date | null },
) {
  const token = newSecret(TOKEN_PREFIX);
  const [row] = await db
    .insert(personalToken)
    .values({
      userId,
      name: input.name,
      client: input.client ?? null,
      tokenHash: sha256(token),
      prefix: token.slice(0, TOKEN_PREFIX.length + 6),
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!row) throw new Error('Token insert returned nothing');
  return { token, row };
}

/** The person a bearer token belongs to, or null for unknown, expired or revoked tokens. */
export async function actorFromToken(
  db: Database,
  token: string,
): Promise<(Actor & { twoFactorEnabled: boolean | null }) | null> {
  if (!isToken(token)) return null;
  const now = new Date();
  const [row] = await db
    .select({
      id: personalToken.id,
      userId: user.id,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(personalToken)
    .innerJoin(user, eq(user.id, personalToken.userId))
    .where(
      and(
        eq(personalToken.tokenHash, sha256(token)),
        isNull(user.deactivatedAt),
        or(isNull(personalToken.expiresAt), gt(personalToken.expiresAt, now)),
      ),
    );
  if (!row) return null;
  // Record the use, at most every five minutes per token.
  await db
    .update(personalToken)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(personalToken.id, row.id),
        or(
          isNull(personalToken.lastUsedAt),
          lt(personalToken.lastUsedAt, new Date(now.getTime() - 5 * 60_000)),
        ),
      ),
    );
  return {
    id: row.userId,
    role: row.role === 'admin' ? 'admin' : 'member',
    tokenId: row.id,
    twoFactorEnabled: row.twoFactorEnabled,
  };
}

export function bearerToken(authorization: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return m?.[1] ?? null;
}

export const TOKEN_REASON_RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * Deletes tokens as before and keeps their hashes with a reason. The delete comes first: if
 * the second statement fails, the token is still gone and its holder gets the generic 401.
 */
export async function revokeTokens(
  db: Pick<Database, 'delete' | 'insert'>,
  where: SQL | undefined,
  reason: RevokedToken['reason'],
) {
  const removed = await db.delete(personalToken).where(where).returning({
    id: personalToken.id,
    userId: personalToken.userId,
    hash: personalToken.tokenHash,
  });
  if (removed.length > 0)
    await db
      .insert(revokedToken)
      .values(removed.map((r) => ({ tokenHash: r.hash, userId: r.userId, reason })))
      .onConflictDoNothing();
  return removed;
}

/** Why a token no longer works; only for the holder of the exact token, never a guess. */
export async function invalidTokenReason(
  db: Database,
  token: string,
): Promise<InvalidTokenReason | undefined> {
  if (!isToken(token)) return undefined;
  const hash = sha256(token);
  const [revoked] = await db
    .select({ reason: revokedToken.reason })
    .from(revokedToken)
    .where(
      and(
        eq(revokedToken.tokenHash, hash),
        gt(revokedToken.revokedAt, new Date(Date.now() - TOKEN_REASON_RETENTION_MS)),
      ),
    );
  if (revoked) return revoked.reason;
  const [row] = await db
    .select({ expiresAt: personalToken.expiresAt, deactivatedAt: user.deactivatedAt })
    .from(personalToken)
    .innerJoin(user, eq(user.id, personalToken.userId))
    .where(eq(personalToken.tokenHash, hash));
  if (row?.deactivatedAt) return 'account_deactivated';
  if (row?.expiresAt && row.expiresAt.getTime() <= Date.now()) return 'token_expired';
  return undefined;
}

export async function purgeRevokedTokens(db: Pick<Database, 'delete'>) {
  await db
    .delete(revokedToken)
    .where(lt(revokedToken.revokedAt, new Date(Date.now() - TOKEN_REASON_RETENTION_MS)));
}
