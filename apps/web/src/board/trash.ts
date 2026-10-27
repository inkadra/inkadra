// SPDX-License-Identifier: AGPL-3.0-only
import { isContainer } from '@inkadra/canvas-core';
import { type Element, roots, UNSORTED } from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
import { type BoardStore, LOCAL } from './store.ts';
import { versionStore } from './versions.ts';

/** Only the snapshot's id is kept: the bytes are fetched again on restore. */
export type TrashItem = { element: Element; savedAt: string; versionId: string };

/**
 * Newest snapshots come first. Keep only the most recent recoverable state per id, and
 * skip ids that are alive in the current document.
 */
export function collectTrash(
  items: Map<string, TrashItem>,
  version: BoardVersion,
  update: Uint8Array,
  boardId: string,
  isLive: (id: string) => boolean = () => false,
) {
  const source = versionStore(update, boardId);
  try {
    for (const element of source.getSnapshot().byId.values()) {
      if (!items.has(element.id) && !isLive(element.id))
        items.set(element.id, { element, savedAt: version.createdAt, versionId: version.id });
    }
  } finally {
    source.destroy();
    source.doc.destroy();
  }
}

/** Clone CRDT fields, including rich text, rather than merging an old board into the live doc. */
export function restoreTrashItem(
  store: BoardStore,
  item: TrashItem,
  update: Uint8Array,
  boardId: string,
): boolean {
  const { elements } = roots(store.doc);
  if (elements.has(item.element.id)) return false;
  const source = versionStore(update, boardId);
  try {
    const original = source.map(item.element.id);
    if (!original) return false;
    const copy = original.clone();
    const parent = item.element.parent;
    const liveParent = parent ? store.getSnapshot().byId.get(parent) : undefined;
    if (parent !== null && parent !== UNSORTED && (!liveParent || !isContainer(liveParent))) {
      copy.set('parent', null);
    }
    store.undo.stopCapturing();
    store.doc.transact(() => elements.set(item.element.id, copy), LOCAL);
    store.undo.stopCapturing();
    return true;
  } finally {
    source.destroy();
    source.doc.destroy();
  }
}
