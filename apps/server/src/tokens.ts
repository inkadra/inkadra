import type { AppClient, PersonalToken } from '@inkadra/shared';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Actor } from './access.ts';
import type { Database } from './db/client.ts';
import { personalToken, user } from './db/schema.ts';
import { newSecret, sha256 } from './secrets.ts';

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
export async function actorFromToken(db: Database, token: string): Promise<Actor | null> {
  if (!isToken(token)) return null;
  const now = new Date();
  const [row] = await db
    .select({ id: personalToken.id, userId: user.id, role: user.role })
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
  return { id: row.userId, role: row.role === 'admin' ? 'admin' : 'member', tokenId: row.id };
}

export function bearerToken(authorization: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return m?.[1] ?? null;
}
