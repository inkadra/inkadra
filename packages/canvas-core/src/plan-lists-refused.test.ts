// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createElement, deleteElements, listElements } from './board.ts';
import { addShape, addStroke } from './film.ts';
import { addPlanIcon, addVariant, type PlanElement, planListsReady } from './plan.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;
const mapOf = (doc: Y.Doc, id: string) => roots(doc).elements.get(id) as Y.Map<unknown>;

describe('a client never converts or makes a plan list', () => {
  it('draws nothing on a plan whose strokes or shapes are missing or plain JSON', () => {
    const doc = createBoardDoc(boardId);
    const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    mapOf(doc, plan).delete('strokes');
    mapOf(doc, plan).set('shapes', []);
    const stroke = { tool: 'pencil' as const, color: '#1C1C1E', width: 4, points: [1, 1, 9, 9] };
    expect(addStroke(doc, plan, stroke)).toBeNull();
    expect(
      addShape(doc, plan, { kind: 'rect', color: '#1C1C1E', width: 2, x0: 1, y0: 1, x1: 9, y1: 9 }),
    ).toBeNull();
    expect(mapOf(doc, plan).has('strokes')).toBe(false);
    expect(mapOf(doc, plan).get('shapes')).toEqual([]);
    expect(planListsReady(doc, plan)).toBe(false);
  });

  it('a new setup has every list, so its base can be deleted', () => {
    const doc = createBoardDoc(boardId);
    const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    addPlanIcon(doc, base, { kind: 'sofa', color: '#1C1C1E', x: 100, y: 100 });
    const setup = addVariant(doc, planOf(doc, base), 'Sera', { userId: null });
    expect(planListsReady(doc, setup)).toBe(true);
    expect(deleteElements(doc, [base])).toEqual([]);
    expect(planOf(doc, setup).icons?.map((i) => i.kind)).toEqual(['sofa']);
  });

  it('keeps a base whose setup holds a list it may not write, and says so', () => {
    const doc = createBoardDoc(boardId);
    const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    addPlanIcon(doc, base, { kind: 'sofa', color: '#1C1C1E', x: 100, y: 100 });
    const setup = addVariant(doc, planOf(doc, base), 'Sera', { userId: null });
    mapOf(doc, setup).set('icons', []);
    expect(deleteElements(doc, [base])).toEqual([base]);
    expect(roots(doc).elements.has(base)).toBe(true);
    expect(mapOf(doc, setup).get('variantOf')).toBe(base);
    expect(mapOf(doc, setup).get('icons')).toEqual([]);
  });
});

describe('an offline client holding a board from before its lists were prepared', () => {
  it('cannot edit the old list; once synced, it edits the server list and nothing is lost', () => {
    const before = createBoardDoc(boardId);
    const plan = createElement(before, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    const lamp = { id: 'lampLegacyAAA', kind: 'fresnel', color: '#FFFFFF', x: 100, y: 100 };
    mapOf(before, plan).set('icons', [lamp]);
    // The phone has that copy; the server prepares the list (as apps/server does on load).
    const phone = new Y.Doc();
    Y.applyUpdate(phone, Y.encodeStateAsUpdate(before));
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(before));
    server.transact(() => {
      const list = new Y.Array<unknown>();
      list.push([new Y.Map(Object.entries(lamp))]);
      mapOf(server, plan).set('icons', list);
    });
    // Offline, the phone cannot edit the old list: nothing it could lose later.
    expect(addPlanIcon(phone, plan, { kind: 'chair', color: '#1C1C1E', x: 1, y: 1 })).toBeNull();
    // Synced, it edits the server's list, as does someone else: both kept.
    Y.applyUpdate(phone, Y.encodeStateAsUpdate(server));
    addPlanIcon(phone, plan, { kind: 'chair', color: '#1C1C1E', x: 1, y: 1 });
    addPlanIcon(server, plan, { kind: 'sofa', color: '#1C1C1E', x: 2, y: 2 });
    Y.applyUpdate(phone, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(phone));
    expect(
      planOf(server, plan)
        .icons?.map((i) => i.kind)
        .sort(),
    ).toEqual(['chair', 'fresnel', 'sofa']);
  });
});
