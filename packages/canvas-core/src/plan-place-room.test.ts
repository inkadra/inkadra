// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, MAX_PLAN_ICONS, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createElement, deleteElements, listElements } from './board.ts';
import { addPlanIcon, addVariant, type PlanElement } from './plan.ts';
import { placePlanIcon, planEdit } from './plan-editing.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const white = { color: () => '#FFFFFF' };
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;
const fill = (doc: Y.Doc, id: string, upTo: number) => {
  for (let i = planOf(doc, id).icons?.length ?? 0; i < upTo; i++)
    addPlanIcon(doc, id, { kind: 'fresnel', color: '#FFFFFF', x: 10 + i, y: 10 });
};

function setup() {
  const doc = createBoardDoc(boardId);
  const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
  const sera = addVariant(doc, planOf(doc, base), 'Sera', { userId: null });
  const edit = () => planEdit(planOf(doc, sera), planOf(doc, base));
  return { doc, base, sera, edit };
}

describe('placing an icon: the plan it goes to, and its room', () => {
  it('counts the room on the plan the icon goes to', () => {
    const s = setup();
    fill(s.doc, s.sera, MAX_PLAN_ICONS);
    // The setup is full, but a sofa goes on Set, the base's.
    const sofa = placePlanIcon(s.doc, s.edit(), 'sofa', { x: 0.5, y: 0.5 }, white);
    expect(sofa).not.toBeNull();
    expect(planOf(s.doc, s.base).icons?.map((i) => i.id)).toContain(sofa);
    expect(placePlanIcon(s.doc, s.edit(), 'fresnel', { x: 0.5, y: 0.5 }, white)).toBeNull();
  });

  it('places a kit whole or not at all', () => {
    const s = setup();
    fill(s.doc, s.sera, MAX_PLAN_ICONS - 1);
    const kit = { ...white, modifiers: ['softbox' as const] };
    expect(placePlanIcon(s.doc, s.edit(), 'fresnel', { x: 0.5, y: 0.5 }, kit)).toBeNull();
    expect(planOf(s.doc, s.sera).icons).toHaveLength(MAX_PLAN_ICONS - 1);
  });

  it("follows the icon's layer given in its fields", () => {
    const s = setup();
    const lamp = placePlanIcon(
      s.doc,
      s.edit(),
      'fresnel',
      { x: 0.3, y: 0.3 },
      {
        ...white,
        fields: { layer: 'set' },
      },
    );
    expect(planOf(s.doc, s.base).icons?.find((i) => i.id === lamp)?.layer).toBe('set');
    expect(planOf(s.doc, s.sera).icons?.map((i) => i.id) ?? []).not.toContain(lamp);
  });
});

describe('placing an icon with a PlanEdit older than the board', () => {
  it('writes nothing when a plan an icon of the kit goes to is gone', () => {
    const s = setup();
    const stale = s.edit();
    deleteElements(s.doc, [s.sera]);
    const before = planOf(s.doc, s.base).icons?.length ?? 0;
    // The light goes to the base's Set, its softbox to the setup deleted since.
    const id = placePlanIcon(
      s.doc,
      stale,
      'fresnel',
      { x: 0.5, y: 0.5 },
      {
        ...white,
        fields: { layer: 'set' },
        modifiers: ['softbox'],
      },
    );
    expect(id).toBeNull();
    expect(planOf(s.doc, s.base).icons?.length ?? 0).toBe(before);
  });

  it('keeps the layer that chose the plan when the fields give none', () => {
    const s = setup();
    const lamp = placePlanIcon(
      s.doc,
      s.edit(),
      'fresnel',
      { x: 0.3, y: 0.3 },
      {
        ...white,
        layer: 'set',
        fields: { layer: undefined },
      },
    );
    expect(planOf(s.doc, s.base).icons?.find((i) => i.id === lamp)?.layer).toBe('set');
  });
});

describe('placing an icon on a plan whose icons are plain JSON', () => {
  it('refuses before writing anything, even from a full setup', () => {
    const s = setup();
    fill(s.doc, s.sera, MAX_PLAN_ICONS);
    const old = { id: 'old-sofa-0001', kind: 'sofa', color: '#1C1C1E', x: 100, y: 100 };
    const baseMap = roots(s.doc).elements.get(s.base) as Y.Map<unknown>;
    baseMap.set('icons', [old]);
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    expect(placePlanIcon(s.doc, s.edit(), 'sofa', { x: 0.5, y: 0.5 }, white)).toBeNull();
    expect(changes).toBe(0);
    expect(baseMap.get('icons')).toEqual([old]);
  });
});

describe('placing a kit on a plan whose shapes are plain JSON', () => {
  it('refuses before writing anything: the attachment would write the shapes too', () => {
    const doc = createBoardDoc(boardId);
    const plan = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
    const map = roots(doc).elements.get(plan) as Y.Map<unknown>;
    const old = {
      id: 'old-text-0001',
      kind: 'text',
      color: '#1C1C1E',
      width: 2,
      x0: 1,
      y0: 1,
      x1: 9,
      y1: 9,
      text: 'Exit',
    };
    map.set('shapes', [old]);
    let changes = 0;
    doc.on('afterTransaction', () => changes++);
    const id = placePlanIcon(
      doc,
      planEdit(planOf(doc, plan)),
      'fresnel',
      { x: 0.5, y: 0.5 },
      {
        ...white,
        modifiers: ['softbox'],
      },
    );
    expect(id).toBeNull();
    expect(changes).toBe(0);
    expect((map.get('icons') as Y.Array<unknown>).length).toBe(0);
    expect(map.get('shapes')).toEqual([old]);
  });
});
