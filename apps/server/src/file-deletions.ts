import { and, asc, eq, gt, inArray, lt } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Database } from './db/client.ts';
import { asset, pendingFileDeletion, projectTransfer } from './db/schema.ts';
import type { Storage } from './storage.ts';

/** How long a recorded removal waits before the sweep does it (#801). */
export const DELETION_GRACE_MS = 24 * 60 * 60 * 1000;

const CHUNK = 1000;
/** An import silent for this long (as in `STALLED_MS`) is taken for dead and no longer holds the sweep. */
const IMPORT_STALE_MS = 15 * 60 * 1000;

/**
 * Records stored files to remove. Called in the transaction that deletes their rows, so the
 * keys outlive a crash, a Redis outage or a removal job that gives up (#801).
 */
export async function recordDeletions(tx: Pick<Database, 'insert'>, keys: string[]) {
  for (let i = 0; i < keys.length; i += CHUNK)
    await tx
      .insert(pendingFileDeletion)
      .values(keys.slice(i, i + CHUNK).map((key) => ({ key })))
      .onConflictDoNothing();
}

/** Clears records without touching the files (an import whose rows now use them). */
export async function clearDeletions(tx: Pick<Database, 'delete'>, keys: string[]) {
  for (let i = 0; i < keys.length; i += CHUNK)
    await tx
      .delete(pendingFileDeletion)
      .where(inArray(pendingFileDeletion.key, keys.slice(i, i + CHUNK)));
}

/** Removes the files, then their records: a failure keeps the records for the sweep. */
export async function removeFiles(db: Pick<Database, 'delete'>, storage: Storage, keys: string[]) {
  await storage.remove(keys);
  await clearDeletions(db, keys);
}

/** The asset a storage key belongs to (`originals/<id>`, `variants/<id>/…`), or null. */
export function assetIdOf(key: string): string | null {
  return /^(?:originals|variants)\/([0-9a-f-]{36})(?:\/|$)/.exec(key)?.[1] ?? null;
}

/**
 * Removes the files recorded over a day ago and still there. Waits while an import runs: its
 * files are recorded before its rows exist. A key whose asset has a row again (an upload
 * restarted with the same id) is dropped from the list and its file kept.
 */
export async function sweepDeletions(
  db: Database,
  storage: Storage,
  log?: Pick<Logger, 'warn' | 'error'>,
) {
  const [importing] = await db
    .select({ id: projectTransfer.id })
    .from(projectTransfer)
    .where(
      and(
        eq(projectTransfer.kind, 'import'),
        eq(projectTransfer.status, 'running'),
        gt(projectTransfer.updatedAt, new Date(Date.now() - IMPORT_STALE_MS)),
      ),
    )
    .limit(1);
  if (importing) {
    log?.warn({ import: importing.id }, 'Deletion sweep paused: an import is running');
    return 0;
  }
  // Oldest first, a chunk at a time: a chunk that fails is logged and skipped, not the sweep.
  const before = new Date(Date.now() - DELETION_GRACE_MS);
  let removed = 0;
  const tried = new Set<string>();
  for (;;) {
    const rows = await db
      .select({ key: pendingFileDeletion.key })
      .from(pendingFileDeletion)
      .where(lt(pendingFileDeletion.createdAt, before))
      .orderBy(asc(pendingFileDeletion.createdAt), asc(pendingFileDeletion.key))
      .limit(CHUNK + tried.size);
    const keys = rows
      .map((r) => r.key)
      .filter((k) => !tried.has(k))
      .slice(0, CHUNK);
    if (keys.length === 0) break;
    for (const k of keys) tried.add(k);
    try {
      removed += await sweepChunk(db, storage, keys);
    } catch (err) {
      log?.error({ err, files: keys.length }, 'Deletion sweep: a chunk failed, retrying next time');
    }
    if (tried.size >= 10 * CHUNK) break; // shortcut: bounded per run, the rest waits for the next
  }
  return removed;
}

async function sweepChunk(db: Database, storage: Storage, keys: string[]) {
  const ids = [...new Set(keys.map(assetIdOf).filter((id): id is string => id !== null))];
  const live = new Set(
    ids.length === 0
      ? []
      : (await db.select({ id: asset.id }).from(asset).where(inArray(asset.id, ids))).map(
          (r) => r.id,
        ),
  );
  const gone = keys.filter((k) => {
    const id = assetIdOf(k);
    return !id || !live.has(id);
  });
  if (gone.length > 0) await storage.remove(gone);
  await clearDeletions(db, keys);
  return gone.length;
}
