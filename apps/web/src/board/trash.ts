import { isContainer } from '@inkadra/canvas-core';
import { type Element, roots, UNSORTED } from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
import { type BoardStore, LOCAL } from './store.ts';
import { versionStore } from './versions.ts';

export type TrashItem = { element: Element; savedAt: string; update: Uint8Array };

/** Newest snapshots come first. Keep only the most recent recoverable state per id. */
export function collectTrash(
  items: Map<string, TrashItem>,
  version: BoardVersion,
  update: Uint8Array,
  boardId: string,
) {
  const source = versionStore(update, boardId);
  try {
    for (const element of source.getSnapshot().byId.values()) {
      if (!items.has(element.id))
        items.set(element.id, { element, savedAt: version.createdAt, update });
    }
  } finally {
    source.destroy();
    source.doc.destroy();
  }
}

/** Clone CRDT fields, including rich text, rather than merging an old board into the live doc. */
export function restoreTrashItem(store: BoardStore, item: TrashItem, boardId: string): boolean {
  const { elements } = roots(store.doc);
  if (elements.has(item.element.id)) return false;
  const source = versionStore(item.update, boardId);
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
