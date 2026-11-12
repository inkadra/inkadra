// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createElement, deleteElements, listElements } from './board.ts';
import { PRODUCTION_CARD_MARK, placeProductionCard, productionCardId } from './production-card.ts';

const ROOT = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const PRODUCTION = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
const size = { w: 320, h: 260 };
const opts = { userId: null };

describe("the Production board's card on the root board (decision 0123, answer 2)", () => {
  it('is placed once, and a card someone removed does not come back', () => {
    const doc = createBoardDoc(ROOT);
    createElement(doc, 'note', { x: 0, y: 0 }, { w: 200 }, opts);
    expect(placeProductionCard(doc, PRODUCTION, size, opts)).toBe(true);
    const card = listElements(doc).find((el) => el.type === 'board');
    expect(card).toMatchObject({ id: productionCardId(PRODUCTION), boardId: PRODUCTION, x: 240 });
    expect(roots(doc).meta.get(PRODUCTION_CARD_MARK)).toBe(PRODUCTION);
    deleteElements(doc, [productionCardId(PRODUCTION)]);
    expect(placeProductionCard(doc, PRODUCTION, size, opts)).toBe(false);
    expect(listElements(doc).some((el) => el.type === 'board')).toBe(false);
  });

  it('writes the same card from two clients that place it at once', () => {
    const a = createBoardDoc(ROOT);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    placeProductionCard(a, PRODUCTION, size, opts);
    placeProductionCard(b, PRODUCTION, size, opts);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    for (const doc of [a, b])
      expect(listElements(doc).filter((el) => el.type === 'board')).toHaveLength(1);
  });

  it('only marks a root that has a card of the board already', () => {
    const doc = createBoardDoc(ROOT);
    createElement(doc, 'board', { x: 0, y: 0 }, { boardId: PRODUCTION, ...size }, opts);
    expect(placeProductionCard(doc, PRODUCTION, size, opts)).toBe(false);
    expect(listElements(doc).filter((el) => el.type === 'board')).toHaveLength(1);
    expect(roots(doc).meta.get(PRODUCTION_CARD_MARK)).toBe(PRODUCTION);
  });

  it('adds the card where the person asks for it, also after the mark', () => {
    const doc = createBoardDoc(ROOT);
    placeProductionCard(doc, PRODUCTION, size, opts);
    deleteElements(doc, [productionCardId(PRODUCTION)]);
    // The board came back from the trash, "Canvas → Produzione" adds its card here.
    expect(placeProductionCard(doc, PRODUCTION, size, opts, { x: 500, y: 80 })).toBe(true);
    expect(listElements(doc).filter((el) => el.type === 'board')).toEqual([
      expect.objectContaining({ id: productionCardId(PRODUCTION), x: 500, y: 80 }),
    ]);
    // Never a second one.
    expect(placeProductionCard(doc, PRODUCTION, size, opts, { x: 0, y: 0 })).toBe(false);
    expect(listElements(doc).filter((el) => el.type === 'board')).toHaveLength(1);
  });
});
