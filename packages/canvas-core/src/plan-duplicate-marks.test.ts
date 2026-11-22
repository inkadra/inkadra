// SPDX-License-Identifier: MPL-2.0
import { checkCard, createBoardDoc, MAX_SHAPES, type PlanShape, roots } from '@inkadra/doc-schema';
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
    // The card is still one this build knows: its copies are no hidden item, so it stays editable.
    expect(checkCard(roots(a).elements.get(plan) as Y.Map<unknown>).status).toBe('known');
    // The next change writes the one read and removes the other.
    updatePlanItems(a, plan, [{ ...read[0]!, text: 'Way out' }]);
    expect(
      storedShapes(a, plan)
        .filter((s) => s.id === text)
        .map((s) => s.text),
    ).toEqual(['Way out']);
  });

  it('a shape that does not read, with no copy that does, still makes the card unknown', () => {
    const doc = createBoardDoc(boardId);
    const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    const shapes = (roots(doc).elements.get(plan) as Y.Map<unknown>).get(
      'shapes',
    ) as Y.Array<unknown>;
    shapes.push([
      {
        id: 'from-a-newer-build',
        kind: 'cloud',
        color: '#1C1C1E',
        width: 2,
        x0: 1,
        y0: 1,
        x1: 2,
        y1: 2,
      },
    ]);
    expect(checkCard(roots(doc).elements.get(plan) as Y.Map<unknown>).status).toBe('foreign');
  });

  it('at the limit, the copy read is the copy written: a move keeps the text shown', () => {
    const doc = createBoardDoc(boardId);
    const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    const shapes = (roots(doc).elements.get(plan) as Y.Map<unknown>).get(
      'shapes',
    ) as Y.Array<unknown>;
    const box = { kind: 'rect', color: '#1C1C1E', width: 2, x0: 1, y0: 1, x1: 9, y1: 9 };
    const text = { kind: 'text', color: '#1C1C1E', width: 2, x0: 10, y0: 10, x1: 90, y1: 30 };
    doc.transact(() => {
      shapes.push(
        Array.from({ length: MAX_SHAPES - 1 }, (_, i) => ({
          ...box,
          id: `box-${String(i).padStart(6, '0')}`,
        })),
      );
      // Two copies of one text, the second past the limit as stored.
      shapes.push([
        { ...text, id: 'text-twice-01', text: 'Exit A' },
        { ...text, id: 'text-twice-01', text: 'Exit B' },
      ]);
    });
    const shown = planOf(doc, plan).shapes ?? [];
    expect(shown).toHaveLength(MAX_SHAPES);
    const visible = shown.find((s) => s.id === 'text-twice-01') as PlanShape;
    // A move only: the text shown stays.
    updatePlanItems(doc, plan, [{ ...visible, x0: 200, x1: 280 }], undefined, [visible]);
    const after = storedShapes(doc, plan).filter((s) => s.id === 'text-twice-01');
    expect(after.map((s) => [s.text, s.x0])).toEqual([[visible.text, 200]]);
  });
});
