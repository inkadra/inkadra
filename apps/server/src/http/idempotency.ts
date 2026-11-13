import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../db/client.ts';
import { creationRequest } from '../db/schema.ts';
import { sha256 } from '../secrets.ts';
import { HttpError } from './errors.ts';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const RETENTION_MS = 7 * 24 * 60 * 60_000;

/** The remembered key: hashed with the person and the scope, so nobody else's key ever matches. */
export const creationKeyHash = (userId: string, scope: string, key: string) =>
  sha256(JSON.stringify([userId, scope, key]));

/** The hash of the request's `Idempotency-Key`, nothing without one, 400 for a malformed one. */
export function requestKeyHash(req: FastifyRequest, userId: string, scope: string) {
  const key = req.headers['idempotency-key'];
  if (key === undefined) return undefined;
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key))
    throw new HttpError(
      'bad_request',
      'Idempotency-Key must contain 1–128 printable ASCII characters.',
    );
  return creationKeyHash(userId, scope, key);
}

/**
 * Takes the advisory lock on the key for the rest of `tx` and returns the id the key made, if
 * any; 409 when the key was used with another request.
 */
export async function rememberedCreation(tx: Transaction, keyHash: string, fingerprint: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))`);
  await tx
    .delete(creationRequest)
    .where(and(eq(creationRequest.keyHash, keyHash), lt(creationRequest.expiresAt, new Date())));
  const [previous] = await tx
    .select()
    .from(creationRequest)
    .where(eq(creationRequest.keyHash, keyHash));
  if (previous && previous.fingerprint !== fingerprint)
    throw new HttpError('conflict', 'Idempotency-Key was used with a different request.');
  return previous?.resourceId;
}

/** Remembers the id `keyHash` made, in the transaction that made it. */
export const rememberCreation = (
  tx: Transaction,
  keyHash: string,
  userId: string,
  fingerprint: string,
  resourceId: string,
) =>
  tx.insert(creationRequest).values({
    keyHash,
    userId,
    fingerprint,
    resourceId,
    expiresAt: new Date(Date.now() + RETENTION_MS),
  });

/**
 * The creation and the id it made commit together, as with feedback request ids. A retry
 * gets back only the id: the caller reads the resource as it is now, so a replay never
 * answers with a state (role, title, deletion) older than the request.
 */
export async function idempotentCreation<T extends { id: string }>(
  db: Database,
  req: FastifyRequest,
  userId: string,
  scope: string,
  input: unknown,
  create: (tx: Transaction) => Promise<T>,
): Promise<{ created: T } | { replayed: string }> {
  const keyHash = requestKeyHash(req, userId, scope);
  if (keyHash === undefined) return { created: await db.transaction(create) };
  const fingerprint = sha256(JSON.stringify(input));
  return db.transaction(async (tx) => {
    const previous = await rememberedCreation(tx, keyHash, fingerprint);
    if (previous) return { replayed: previous };
    const created = await create(tx);
    await rememberCreation(tx, keyHash, userId, fingerprint, created.id);
    return { created };
  });
}
