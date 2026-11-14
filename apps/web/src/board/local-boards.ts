// SPDX-License-Identifier: AGPL-3.0-only
import { clearDocument, IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

/**
 * The copy of a board kept on this device (#791), so that edits the server has not confirmed
 * survive a closed tab, a reload, a crash or a discarded background tab, and are sent when the
 * board opens again online. One IndexedDB database per person and board: another account on the
 * same browser never opens it. Signing out deletes the person's copies; so does losing access
 * to a board. A board closed with everything confirmed drops its copy, so only boards with
 * unconfirmed edits stay on the device.
 * shortcut: two tabs of the same board share the copy; the first to close confirmed deletes it
 * while the other keeps editing in memory, which then warns before it closes (`setUnsaved`).
 */
const PREFIX = 'inkadra-board:';

export function localBoardName(userId: string, boardId: string): string {
  return `${PREFIX}${userId}:${boardId}`;
}

/** Copies open in this tab, and deletions still running, which a reopen waits for. */
const open = new Set<IndexeddbPersistence>();
const clearing = new Map<string, Promise<void>>();

/** Opens the copy of a board into `doc`, once a deletion of it that is still running is done. */
export async function openLocalBoard(name: string, doc: Y.Doc): Promise<IndexeddbPersistence> {
  if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB here.');
  await clearing.get(name);
  const local = new IndexeddbPersistence(name, doc);
  open.add(local);
  return local;
}

/** Closes a copy; `clear` deletes it from the device. */
export function closeLocalBoard(local: IndexeddbPersistence, clear: boolean): Promise<void> {
  open.delete(local);
  if (!clear) return local.destroy().catch(() => {});
  const { name } = local;
  const done: Promise<void> = local
    .clearData()
    .catch(() => {})
    .finally(() => {
      if (clearing.get(name) === done) clearing.delete(name);
    });
  clearing.set(name, done);
  return done;
}

/** Deletes every copy of the person's boards on this device: when they sign out. */
export async function clearLocalBoards(userId: string): Promise<void> {
  const prefix = `${PREFIX}${userId}:`;
  const closing = [...open]
    .filter((local) => local.name.startsWith(prefix))
    .map((local) => closeLocalBoard(local, true));
  const stored =
    typeof indexedDB === 'undefined' ? [] : ((await indexedDB.databases?.().catch(() => [])) ?? []);
  await Promise.all([
    ...closing,
    ...clearing.values(),
    ...stored.flatMap((db) =>
      db.name?.startsWith(prefix) ? [clearDocument(db.name).catch(() => {})] : [],
    ),
  ]);
}
