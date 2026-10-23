// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { arrowEnds, createArrow, exitPoint, moveArrows, refreshArrows } from './arrows.ts';
import { copyElements, createElement, listElements, pasteElements } from './board.ts';

const opts = { userId: 'u1' };

describe('arrows', () => {
  it('starts at the edge of a card, facing the other end', () => {
    const rect = { x: 0, y: 0, w: 100, h: 50 };
    expect(exitPoint(rect, { x: 300, y: 25 }, 0)).toEqual({ x: 100, y: 25 });
    expect(exitPoint(rect, { x: 50, y: -200 }, 10)).toEqual({ x: 50, y: -10 });
    expect(exitPoint(rect, { x: 60, y: 30 })).toEqual({ x: 50, y: 25 });
  });

  it('follows attached cards and keeps free points', () => {
    const rects = new Map([['card', { x: 0, y: 0, w: 100, h: 100 }]]);
    const ends = arrowEnds(
      { from: { elementId: 'card', x: 0, y: 0 }, to: { x: 400, y: 50 } },
      (id) => rects.get(id) ?? null,
    );
    expect(ends.a.x).toBeCloseTo(106);
    expect(ends.b).toEqual({ x: 400, y: 50 });
    // A deleted card: the stored point is used.
    const orphan = arrowEnds(
      { from: { elementId: 'gone', x: 10, y: 20 }, to: { x: 400, y: 50 } },
      () => null,
    );
    expect(orphan.a).toEqual({ x: 10, y: 20 });
  });

  it('stores a bounding box, refreshes it after a move and moves free ends', () => {
    const doc = createBoardDoc('b1');
    const card = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const rects = new Map([[card.id, { x: 0, y: 0, w: 100, h: 100 }]]);
    const rectOf = (id: string) => rects.get(id) ?? null;
    const arrow = createArrow(
      doc,
      { elementId: card.id, x: 50, y: 50 },
      { x: 400, y: 50 },
      rectOf,
      { label: 'Entra' },
      opts,
    );
    expect(arrow).toMatchObject({ x: 106, y: 50, w: 294, h: 1, label: 'Entra' });

    rects.set(card.id, { x: 0, y: 300, w: 100, h: 100 });
    refreshArrows(doc, [arrow], [card.id], rectOf);
    const after = listElements(doc).find((e) => e.id === arrow.id);
    expect(after).toMatchObject({ from: { elementId: card.id }, to: { x: 400, y: 50 } });
    expect(after?.y).toBe(50);
    expect(after?.h).toBeGreaterThan(200);

    if (after?.type !== 'arrow') throw new Error('arrow expected');
    moveArrows(doc, [after], 10, 20, rectOf);
    const moved = roots(doc).elements.get(arrow.id)?.get('to');
    expect(moved).toEqual({ x: 410, y: 70 });
    expect(roots(doc).elements.get(arrow.id)?.get('from')).toMatchObject({ elementId: card.id });
  });

  it('pastes arrows attached to the copies of the cards copied with them', () => {
    const doc = createBoardDoc('b1');
    const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const b = createElement(doc, 'note', { x: 400, y: 0 }, {}, opts);
    const arrow = createArrow(
      doc,
      { elementId: a.id, x: 120, y: 30 },
      { elementId: b.id, x: 400, y: 30 },
      () => null,
      {},
      opts,
    );
    const pasted = pasteElements(doc, copyElements(doc, [a.id, arrow.id]), { x: 1000, y: 0 }, opts);
    const copy = listElements(doc).find((e) => e.type === 'arrow' && pasted.includes(e.id));
    if (copy?.type !== 'arrow') throw new Error('arrow expected');
    expect(copy.from.elementId).not.toBe(a.id);
    expect(pasted).toContain(copy.from.elementId);
    expect(copy.to.elementId).toBe(b.id);
  });
});
