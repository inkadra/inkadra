// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createElement, listElements } from './board.ts';
import { addPlanIcon, addPlanMark, type PlanElement, updatePlanItems } from './plan.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;

/** A plan whose lists an older writer left as plain JSON. */
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
    map.set('strokes', [line]);
  });
  return { doc, id, lamp, line };
}

describe('a plan list left as plain JSON', () => {
  it('keeps its items when an icon or a mark is added', () => {
    const { doc, id, lamp, line } = legacy();
    const chair = addPlanIcon(doc, id, { kind: 'chair', color: '#1C1C1E', x: 300, y: 300 });
    const pen = addPlanMark(doc, id, 'strokes', {
      tool: 'pencil',
      color: '#1C1C1E',
      width: 4,
      points: [2, 2, 8, 8],
    });
    expect(planOf(doc, id).icons?.map((i) => i.id)).toEqual([lamp.id, chair]);
    expect(planOf(doc, id).strokes?.map((s) => s.id)).toEqual([line.id, pen]);
    // The icons are Y.Maps now, so two people can change different fields of one.
    const icons = (roots(doc).elements.get(id) as Y.Map<unknown>).get('icons') as Y.Array<unknown>;
    expect(icons.toArray().every((i) => i instanceof Y.Map)).toBe(true);
  });

  it('keeps its items when one of them is changed', () => {
    const { doc, id, lamp } = legacy();
    updatePlanItems(doc, id, [{ ...lamp, label: 'Key' } as never]);
    expect(planOf(doc, id).icons).toEqual([{ ...lamp, label: 'Key' }]);
  });
});
