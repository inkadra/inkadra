import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../db/client.ts';
import { creationRequest } from '../db/schema.ts';
import { sha256 } from '../secrets.ts';
import { HttpError } from './errors.ts';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const RETENTION_MS = 7 * 24 * 60 * 60_000;

/** The creation and its remembered response commit together, as with feedback request ids. */
export async function idempotentCreation<T>(
  db: Database,
  req: FastifyRequest,
  userId: string,
  scope: string,
  input: unknown,
  create: (tx: Transaction) => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  const key = req.headers['idempotency-key'];
  if (key === undefined) return { value: await db.transaction(create), replayed: false };
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key))
    throw new HttpError(
      'bad_request',
      'Idempotency-Key must contain 1–128 printable ASCII characters.',
    );
  const keyHash = sha256(JSON.stringify([userId, scope, key]));
  const fingerprint = sha256(JSON.stringify(input));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))`);
    await tx
      .delete(creationRequest)
      .where(and(eq(creationRequest.keyHash, keyHash), lt(creationRequest.expiresAt, new Date())));
    const [previous] = await tx
      .select()
      .from(creationRequest)
      .where(eq(creationRequest.keyHash, keyHash));
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new HttpError('conflict', 'Idempotency-Key was used with a different request.');
      return { value: previous.response as T, replayed: true };
    }
    const value = await create(tx);
    await tx
      .insert(creationRequest)
      .values({
        keyHash,
        userId,
        fingerprint,
        response: value,
        expiresAt: new Date(Date.now() + RETENTION_MS),
      });
    return { value, replayed: false };
  });
}
