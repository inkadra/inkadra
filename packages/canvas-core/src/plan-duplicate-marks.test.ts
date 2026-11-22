// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, type PlanShape } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createElement, listElements } from './board.ts';
import { addPlanMark, type PlanElement, updatePlanItems } from './plan.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;
const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};
const storedShapes = (doc: Y.Doc, id: string) =>
  (
    (doc.getMap('elements').get(id) as Y.Map<unknown> | undefined)?.get('shapes') as
      | Y.Array<PlanShape>
      | undefined
  )?.toArray() ?? [];

describe('a text two people change at the same time', () => {
  it('reads as one shape, and the next write leaves one', () => {
    const a = createBoardDoc(boardId);
    const plan = createElement(a, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    const text = addPlanMark(a, plan, 'shapes', {
      kind: 'text',
      color: '#1C1C1E',
      width: 2,
      x0: 10,
      y0: 10,
      x1: 200,
      y1: 40,
      text: 'Exit',
    }) as string;
    const b = new Y.Doc();
    sync(a, b);
    const shape = planOf(a, plan).shapes!.find((s) => s.id === text)!;
    updatePlanItems(a, plan, [{ ...shape, text: 'Exit A' }]);
    updatePlanItems(b, plan, [{ ...shape, text: 'Exit B' }]);
    sync(a, b);
    // Two copies are stored; one is read, the same on both sides.
    expect(storedShapes(a, plan).filter((s) => s.id === text)).toHaveLength(2);
    const read = planOf(a, plan).shapes!.filter((s) => s.id === text);
    expect(read).toHaveLength(1);
    expect(planOf(b, plan).shapes).toEqual(planOf(a, plan).shapes);
    // The next change writes the one read and removes the other.
    updatePlanItems(a, plan, [{ ...read[0]!, text: 'Way out' }]);
    expect(
      storedShapes(a, plan)
        .filter((s) => s.id === text)
        .map((s) => s.text),
    ).toEqual(['Way out']);
  });
});
