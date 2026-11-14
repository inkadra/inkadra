// SPDX-License-Identifier: AGPL-3.0-only
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, migrateBoardDoc } from '@inkadra/doc-schema';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

/**
 * The copy of a board kept on this device (#791), so that edits the server has not confirmed
 * survive a closed tab, a reload, a crash or a discarded background tab, and are sent when the
 * board opens again online. One IndexedDB database per person and board: another account on the
 * same browser never opens it. The copy says itself whether it holds unconfirmed edits
 * (`unsaved`, 1 or 0).
 *
 * Closing a board never deletes its copy: another tab, or another view of the same tab, may
 * have it open, and deleting a database closes it under that one. Every context holds a shared
 * Web Lock on a copy while it has it open; copies with nothing unsaved are deleted later, under
 * the exclusive lock, when nobody has them open (`sweepLocalBoards`: at start and when the
 * session ends). Without Web Locks nothing is swept: the copies stay until sign-out.
 * Only an explicit loss of access and signing out delete a copy at once; a context that still
 * has it open then lets it go and keeps editing in memory (`onLost`).
 */
const PREFIX = 'inkadra-board:';
/** Edits the server refused at the board's size limit, set aside on the device (#791). */
const KEPT_PREFIX = 'inkadra-kept:';
/** Applies the copy to the board: not an edit made here. */
export const LOCAL_ORIGIN = Symbol('local copy');

export function localBoardName(userId: string, boardId: string): string {
  return `${PREFIX}${userId}:${boardId}`;
}

export interface LocalBoard {
  /** The copy held edits the server had not confirmed when it was opened. */
  unsaved: boolean;
  /** Says on the device whether the copy holds edits the server has not confirmed. */
  mark(unsaved: boolean): void;
  /** Lets the copy go, keeping it on the device. */
  close(): Promise<void>;
}

/** Deletions still running, which a reopen of the same copy waits for. */
const deleting = new Map<string, Promise<void>>();

const lockName = (name: string) => `inkadra-copy:${name}`;
const lockManager = (): LockManager | undefined => globalThis.navigator?.locks;

/** Holds the shared lock on a copy until the returned function runs. */
async function holdShared(name: string): Promise<() => void> {
  const locks = lockManager();
  if (!locks) return () => {};
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await new Promise<void>((granted) => {
    void locks.request(lockName(name), { mode: 'shared' }, () => {
      granted();
      return held;
    });
  });
  return release;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Deletes a copy; contexts that have it open close it first (lib0 closes on `versionchange`). */
function deleteCopy(name: string): Promise<void> {
  return request(indexedDB.deleteDatabase(name)).then(() => {});
}

/** The `unsaved` flag of a stored copy, read without loading its updates. */
function readUnsaved(name: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name);
    // Gone meanwhile: never create it.
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('custom')) {
        db.close();
        resolve(undefined);
        return;
      }
      request(db.transaction('custom', 'readonly').objectStore('custom').get('unsaved'))
        .then(resolve, reject)
        .finally(() => db.close());
    };
  });
}

async function storedNames(prefix: string): Promise<string[]> {
  if (typeof indexedDB === 'undefined') return [];
  const stored = (await indexedDB.databases?.().catch(() => [])) ?? [];
  return stored.flatMap((db) => (db.name?.startsWith(prefix) ? [db.name] : []));
}

/**
 * Opens the copy of a board into `doc`. A copy written by an older build is migrated before it
 * is merged, as the server migrates its own document on load; a copy of a newer schema than this
 * build reads is not merged at all (`tooNew`), and stays on the device for a newer build.
 * `onLost`: the copy was deleted elsewhere while open; the board goes on in memory.
 */
export async function openLocalBoard(
  name: string,
  boardId: string,
  doc: Y.Doc,
  onLost: () => void,
): Promise<LocalBoard & { tooNew: boolean }> {
  if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB here.');
  await deleting.get(name);
  const release = await holdShared(name);
  try {
    // Read apart first: what it holds is checked before it reaches the board.
    const scratch = new Y.Doc();
    const reader = new IndexeddbPersistence(name, scratch);
    const [, flag] = await Promise.all([reader.whenSynced, reader.get('unsaved')]);
    await reader.destroy();
    const version = getSchemaVersion(scratch);
    if (version > CURRENT_SCHEMA_VERSION) {
      scratch.destroy();
      release();
      return { tooNew: true, unsaved: flag === 1, mark: () => {}, close: async () => {} };
    }
    if (version > 0 && version < CURRENT_SCHEMA_VERSION) migrateBoardDoc(scratch, boardId);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch), LOCAL_ORIGIN);
    scratch.destroy();
    // Stores the board as it now is, the migrated copy included, then follows its edits.
    const persistence = new IndexeddbPersistence(name, doc);
    let lost = false;
    void persistence._db.then((db) =>
      db.addEventListener('versionchange', () => {
        // Deleted elsewhere: writing to the closed database would break the document's updates.
        lost = true;
        void persistence.destroy();
        onLost();
      }),
    );
    await persistence.whenSynced;
    let closed: Promise<void> | null = null;
    return {
      tooNew: false,
      unsaved: flag === 1,
      mark: (unsaved) => {
        if (!lost && !closed) void persistence.set('unsaved', unsaved ? 1 : 0).catch(() => {});
      },
      close: () => {
        closed ??= persistence
          .destroy()
          .catch(() => {})
          .finally(release);
        return closed;
      },
    };
  } catch (err) {
    release();
    throw err;
  }
}

/**
 * Deletes a copy at once, once `after` is done (the copy closed here): the person lost access to
 * the board. A reopen of it waits for the deletion.
 */
export function dropLocalBoard(name: string, after?: Promise<unknown>): Promise<void> {
  const done: Promise<void> = Promise.resolve(after)
    .catch(() => {})
    .then(() => deleteCopy(name))
    .catch(() => {})
    .finally(() => {
      if (deleting.get(name) === done) deleting.delete(name);
    });
  deleting.set(name, done);
  return done;
}

/**
 * Sets aside the edits the server refused at the board's size limit (#791): the board then
 * reopens from what the server confirmed, and they stay on the device instead of being lost.
 */
export async function keepAside(userId: string, boardId: string, doc: Y.Doc): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const kept = new IndexeddbPersistence(`${KEPT_PREFIX}${userId}:${boardId}:${Date.now()}`, copy);
  try {
    await kept.whenSynced;
    await kept.set('unsaved', 1);
  } finally {
    await kept.destroy();
    copy.destroy();
  }
}

/** The boards with edits only on this device, of the person: signing out would delete them. */
export async function unsavedLocalBoards(userId: string): Promise<string[]> {
  const boards = new Set<string>();
  for (const name of await storedNames(`${PREFIX}${userId}:`)) {
    if ((await readUnsaved(name).catch(() => undefined)) === 1)
      boards.add(name.slice(PREFIX.length + userId.length + 1));
  }
  for (const name of await storedNames(`${KEPT_PREFIX}${userId}:`))
    boards.add(name.slice(KEPT_PREFIX.length + userId.length + 1).split(':')[0] ?? name);
  return [...boards];
}

/**
 * Deletes the copies nobody has open and nothing unsaved is in: the server has all they hold.
 * Copies of any account: they hold nothing that is not on the server, and keep the device lean.
 */
export async function sweepLocalBoards(): Promise<void> {
  const locks = lockManager();
  if (!locks) return;
  for (const name of await storedNames(PREFIX)) {
    await locks
      .request(lockName(name), { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock || deleting.has(name)) return;
        if ((await readUnsaved(name)) !== 1) await deleteCopy(name);
      })
      .catch(() => {});
  }
}

/** Deletes every copy of the person's boards on this device: they confirmed signing out. */
export async function clearLocalBoards(userId: string): Promise<void> {
  const names = [
    ...(await storedNames(`${PREFIX}${userId}:`)),
    ...(await storedNames(`${KEPT_PREFIX}${userId}:`)),
  ];
  await Promise.all(names.map((name) => dropLocalBoard(name)));
}
