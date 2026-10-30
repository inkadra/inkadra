// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import {
  arrowBox,
  arrowEnds,
  arrowGeometry,
  arrowPathData,
  arrowPolyline,
  createArrow,
  curveControl,
  exitPoint,
  moveArrows,
  refreshArrows,
  setArrowPath,
} from './arrows.ts';
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

describe('curved arrows', () => {
  it('bows to the left of the direction, by a bounded share of the length', () => {
    expect(curveControl({ x: 0, y: 0 }, { x: 100, y: 0 }, undefined)).toBeNull();
    expect(curveControl({ x: 0, y: 0 }, { x: 100, y: 0 }, 'straight')).toBeNull();
    const c = curveControl({ x: 0, y: 0 }, { x: 100, y: 0 }, 'curved')!;
    expect(c.x).toBeCloseTo(50);
    expect(c.y).toBeCloseTo(-36);
    // Long arrows bow by at most MAX_CURVE_BOW at their middle.
    expect(curveControl({ x: 0, y: 0 }, { x: 5000, y: 0 }, 'curved')!.y).toBeCloseTo(-320);
    // Reversed arrows bow the other way.
    expect(curveControl({ x: 100, y: 0 }, { x: 0, y: 0 }, 'curved')!.y).toBeCloseTo(36);
  });

  it('puts the label on the middle of the curve and leaves cards facing the bow', () => {
    const rects = new Map([
      ['marta', { x: 0, y: 0, w: 100, h: 100 }],
      ['leo', { x: 400, y: 0, w: 100, h: 100 }],
    ]);
    const rectOf = (id: string) => rects.get(id) ?? null;
    const arrow = {
      from: { elementId: 'marta', x: 0, y: 0 },
      to: { elementId: 'leo', x: 0, y: 0 },
    };
    const straight = arrowGeometry(arrow, rectOf);
    expect(straight.c).toBeNull();
    expect(straight.mid).toEqual({ x: 250, y: 50 });
    const curved = arrowGeometry({ ...arrow, path: 'curved' }, rectOf);
    expect(curved.mid.x).toBeCloseTo(250);
    expect(curved.mid.y).toBeLessThan(0);
    // Both ends leave their card upwards-ish, toward the control point.
    expect(curved.a.y).toBeLessThan(50);
    expect(curved.b.y).toBeLessThan(50);
    expect(arrowPathData(curved)).toMatch(/^M[\d.-]+ [\d.-]+Q/);
    expect(arrowPathData(straight)).toMatch(/^M[\d.-]+ [\d.-]+L/);
    const line = arrowPolyline(curved, 10);
    expect(line).toHaveLength(11);
    expect(line[0]).toEqual(curved.a);
    expect(line[10]!.x).toBeCloseTo(curved.b.x);
    expect(line[5]!.y).toBeCloseTo(curved.mid.y);
    expect(arrowBox(curved).y).toBeCloseTo(curved.mid.y);
  });

  it('switches path, keeping the box around the curve', () => {
    const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
    const arrow = createArrow(doc, { x: 0, y: 0 }, { x: 200, y: 0 }, () => null, {}, opts);
    expect(arrow.h).toBe(1);
    setArrowPath(doc, [arrow], 'curved', () => null);
    const map = roots(doc).elements.get(arrow.id)!;
    expect(map.get('path')).toBe('curved');
    expect(map.get('y')).toBeLessThan(-30);
    setArrowPath(doc, [{ ...arrow, path: 'curved' }], undefined, () => null);
    expect(map.has('path')).toBe(false);
    expect(map.get('h')).toBe(1);
    expect(arrowEnds({ ...arrow, path: 'curved' }, () => null).b).toEqual({ x: 200, y: 0 });
  });
});
