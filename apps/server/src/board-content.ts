import { boardDocName, hiddenFromGuests, roots } from '@inkadra/doc-schema';
import { Id } from '@inkadra/shared';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import type { CollabServer } from './collab.ts';
import type { Database } from './db/client.ts';
import { boardDoc } from './db/schema.ts';

/** What the card a comment or review is about looks like in the stored board document. */
export interface StoredElement {
  createdBy: string | null;
}

/**
 * An element of the stored document of a board, or null when the board has no stored document
 * or the element is not in it.
 */
export async function storedElement(
  db: Database,
  boardId: string,
  elementId: string,
): Promise<StoredElement | null> {
  const [row] = await db
    .select({ state: boardDoc.state })
    .from(boardDoc)
    .where(eq(boardDoc.boardId, boardId));
  if (!row) return null;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, row.state);
    const map = roots(doc).elements.get(elementId);
    if (!(map instanceof Y.Map)) return null;
    const createdBy = map.get('createdBy');
    return {
      createdBy:
        typeof createdBy === 'string' && Id.safeParse(createdBy).success ? createdBy : null,
    };
  } finally {
    doc.destroy();
  }
}

/** A visible board card connecting two boards in the stored snapshot; fail closed. */
export async function visibleBoardCard(
  db: Database,
  boardId: string,
  childId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ state: boardDoc.state })
    .from(boardDoc)
    .where(eq(boardDoc.boardId, boardId));
  if (!row) return false;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, row.state);
    const { elements } = roots(doc);
    for (const [id, el] of elements) {
      if (!(el instanceof Y.Map)) continue;
      if (el.get('type') !== 'board' || el.get('boardId') !== childId) continue;
      const hidden = hiddenFromGuests(id, (key) => {
        const node = elements.get(key);
        if (!(node instanceof Y.Map)) return undefined;
        const parent = node.get('parent');
        // Invalid containers are hidden, never treated as the canvas.
        if (parent !== null && typeof parent !== 'string') return undefined;
        return { parent, guestHidden: node.get('guestHidden') === true };
      });
      if (!hidden) return true;
    }
    return false;
  } finally {
    doc.destroy();
  }
}

/** Internal reader; callers must authorize the board before looking up its cards. */
export interface BoardReader {
  element(boardId: string, elementId: string): Promise<StoredElement | null>;
}

/** Read the authoritative live document, including deletions, before using stored state. */
export function directBoardReader(collab: CollabServer, db: Database): BoardReader {
  return {
    async element(boardId, elementId) {
      const doc = collab.hocuspocus.documents.get(boardDocName(boardId));
      if (!doc) return storedElement(db, boardId, elementId);
      const map = roots(doc).elements.get(elementId);
      if (!(map instanceof Y.Map)) return null;
      const createdBy = map.get('createdBy');
      return {
        createdBy:
          typeof createdBy === 'string' && Id.safeParse(createdBy).success ? createdBy : null,
      };
    },
  };
}
