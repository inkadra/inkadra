// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createElement } from './board.ts';
import {
  addPlanIcon,
  addPlanMark,
  duplicatePlanItems,
  type PlanElement,
  removePlanItems,
  updatePlanItems,
} from './plan.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

/** A plan whose icons an older writer left as plain JSON, its strokes a Y.Array. */
function legacy() {
  const doc = createBoardDoc(boardId);
  const id = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
  const map = roots(doc).elements.get(id) as Y.Map<unknown>;
  const lamp = { id: 'old-lamp-0001', kind: 'fresnel', color: '#FFFFFF', x: 100, y: 100 };
  const line = {
    id: 'old-line-0001',
    tool: 'pencil',
    color: '#1C1C1E',
    width: 4,
    points: [1, 1, 9, 9],
  };
  doc.transact(() => {
    map.set('icons', [lamp]);
    (map.get('strokes') as Y.Array<unknown>).push([line]);
  });
  return { doc, id, map, lamp, line };
}

describe('a plan list left as plain JSON', () => {
  it('is never replaced or converted: a write on it is refused and changes nothing', () => {
    const { doc, id, map, lamp, line } = legacy();
    let changes = 0;
    doc.on('afterTransaction', () => changes++);
    expect(addPlanIcon(doc, id, { kind: 'chair', color: '#1C1C1E', x: 300, y: 300 })).toBeNull();
    updatePlanItems(doc, id, [
      { ...lamp, label: 'Key' } as never,
      { ...line, points: [2, 2, 8, 8] } as never,
    ]);
    removePlanItems(doc, id, [line.id]);
    expect(
      duplicatePlanItems(
        doc,
        { id, icons: [] } as unknown as PlanElement,
        [{ kind: 'strokes', id: line.id }],
        { x: 5, y: 5 },
      ),
    ).toEqual([]);
    // No change at all, not even half of one: the JSON list and the Y.Array as they were.
    expect(map.get('icons')).toEqual([lamp]);
    expect((map.get('strokes') as Y.Array<unknown>).toArray()).toEqual([line]);
    expect(changes).toBeLessThanOrEqual(1);
  });

  it('a list that is missing is still made when something is added to it', () => {
    const doc = createBoardDoc(boardId);
    const id = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    (roots(doc).elements.get(id) as Y.Map<unknown>).delete('shapes');
    const mark = addPlanMark(doc, id, 'shapes', {
      kind: 'rect',
      color: '#1C1C1E',
      width: 2,
      x0: 1,
      y0: 1,
      x1: 9,
      y1: 9,
    });
    expect(mark).not.toBeNull();
  });
});
