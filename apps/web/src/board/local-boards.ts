// SPDX-License-Identifier: AGPL-3.0-only
import { copyElements, PasteRefusedError, pasteElements } from '@inkadra/canvas-core';
import {
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  migrateBoardDoc,
  roots,
} from '@inkadra/doc-schema';
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
/**
 * Edits the server refused (size limit) or that lost their board (no access, trash), set aside
 * on the device (#791): one copy per person and board, which later ones merge into.
 */
const KEPT_PREFIX = 'inkadra-kept:';
/** Applies the copy to the board: not an edit made here. */
export const LOCAL_ORIGIN = Symbol('local copy');

export function localBoardName(userId: string, boardId: string): string {
  return `${PREFIX}${userId}:${boardId}`;
}
const keptName = (userId: string, boardId: string) => `${KEPT_PREFIX}${userId}:${boardId}`;

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
/**
 * Copies whose deletion was called off because setting their edits aside failed (a full disk):
 * they stay on the device, unsaved, and are not merged again in this tab, where the server
 * would refuse them again. shortcut: this tab then edits the board in memory only; the copy is
 * tried again when the app next starts.
 */
const withheld = new Set<string>();

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

/** Writes the `unsaved` flag of a stored copy, and waits until it is on disk. */
function writeUnsaved(name: string, value: 0 | 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name);
    // Gone meanwhile: never create it.
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('custom', 'readwrite');
      tx.objectStore('custom').put(value, 'unsaved');
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
      db.close();
    };
  });
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

/** Which updates of the board are edits made here, for the `unsaved` flag (#791). */
export interface Edits {
  /** The board was edited before its copy opened. */
  before: () => boolean;
  /** An update of this origin is an edit made here. */
  is: (origin: unknown) => boolean;
}
const noEdits: Edits = { before: () => false, is: () => false };

/**
 * Opens the copy of a board into `doc`. A copy written by an older build is migrated before it
 * is merged, as the server migrates its own document on load; a copy of a newer schema than this
 * build reads is not merged at all (`tooNew`), and stays on the device for a newer build.
 * `onLost`: the copy was deleted elsewhere while open; the board goes on in memory.
 * `edits`: the copy says it is unsaved no later than it stores an edit, so that a crash in
 * between never leaves an edit behind a copy that says it has none (which a sweep deletes).
 */
export async function openLocalBoard(
  name: string,
  boardId: string,
  doc: Y.Doc,
  onLost: () => void,
  edits: Edits = noEdits,
): Promise<LocalBoard & { tooNew: boolean }> {
  if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB here.');
  await deleting.get(name);
  if (withheld.has(name)) throw new Error('Its edits were refused; kept on the device.');
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
    // Edits made before it opened are in the state stored below: the flag goes first.
    let flagged = flag === 1;
    if (!flagged && edits.before()) {
      await writeUnsaved(name, 1);
      flagged = true;
    }
    // Stores the board as it now is, the migrated copy included, then follows its edits.
    const persistence = new IndexeddbPersistence(name, doc);
    let lost = false;
    let closed: Promise<void> | null = null;
    // The first edit after the copy said it had none is stored with the flag, in one transaction.
    const storeUpdate = persistence._storeUpdate;
    doc.off('update', storeUpdate);
    let missed = false;
    const store = (update: Uint8Array, origin: unknown) => {
      if (lost || closed) return;
      const db = persistence.db;
      if (flagged || origin === persistence || !edits.is(origin))
        return storeUpdate(update, origin);
      // Before the database opens, the edit is stored with the board's state once it has.
      // shortcut: then the flag follows in a transaction of its own, a few milliseconds later.
      if (!db) {
        missed = true;
        return storeUpdate(update, origin);
      }
      try {
        const tx = db.transaction(['updates', 'custom'], 'readwrite');
        tx.objectStore('custom').put(1, 'unsaved');
        tx.objectStore('updates').add(update);
        persistence._dbsize += 1;
        flagged = true;
      } catch {
        // The database closed under it: `versionchange` lets the copy go.
      }
    };
    doc.on('update', store);
    const stop = () => {
      doc.off('update', store);
      return persistence.destroy();
    };
    void persistence._db.then((db) =>
      db.addEventListener('versionchange', () => {
        // Deleted elsewhere: writing to the closed database would break the document's updates.
        lost = true;
        void stop();
        onLost();
      }),
    );
    await persistence.whenSynced;
    if (missed && !flagged && !lost) {
      flagged = true;
      void persistence.set('unsaved', 1).catch(() => {});
    }
    return {
      tooNew: false,
      unsaved: flag === 1,
      mark: (unsaved) => {
        if (lost || closed) return;
        // Raised by the next edit's own transaction: this one may reach the disk after it.
        if (!unsaved) flagged = false;
        void persistence.set('unsaved', unsaved ? 1 : 0).catch(() => {});
      },
      close: () => {
        closed ??= stop()
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
 * Deletes a copy at once, once `after` is done (the copy closed here, its edits set aside): the
 * person lost access to the board, or the server refused its edits. If `after` fails, the copy
 * stays, with its flag. A reopen of it waits for the deletion.
 */
export function dropLocalBoard(name: string, after?: Promise<unknown>): Promise<void> {
  const done: Promise<void> = Promise.resolve(after)
    .then(
      () => deleteCopy(name),
      () => {
        withheld.add(name);
      },
    )
    .catch(() => {})
    .finally(() => {
      if (deleting.get(name) === done) deleting.delete(name);
    });
  deleting.set(name, done);
  return done;
}

/**
 * Sets aside edits the server will not take (#791): refused at the board's size limit, or the
 * board was lost (no access, in the trash). The board then reopens from what the server
 * confirmed, and they stay on the device to restore (`keptUpdate`, #898) or download
 * (`downloadKept`) instead of being lost.
 * One copy per board: what is set aside later is merged into it, so nothing earlier is lost.
 * Rejects when it could not be stored (a full disk): the caller then keeps the board's copy.
 */
export async function keepAside(userId: string, boardId: string, doc: Y.Doc): Promise<void> {
  if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB here.');
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const kept = new IndexeddbPersistence(keptName(userId, boardId), copy);
  try {
    await kept.whenSynced;
    await kept.set('unsaved', 1);
  } finally {
    await kept.destroy();
    copy.destroy();
  }
}

/** The boards of the person with edits set aside on this device, not downloaded yet. */
export async function keptBoards(userId: string): Promise<string[]> {
  const boards: string[] = [];
  for (const name of await storedNames(`${KEPT_PREFIX}${userId}:`))
    if ((await readUnsaved(name).catch(() => undefined)) === 1)
      boards.push(name.slice(KEPT_PREFIX.length + userId.length + 1));
  return boards;
}

/** Whether edits of this board are set aside on this device, not downloaded yet. */
export async function hasKept(userId: string, boardId: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  return (await readUnsaved(keptName(userId, boardId)).catch(() => undefined)) === 1;
}

const base64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/** The edits set aside for a board, read into a document of their own. */
async function readKept(userId: string, boardId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const kept = new IndexeddbPersistence(keptName(userId, boardId), doc);
  try {
    await kept.whenSynced;
  } finally {
    await kept.destroy();
  }
  return doc;
}

/** Why edits set aside could not go back into their board (#898). */
export class RestoreError extends Error {
  constructor(
    readonly reason:
      | 'refused'
      | 'notWritable'
      | 'tooNew'
      | 'invalid'
      | 'otherBoard'
      | 'tooBig'
      | 'conflict',
    /** With `conflict`: what merging them would lose or overwrite. */
    readonly conflict?: RestoreConflict,
  ) {
    super(`Edits not restored: ${reason}`);
  }
}

/**
 * Edits set aside, checked apart first as an opened copy is (#898): one of a newer schema than
 * this build reads is refused, and so is one that is not whole (structs missing what they build
 * on). An older one is returned as it is: `restoreConflict` says it cannot be merged as such.
 */
export function restorableUpdate(update: Uint8Array): Uint8Array {
  const scratch = new Y.Doc();
  try {
    try {
      Y.applyUpdate(scratch, update);
    } catch {
      throw new RestoreError('invalid');
    }
    if (scratch.store.pendingStructs || scratch.store.pendingDs) throw new RestoreError('invalid');
    if (getSchemaVersion(scratch) > CURRENT_SCHEMA_VERSION) throw new RestoreError('tooNew');
    return update;
  } finally {
    scratch.destroy();
  }
}

/** What merging edits set aside would do to the board as it is now (#898). */
export interface RestoreConflict {
  /** Cards the edits change that were deleted on the board since. */
  deleted: string[];
  /** Cards whose edits would lose to edits made on the board since, or overwrite them. */
  changed: string[];
  /** Board settings (`meta` keys) in the same case. */
  settings: string[];
  /**
   * Set aside under an older schema than the board's: merging them would also merge the
   * migration this device made, whose writes can overwrite newer ones on the board.
   */
  older: boolean;
  /** Every card the edits change, which `restoreAsNew` copies. */
  cards: string[];
}

/** Where an item of a board lives: its card and the card's field, or a root's key. */
function placeOf(item: Y.Item): { card?: string; key: string | null } {
  let field: Y.Item | null = null;
  let at: Y.Item = item;
  for (;;) {
    const parent = at.parent as Y.AbstractType<unknown>;
    if (!parent._item) {
      if (Y.findRootTypeKey(parent) === 'elements')
        return { card: at.parentSub ?? undefined, key: field?.parentSub ?? null };
      return { key: at.parentSub };
    }
    field = at;
    at = parent._item;
  }
}

/**
 * Calls `each` with the parts of the structs in `[clock, clock + length)` of a client: items, or
 * GC where content went with a deleted parent (merged into a card deleted and collected, it is).
 */
function eachPart(
  doc: Y.Doc,
  client: number,
  clock: number,
  length: number,
  each: (struct: Y.Item | Y.GC) => void,
) {
  const end = clock + length;
  let at = clock;
  while (at < end) {
    const struct = Y.getItem(doc.store, Y.createID(client, at)) as Y.Item | Y.GC;
    each(struct);
    at = struct.id.clock + struct.length;
  }
}

/** Gone from the document: deleted, or collected as GC. */
const gone = (struct: Y.Item | Y.GC) => !(struct instanceof Y.Item) || struct.deleted;

/** Whether two values of a board read the same, whatever the order of their keys. */
const same = (a: unknown, b: unknown) => {
  const plain = (v: unknown): unknown => {
    const value = v instanceof Y.AbstractType ? v.toJSON() : v;
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, plain((value as Record<string, unknown>)[k])]),
      );
    return value;
  };
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
};

/** The value at a place of a board, as `same` compares it. */
function valueAt(doc: Y.Doc, place: { card?: string; key: string | null }): unknown {
  const { meta, elements } = roots(doc);
  if (place.card === undefined) return place.key === null ? undefined : meta.get(place.key);
  const card = elements.get(place.card);
  return place.key === null ? card : card?.get(place.key);
}

/**
 * What merging edits set aside (`update`, from `restorableUpdate`) into `board` would lose or
 * overwrite, or null when it would keep every one of them and every newer edit of the board.
 * The part the board lacks is merged into a clone: an edit lost is one of its items that ends up
 * deleted there (its card deleted since, or a field written since that wins over it), an edit
 * overwritten is one of the board's items the kept copy never saw that the merge deletes. Only
 * where the value differs: two writes of the same value lose nothing.
 */
export function restoreConflict(board: Y.Doc, update: Uint8Array): RestoreConflict | null {
  const kept = new Y.Doc({ gc: false });
  const clone = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(kept, update);
    const missing = Y.diffUpdate(update, Y.encodeStateVector(board));
    const seen = Y.decodeStateVector(Y.encodeStateVector(kept));
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(board));
    // The board's items the kept copy never saw, alive before the merge.
    const newer: { client: number; clock: number; length: number }[] = [];
    for (const [client, structs] of clone.store.clients) {
      const from = seen.get(client) ?? 0;
      for (const struct of structs)
        if (struct instanceof Y.Item && !struct.deleted && struct.id.clock + struct.length > from)
          newer.push({ client, clock: struct.id.clock, length: struct.length });
    }
    Y.applyUpdate(clone, missing);
    if (clone.store.pendingStructs) throw new RestoreError('invalid');
    const deleted = new Set<string>();
    const changed = new Set<string>();
    const settings = new Set<string>();
    const cards = new Set<string>();
    const note = (place: { card?: string; key: string | null }) => {
      if (place.card === undefined) {
        if (place.key !== null) settings.add(place.key);
      } else if (!roots(clone).elements.has(place.card) && roots(kept).elements.has(place.card))
        deleted.add(place.card);
      // Also a card deleted while set aside that someone edited since: the deletion drops it.
      else changed.add(place.card);
    };
    for (const struct of Y.decodeUpdate(missing).structs) {
      if (!(struct instanceof Y.Item)) continue;
      const { client, clock } = struct.id;
      eachPart(kept, client, clock, struct.length, (item) => {
        // Typed, then deleted again while set aside: nothing to keep.
        if (!(item instanceof Y.Item) || item.deleted) return;
        const place = placeOf(item);
        if (place.card !== undefined && roots(kept).elements.has(place.card)) cards.add(place.card);
        eachPart(clone, client, item.id.clock, item.length, (merged) => {
          if (gone(merged) && !same(valueAt(clone, place), valueAt(kept, place))) note(place);
        });
      });
    }
    for (const { client, clock, length } of newer)
      eachPart(clone, client, clock, length, (item) => {
        if (!(item instanceof Y.Item) || !item.deleted) return;
        const place = placeOf(item);
        if (!same(valueAt(clone, place), valueAt(board, place))) note(place);
      });
    const version = getSchemaVersion(kept);
    const older = version > 0 && version < getSchemaVersion(board);
    if (!older && !deleted.size && !changed.size && !settings.size) return null;
    for (const id of deleted) changed.delete(id);
    return {
      deleted: [...deleted],
      changed: [...changed],
      settings: [...settings],
      older,
      cards: [...cards],
    };
  } finally {
    kept.destroy();
    clone.destroy();
  }
}

/**
 * Restores edits set aside as new cards (#898): a copy of every card they change (`cards` of
 * `restoreConflict`), as the kept copy has it, with new ids and at its place, while the board's
 * own cards stay as they are. Nothing is merged, so nothing on the board is overwritten; one of
 * an older schema is migrated apart first. Returns the ids of the new cards.
 */
export function restoreAsNew(
  board: Y.Doc,
  update: Uint8Array,
  cards: string[],
  opts: { boardId: string; userId: string | null },
): string[] {
  const kept = new Y.Doc();
  try {
    Y.applyUpdate(kept, update);
    const version = getSchemaVersion(kept);
    if (version > 0 && version < CURRENT_SCHEMA_VERSION) migrateBoardDoc(kept, opts.boardId);
    const ids = cards.filter((id) => roots(kept).elements.has(id));
    if (!ids.length) return [];
    const data = copyElements(kept, ids);
    const free = data.elements.filter((e) => e.parent === null);
    // Beside a card still on the board, as Duplicate puts a copy, rather than hiding it.
    const shift = ids.some((id) => roots(board).elements.has(id)) ? 24 : 0;
    const at = {
      x: (free.length ? Math.min(...free.map((e) => e.x)) : 0) + shift,
      y: (free.length ? Math.min(...free.map((e) => e.y)) : 0) + shift,
    };
    try {
      return pasteElements(board, data, at, { userId: opts.userId }).ids;
    } catch (err) {
      if (err instanceof PasteRefusedError) throw new RestoreError('invalid');
      throw err;
    }
  } finally {
    kept.destroy();
  }
}

/** The edits set aside on this device for a board, ready to merge into it (#898). */
export async function keptUpdate(userId: string, boardId: string): Promise<Uint8Array> {
  const doc = await readKept(userId, boardId);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return restorableUpdate(update);
}

/**
 * The largest set of edits a file may bring back (#898): the server's default limit of a
 * board's state (BOARD_MAX_STATE_BYTES). shortcut: an instance with a higher limit cannot
 * restore a larger file this way; the client would need the limit from the server.
 */
export const KEPT_FILE_MAX_BYTES = 64 * 1024 * 1024;

/** The size a file `keptFile` made may have: the update in base64, and the board readable. */
export const keptFileMaxSize = () => KEPT_FILE_MAX_BYTES * 3;

const fromBase64 = (text: string): Uint8Array => {
  const native = (Uint8Array as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (native) return native(text);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * The edits in a file `keptFile` made, ready to merge into the board (#898). The file comes from
 * the person's disk: anything but such a file of this board, within the size limit, is refused.
 */
export function keptFileUpdate(text: string, boardId: string): Uint8Array {
  if (text.length > keptFileMaxSize()) throw new RestoreError('tooBig');
  let file: { format?: unknown; version?: unknown; boardId?: unknown; update?: unknown };
  try {
    file = JSON.parse(text);
  } catch {
    throw new RestoreError('invalid');
  }
  if (file?.format !== 'inkadra-kept-changes' || typeof file.update !== 'string')
    throw new RestoreError('invalid');
  if (typeof file.version !== 'number' || file.version > 1) throw new RestoreError('tooNew');
  if (file.boardId !== boardId) throw new RestoreError('otherBoard');
  if ((file.update.length / 4) * 3 > KEPT_FILE_MAX_BYTES) throw new RestoreError('tooBig');
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(file.update);
  } catch {
    throw new RestoreError('invalid');
  }
  return restorableUpdate(bytes);
}

/**
 * The edits set aside for a board, as a JSON file: the board as this device had it (`content`,
 * readable) and the same document as a Yjs update (`update`, base64), which restores it exactly.
 */
export async function keptFile(
  userId: string,
  boardId: string,
): Promise<{ blob: Blob; name: string }> {
  const doc = await readKept(userId, boardId);
  const { meta, elements } = roots(doc);
  const file = {
    format: 'inkadra-kept-changes',
    version: 1,
    boardId,
    schemaVersion: getSchemaVersion(doc),
    content: { meta: meta.toJSON(), elements: elements.toJSON() },
    update: base64(Y.encodeStateAsUpdate(doc)),
  };
  doc.destroy();
  return {
    blob: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    name: `inkadra-kept-changes-${boardId}.json`,
  };
}

/**
 * Downloads the edits set aside for a board (`keptFile`, saved with the export's own download):
 * they then no longer count as only on this device, and the next sweep deletes them.
 */
export async function downloadKept(userId: string, boardId: string): Promise<void> {
  const [{ blob, name }, { downloadBlob }] = await Promise.all([
    keptFile(userId, boardId),
    import('./export/engine.ts'),
  ]);
  downloadBlob(blob, name);
  await writeUnsaved(keptName(userId, boardId), 0);
}

/** The person discarded the edits set aside for a board. */
export function discardKept(userId: string, boardId: string): Promise<void> {
  return dropLocalBoard(keptName(userId, boardId));
}

/**
 * The boards with edits only on this device, of the person: signing out would delete them. A
 * copy whose flag cannot be read counts too: it may hold edits, so signing out asks first.
 */
export async function unsavedLocalBoards(userId: string): Promise<string[]> {
  const boards = new Set<string>();
  for (const prefix of [PREFIX, KEPT_PREFIX])
    for (const name of await storedNames(`${prefix}${userId}:`))
      if ((await readUnsaved(name).catch(() => 1)) === 1)
        boards.add(name.slice(prefix.length + userId.length + 1));
  return [...boards];
}

/**
 * Deletes the copies nobody has open and nothing unsaved is in: the server has all they hold,
 * or the person downloaded the edits set aside. Copies of any account: they hold nothing that
 * is not on the server or downloaded, and keep the device lean.
 */
export async function sweepLocalBoards(): Promise<void> {
  const locks = lockManager();
  if (!locks) return;
  for (const name of [...(await storedNames(PREFIX)), ...(await storedNames(KEPT_PREFIX))]) {
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
