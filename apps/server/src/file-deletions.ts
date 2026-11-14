import { BACKUP_RETENTION_MAX } from '@inkadra/shared';
import { and, asc, eq, gt, inArray, isNull, lt, min } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Database } from './db/client.ts';
import { asset, instanceBackup, pendingFileDeletion, projectTransfer } from './db/schema.ts';
import type { Storage } from './storage.ts';

/** How long a recorded removal waits before the sweep does it (#801). */
export const DELETION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The longest a kept backup holds back the removal of files (#794): the largest retention, one
 * backup a night, plus a day. Past it the files go even if an older backup is still kept.
 */
export const BACKUP_HOLD_MAX_MS = (BACKUP_RETENTION_MAX + 1) * 24 * 60 * 60 * 1000;

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

/**
 * A removal recorded this long before a backup started may still be in it (#794): the
 * deletion's transaction can begin before the backup's snapshot and commit after `startedAt`
 * is set, so `startedAt` alone is not a safe line.
 */
export const BACKUP_SNAPSHOT_MARGIN_MS = 60 * 60 * 1000;

/** Backups that list files: kept ones, and one being written (its snapshot is taken). */
const listingBackups = and(
  inArray(instanceBackup.status, ['ready', 'running']),
  isNull(instanceBackup.removedAt),
);

/**
 * Recorded removals before this time may go (#794): a day old, and an hour older than every
 * kept or running backup, so that restoring any of them finds the files it lists. A removal
 * recorded well before a backup started is not in that backup: its rows were already gone.
 */
export async function removableBefore(db: Pick<Database, 'select'>, now = Date.now()) {
  const [kept] = await db
    .select({ oldest: min(instanceBackup.startedAt) })
    .from(instanceBackup)
    .where(listingBackups);
  const oldest = kept?.oldest
    ? new Date(kept.oldest).getTime() - BACKUP_SNAPSHOT_MARGIN_MS
    : Number.POSITIVE_INFINITY;
  return new Date(Math.max(Math.min(now - DELETION_GRACE_MS, oldest), now - BACKUP_HOLD_MAX_MS));
}

/**
 * Files of rows just deleted (a project, an account, an export). Removed now when no kept or
 * running backup may list them; otherwise the records stay and the sweep removes the files once every
 * kept backup is newer than the deletion (#794).
 */
export async function removeDeletedFiles(
  db: Pick<Database, 'delete' | 'select'>,
  storage: Storage,
  keys: string[],
) {
  const [kept] = await db
    .select({ id: instanceBackup.id })
    .from(instanceBackup)
    .where(listingBackups)
    .limit(1);
  if (kept) return 0;
  await removeFiles(db, storage, keys);
  return keys.length;
}

/** The asset a storage key belongs to (`originals/<id>`, `variants/<id>/…`), or null. */
export function assetIdOf(key: string): string | null {
  return /^(?:originals|variants)\/([0-9a-f-]{36})(?:\/|$)/.exec(key)?.[1] ?? null;
}

/**
 * Removes the files recorded over a day ago (and before every kept backup, #794) and still
 * there. Waits while an import runs: its files are recorded before its rows exist. A key whose
 * asset has a row again (an upload restarted with the same id) is dropped and its file kept.
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
  const before = await removableBefore(db);
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
