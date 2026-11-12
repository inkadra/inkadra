// SPDX-License-Identifier: MPL-2.0
import { addElement, type Element, roots } from '@inkadra/doc-schema';
import type * as Y from 'yjs';
import { canvasElements, currentElements, keyAtEnd } from './board.ts';

/** The key of the root board's `meta` that says the Production board's card was placed. */
export const PRODUCTION_CARD_MARK = 'productionCard';

/** The id of the Production board's card on the root board: the same on every client. */
export const productionCardId = (boardId: string) => `production-${boardId}`;

/**
 * The card of a project's Production board on its root board (decision 0123, answer 2): placed
 * once, by the client of the first editor who opens the root board, with an id derived from the
 * board's and at a place read from the document, so two clients write the same card; then a
 * mark in the root's `meta`, so a card someone removed does not come back. A card of the board
 * already on the canvas gets the mark only. Returns whether it placed the card.
 */
export function placeProductionCard(
  doc: Y.Doc,
  boardId: string,
  size: { w: number; h: number },
  opts: { userId: string | null; origin?: unknown },
  /** Where the person asked for it, from the Canvas menu; else beside the other cards. */
  at?: { x: number; y: number },
): boolean {
  const { meta } = roots(doc);
  if (meta.get(PRODUCTION_CARD_MARK) === boardId) return false;
  const elements = currentElements(doc);
  const placed = elements.some((el) => el.type === 'board' && el.boardId === boardId);
  const onCanvas = canvasElements(elements);
  // To the right of everything on the canvas, level with its top.
  const x = at?.x ?? (onCanvas.length ? Math.max(...onCanvas.map((el) => el.x + el.w)) + 40 : 0);
  const y = at?.y ?? (onCanvas.length ? Math.min(...onCanvas.map((el) => el.y)) : 0);
  doc.transact(() => {
    if (!placed)
      addElement(doc, {
        id: productionCardId(boardId),
        type: 'board',
        boardId,
        x: Math.round(x),
        y: Math.round(y),
        w: size.w,
        h: size.h,
        z: keyAtEnd(elements, null),
        parent: null,
        createdBy: opts.userId,
        createdAt: Date.now(),
      } as Element);
    meta.set(PRODUCTION_CARD_MARK, boardId);
  }, opts.origin);
  return !placed;
}
