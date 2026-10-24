import { isDeepStrictEqual } from 'node:util';
import {
  type BoardNotice,
  boardDocName,
  createBoardDoc,
  getSchemaVersion,
  hiddenFromGuests,
  migrateBoardDoc,
  roots,
  SchemaTooNewError,
} from '@inkadra/doc-schema';
import { MAX_NAMED_VERSIONS } from '@inkadra/shared';
import { and, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import type { CollabServer } from './collab.ts';
import type { Database } from './db/client.ts';
import { boardDoc, boardVersion } from './db/schema.ts';

/**
 * Saved states of board documents (decision 0013): automatic versions taken while a board is
 * edited, named ones people save, and the state a restore replaced. Each is a full Yjs update.
 *
 * Files are not copied into versions: a version refers to assets by id like the live board.
 * Anything that ever removes files nobody uses must therefore also look inside
 * `board_version`, because restoring a version can bring a file back onto a board.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The collaboration server takes an automatic version at most this often. */
export const AUTO_VERSION_EVERY_MS = HOUR;
/** Every automatic version is kept this long. */
export const HOURLY_KEEP_MS = 48 * HOUR;
/** The newest automatic version of each day (UTC) is kept this long. */
export const DAILY_KEEP_MS = 30 * DAY;
/** Restore backups follow the same retention as automatic versions. */
export const RESTORE_KEEP_MS = DAILY_KEEP_MS;
/** Bound direct restores too, including boards edited during every backup write. */
const RESTORE_TIMEOUT_MS = 10_000;
const MAX_RESTORE_ATTEMPTS = 10;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface VersionState {
  state: Uint8Array;
  schemaVersion: number;
  elementCount: number;
}

export function snapshot(doc: Y.Doc): VersionState {
  return {
    state: Y.encodeStateAsUpdate(doc),
    schemaVersion: getSchemaVersion(doc),
    elementCount: roots(doc).elements.size,
  };
}

/** Versions of one board are written one at a time, so counts and the cadence hold. */
async function lockBoard(tx: Tx, boardId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`board_version:${boardId}`}))`);
}

const startOfUtcDay = (at: Date) => new Date(Math.floor(at.getTime() / DAY) * DAY);

async function expireEarlierVersions(tx: Tx, boardId: string, kind: 'auto' | 'restore', now: Date) {
  await tx
    .update(boardVersion)
    .set({ expiresAt: sql`${boardVersion.createdAt} + interval '48 hours'` })
    .where(
      and(
        eq(boardVersion.boardId, boardId),
        eq(boardVersion.kind, kind),
        gte(boardVersion.createdAt, startOfUtcDay(now)),
      ),
    );
}

/**
 * Called by the collaboration server when an automatic version may be due: takes a version
 * version unless the board has one from the last hour. The newest automatic version of a day
 * is the one kept for 30 days, so the earlier ones of the same day go back to 48 hours.
 * Returns the latest automatic version's time, so the caller can skip checks for an hour.
 */
export async function takeAutoVersion(
  db: Database,
  boardId: string,
  snap: VersionState,
  now: Date,
): Promise<Date> {
  return db.transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const [recent] = await tx
      .select({ createdAt: boardVersion.createdAt })
      .from(boardVersion)
      .where(
        and(
          eq(boardVersion.boardId, boardId),
          eq(boardVersion.kind, 'auto'),
          gt(boardVersion.createdAt, new Date(now.getTime() - AUTO_VERSION_EVERY_MS)),
        ),
      )
      .orderBy(desc(boardVersion.createdAt))
      .limit(1);
    if (recent) return recent.createdAt;
    await expireEarlierVersions(tx, boardId, 'auto', now);
    await tx.insert(boardVersion).values({
      boardId,
      kind: 'auto',
      ...stateColumns(snap),
      createdAt: now,
      expiresAt: new Date(now.getTime() + DAILY_KEEP_MS),
    });
    return now;
  });
}

const stateColumns = (snap: VersionState) => ({
  state: snap.state,
  schemaVersion: snap.schemaVersion,
  size: snap.state.byteLength,
  elementCount: snap.elementCount,
});

/**
 * Retention, run hourly by the worker: automatic and restore versions are kept 48 hours,
 * then the newest of each kind per day (UTC) 30 days; named versions until deleted.
 * Keepers are worked out again on every run, so a day whose kept version was named or
 * deleted keeps its next newest one, as long as that one is still within its 48 hours.
 */
export async function applyVersionRetention(db: Database, now = new Date()) {
  await db.execute(sql`
    with ranked as (
      select id, created_at + case
          when row_number() over (
            partition by board_id, kind, (created_at at time zone 'UTC')::date
            order by created_at desc, id desc
          ) = 1 then interval '30 days'
          else interval '48 hours'
        end as expires
      from board_version
      where kind in ('auto', 'restore')
    )
    update board_version v set expires_at = r.expires
    from ranked r
    where v.id = r.id and v.kind in ('auto', 'restore')
      and v.expires_at is distinct from r.expires`);
  const removed = await db
    .delete(boardVersion)
    .where(and(inArray(boardVersion.kind, ['auto', 'restore']), lte(boardVersion.expiresAt, now)))
    .returning({ id: boardVersion.id });
  return { removed: removed.length };
}

/** Saves a named version, unless the board already has the most it may keep. */
export async function insertNamedVersion(
  db: Database,
  input: SaveVersion,
  snap: VersionState,
): Promise<SaveVersionResult> {
  return db.transaction(async (tx) => {
    await lockBoard(tx, input.boardId);
    if ((await countNamed(tx, input.boardId)) >= MAX_NAMED_VERSIONS)
      return { ok: false, reason: 'limit' } as const;
    if (expired(input.expiresAt)) return { ok: false, reason: 'expired' } as const;
    const [row] = await tx
      .insert(boardVersion)
      .values({
        boardId: input.boardId,
        kind: 'named',
        name: input.name,
        createdBy: input.userId,
        ...stateColumns(snap),
        createdAt: new Date(),
      })
      .returning({ id: boardVersion.id });
    if (!row) throw new Error('Version insert returned nothing');
    return { ok: true, versionId: row.id } as const;
  });
}

async function countNamed(tx: Tx, boardId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(boardVersion)
    .where(and(eq(boardVersion.boardId, boardId), eq(boardVersion.kind, 'named')));
  return row?.n ?? 0;
}

/**
 * Names a version. Naming an automatic or restore version makes it `named`, so retention
 * keeps it, and counts towards the board's limit of named versions.
 */
export async function nameVersion(
  db: Database,
  input: { boardId: string; versionId: string; name: string },
): Promise<{ ok: true } | { ok: false; reason: 'missing' | 'limit' }> {
  return db.transaction(async (tx) => {
    await lockBoard(tx, input.boardId);
    const [row] = await tx
      .select({ kind: boardVersion.kind })
      .from(boardVersion)
      .where(and(eq(boardVersion.id, input.versionId), eq(boardVersion.boardId, input.boardId)));
    if (!row) return { ok: false, reason: 'missing' } as const;
    if (row.kind !== 'named' && (await countNamed(tx, input.boardId)) >= MAX_NAMED_VERSIONS)
      return { ok: false, reason: 'limit' } as const;
    await tx
      .update(boardVersion)
      .set({ name: input.name, kind: 'named', expiresAt: null })
      .where(eq(boardVersion.id, input.versionId));
    return { ok: true } as const;
  });
}

/**
 * The stored state of a version as a document of the current schema. Throws
 * SchemaTooNewError for a version saved by a newer build.
 */
export function versionDoc(row: { state: Uint8Array }, boardId: string): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.state);
  migrateBoardDoc(doc, boardId);
  return doc;
}

const GUEST_HIDDEN = 'guestHidden';

/** Same content: Yjs types by their JSON (rich text as XML, with its marks), values deeply. */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Y.AbstractType || b instanceof Y.AbstractType) {
    if (!(a instanceof Y.AbstractType && b instanceof Y.AbstractType)) return false;
    if (a.constructor !== b.constructor) return false;
    return JSON.stringify(a.toJSON()) === JSON.stringify(b.toJSON());
  }
  return isDeepStrictEqual(a, b);
}

/**
 * Writes the content of `version` on top of `live` as one change: elements missing from the
 * version are removed, elements only in the version are added back, and fields that differ
 * are set, so the CRDT history goes on and concurrent edits still merge. Fields left alone
 * are not touched, so a card edited since only changes where it differs.
 * Nested note text, checklist items and strokes are replaced wholesale when different:
 * offline edits inside the replaced Yjs types do not merge into their replacements.
 *
 * Cards present in both keep their current hiding, including containers (decision 0013):
 * a restore never shows guests a card hidden since the version was taken. Cards brought back keep
 * the flag they had in the version. Comments, reviews and picks live in Postgres and are not
 * touched.
 */
export function writeVersionOver(live: Y.Doc, version: Y.Doc): void {
  const now = roots(live);
  const then = roots(version);
  const lookup = (id: string) => {
    const map = now.elements.get(id);
    return map
      ? { guestHidden: map.get(GUEST_HIDDEN) === true, parent: map.get('parent') as string | null }
      : undefined;
  };
  live.transact(() => {
    const hidden = [...now.elements.keys()].filter(
      (id) => then.elements.has(id) && hiddenFromGuests(id, lookup),
    );
    for (const id of [...now.elements.keys()]) if (!then.elements.has(id)) now.elements.delete(id);
    for (const [id, source] of then.elements.entries()) {
      const target = now.elements.get(id);
      if (!target) {
        now.elements.set(id, source.clone());
        continue;
      }
      for (const key of [...target.keys()])
        if (key !== GUEST_HIDDEN && !source.has(key)) target.delete(key);
      for (const [key, value] of source.entries()) {
        if (key === GUEST_HIDDEN || same(target.get(key), value)) continue;
        target.set(key, value instanceof Y.AbstractType ? value.clone() : value);
      }
    }
    for (const id of hidden)
      if (!hiddenFromGuests(id, lookup)) now.elements.get(id)?.set(GUEST_HIDDEN, true);
    const aspect = then.meta.get('aspect');
    if (!same(now.meta.get('aspect'), aspect)) {
      if (aspect === undefined) now.meta.delete('aspect');
      else now.meta.set('aspect', aspect);
    }
  });
}

export interface SaveVersion {
  boardId: string;
  name: string;
  userId: string;
  /** Epoch ms: past it nothing is saved (queued saves whose sender stopped waiting). */
  expiresAt?: number;
}

export type SaveVersionResult =
  | { ok: true; versionId: string }
  | { ok: false; reason: 'limit' | 'expired' };

export interface RestoreVersion {
  boardId: string;
  versionId: string;
  userId: string;
  /** Epoch ms: past it the board is not touched. */
  expiresAt?: number;
}

export type RestoreVersionResult =
  | { ok: true; backupId: string }
  | { ok: false; reason: 'missing' | 'too_new' | 'expired' };

/**
 * Versions that need the live document: a named save captures what people see, and a restore
 * writes where the document is live (decision 0014). The other operations only touch
 * Postgres.
 */
export interface VersionWriter {
  save(input: SaveVersion): Promise<SaveVersionResult>;
  restore(input: RestoreVersion): Promise<RestoreVersionResult>;
}

const expired = (at?: number) => at !== undefined && Date.now() > at;

/** The stored document of a board nobody has open, as the collaboration server loads it. */
async function storedDoc(db: Database, boardId: string): Promise<Y.Doc> {
  const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
  if (!row) return createBoardDoc(boardId);
  return versionDoc(row, boardId);
}

/**
 * Versions through a collaboration server in the same process (`all`, `collab`). The restore
 * is applied through a Hocuspocus direct connection like a clip, and closes like one: the
 * document is stored after the usual debounce, and a store that fails keeps it in memory.
 */
export function directVersionWriter(
  collab: CollabServer,
  db: Database,
  log?: Logger,
): VersionWriter {
  return {
    async save({ boardId, name, userId, expiresAt }) {
      // An open document is newer than what is stored; one nobody has open is not loaded
      // just to be read, which would store it again on unload.
      const live = collab.hocuspocus.documents.get(boardDocName(boardId));
      const snap = snapshot(live ?? (await storedDoc(db, boardId)));
      if (expired(expiresAt)) return { ok: false, reason: 'expired' };
      return insertNamedVersion(db, { boardId, name, userId, expiresAt }, snap);
    },

    async restore({ boardId, versionId, userId, expiresAt = Date.now() + RESTORE_TIMEOUT_MS }) {
      const [row] = await db
        .select({ state: boardVersion.state })
        .from(boardVersion)
        .where(and(eq(boardVersion.id, versionId), eq(boardVersion.boardId, boardId)));
      if (!row) return { ok: false, reason: 'missing' };
      let old: Y.Doc;
      try {
        old = versionDoc(row, boardId);
      } catch (err) {
        if (err instanceof SchemaTooNewError) return { ok: false, reason: 'too_new' };
        throw err;
      }
      if (expired(expiresAt)) return { ok: false, reason: 'expired' };

      const connection = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
      let backupId: string | undefined;
      let written = false;
      try {
        const doc = connection.document;
        if (!doc) throw new Error('direct connection closed');
        // Saved before anything changes, so the board can always go back.
        let before = snapshot(doc);
        backupId = await insertBackup(db, boardId, userId, before);
        for (
          let attempt = 0;
          !written && !expired(expiresAt) && attempt < MAX_RESTORE_ATTEMPTS;
          attempt += 1
        ) {
          let changed: VersionState | null = null;
          await connection.transact((live) => {
            if (expired(expiresAt)) return;
            const current = snapshot(live);
            // A state vector misses deletion-only edits. Compare full updates, including
            // their delete sets, and persist every intervening edit before replacing it.
            if (!Buffer.from(current.state).equals(before.state)) {
              changed = current;
              return;
            }
            writeVersionOver(live, old);
            written = true;
          });
          if (changed) {
            before = changed;
            const updated = await db
              .update(boardVersion)
              .set(stateColumns(before))
              .where(eq(boardVersion.id, backupId))
              .returning({ id: boardVersion.id });
            if (updated.length === 0) throw new Error('Restore backup was deleted');
          }
        }
        if (!written) {
          return { ok: false, reason: 'expired' };
        }
        const notice: BoardNotice = { type: 'restored', versionId };
        doc.broadcastStateless(JSON.stringify(notice));
        return { ok: true, backupId };
      } finally {
        if (backupId && !written) {
          try {
            await db.delete(boardVersion).where(eq(boardVersion.id, backupId));
          } catch (err) {
            log?.error({ err, boardId, backupId }, 'failed restore backup not removed');
          }
        }
        try {
          await connection.disconnect({ unloadImmediately: false });
        } catch (err) {
          log?.error({ err, boardId }, 'direct connection not closed cleanly');
        }
      }
    },
  };
}

async function insertBackup(db: Database, boardId: string, userId: string, snap: VersionState) {
  const now = new Date();
  return db.transaction(async (tx) => {
    await lockBoard(tx, boardId);
    await expireEarlierVersions(tx, boardId, 'restore', now);
    const [row] = await tx
      .insert(boardVersion)
      .values({
        boardId,
        kind: 'restore',
        createdBy: userId,
        ...stateColumns(snap),
        createdAt: now,
        expiresAt: new Date(now.getTime() + RESTORE_KEEP_MS),
      })
      .returning({ id: boardVersion.id });
    if (!row) throw new Error('Version insert returned nothing');
    return row.id;
  });
}
