import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { TOKEN_PROOF_PURPOSE, type TokenProof, type TokenProofKey } from '@inkadra/shared';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { instanceSetting, personalToken, user } from './db/schema.ts';
import { newSecret, sealer } from './secrets.ts';

/**
 * Token proof (decision 0110). A token holder that cannot rely on the transport (an app on a
 * plain http server) asks for a proof key once, where it trusts the connection; later, on a
 * network it has not confirmed, it sends a fresh nonce and checks that the server answering
 * holds the same key before it sends the token. The token never travels for the check.
 */

const INSTANCE_ID_KEY = 'instance-id';

/** A random id of this server, made once and kept in the database. */
export async function instanceId(db: Pick<Database, 'select' | 'insert'>): Promise<string> {
  await db
    .insert(instanceSetting)
    .values({ key: INSTANCE_ID_KEY, value: { id: randomUUID() } })
    .onConflictDoNothing();
  const [row] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, INSTANCE_ID_KEY));
  const id = row?.value.id;
  if (typeof id !== 'string') throw new Error('instance id missing');
  return id;
}

const keySealer = (authSecret: string) => sealer(authSecret, 'token-proof-key');

/**
 * The proof key of a token: made at the first call, returned again while the token lives (a
 * client whose keychain write failed asks again). Sealed at rest with AUTH_SECRET; a key that no
 * longer opens (the secret was rotated) is replaced.
 */
export async function proofKeyFor(
  db: Database,
  authSecret: string,
  tokenId: string,
): Promise<TokenProofKey | null> {
  const seal = keySealer(authSecret);
  const [row] = await db
    .select({ keyId: personalToken.proofKeyId, sealed: personalToken.proofKey })
    .from(personalToken)
    .where(eq(personalToken.id, tokenId));
  if (!row) return null;
  const current = row.keyId && row.sealed ? seal.open(row.sealed) : null;
  if (row.keyId && current)
    return { instanceId: await instanceId(db), keyId: row.keyId, key: current };
  const keyId = newSecret('', 16);
  const key = randomBytes(32).toString('base64url');
  // Only one of two concurrent first calls writes; the other reads what it wrote.
  const [made] = await db
    .update(personalToken)
    .set({ proofKeyId: keyId, proofKey: seal.seal(key) })
    .where(
      and(
        eq(personalToken.id, tokenId),
        row.keyId ? eq(personalToken.proofKeyId, row.keyId) : isNull(personalToken.proofKeyId),
      ),
    )
    .returning({ id: personalToken.id });
  if (!made) return proofKeyFor(db, authSecret, tokenId);
  return { instanceId: await instanceId(db), keyId, key };
}

/** The bytes the HMAC covers; the client builds the same string. */
export function proofMessage(instance: string, keyId: string, nonce: string): string {
  return `inkadra-token-proof/v1\n${TOKEN_PROOF_PURPOSE}\n${instance}\n${keyId}\n${nonce}`;
}

export function proofOf(key: string, instance: string, keyId: string, nonce: string): string {
  return createHmac('sha256', Buffer.from(key, 'base64url'))
    .update(proofMessage(instance, keyId, nonce))
    .digest('base64url');
}

/** The proof over a nonce, or null for an unknown key or a token revoked, expired or disabled. */
export async function proveNonce(
  db: Database,
  authSecret: string,
  keyId: string,
  nonce: string,
): Promise<TokenProof | null> {
  const [row] = await db
    .select({ sealed: personalToken.proofKey })
    .from(personalToken)
    .innerJoin(user, eq(user.id, personalToken.userId))
    .where(
      and(
        eq(personalToken.proofKeyId, keyId),
        isNull(user.deactivatedAt),
        or(isNull(personalToken.expiresAt), gt(personalToken.expiresAt, new Date())),
      ),
    );
  const key = row?.sealed ? keySealer(authSecret).open(row.sealed) : null;
  if (!key) return null;
  const instance = await instanceId(db);
  return {
    instanceId: instance,
    purpose: TOKEN_PROOF_PURPOSE,
    proof: proofOf(key, instance, keyId, nonce),
  };
}
