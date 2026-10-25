import { boardDocName, hiddenFromGuests, readElement, roots } from '@inkadra/doc-schema';
import { type BoardColumn, Id } from '@inkadra/shared';
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

/** The columns of a board document, left to right and then top to bottom. */
export function docColumns(doc: Y.Doc): BoardColumn[] {
  const columns: Array<BoardColumn & { x: number; y: number }> = [];
  for (const map of roots(doc).elements.values()) {
    if (!(map instanceof Y.Map) || map.get('type') !== 'column') continue;
    const el = readElement(map);
    if (el?.type === 'column') columns.push({ id: el.id, title: el.title, x: el.x, y: el.y });
  }
  columns.sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1));
  return columns.map(({ id, title }) => ({ id, title }));
}

/** The columns of the stored document of a board; none when it has no stored document. */
export async function storedColumns(db: Database, boardId: string): Promise<BoardColumn[]> {
  const [row] = await db
    .select({ state: boardDoc.state })
    .from(boardDoc)
    .where(eq(boardDoc.boardId, boardId));
  if (!row) return [];
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, row.state);
    return docColumns(doc);
  } finally {
    doc.destroy();
  }
}

/** Internal reader; callers must authorize the board before looking up its cards. */
export interface BoardReader {
  element(boardId: string, elementId: string): Promise<StoredElement | null>;
  columns(boardId: string): Promise<BoardColumn[]>;
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
    async columns(boardId) {
      const doc = collab.hocuspocus.documents.get(boardDocName(boardId));
      return doc ? docColumns(doc) : storedColumns(db, boardId);
    },
  };
}
