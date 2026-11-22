// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createElement, listElements } from './board.ts';
import { addVariant, type PlanElement, variantView } from './plan.ts';
import { planEdit } from './plan-editing.ts';
import {
  PLAN_BASE_FIELDS,
  planFieldOwner,
  planFieldWrites,
  writePlanFields,
} from './plan-fields.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;

function setup() {
  const doc = createBoardDoc(boardId);
  const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
  const sera = addVariant(doc, planOf(doc, base), 'Sera', { userId: null });
  const edit = () => planEdit(planOf(doc, sera), planOf(doc, base));
  return { doc, base, sera, edit };
}

describe('where a field of the plan is written', () => {
  it('on a base, every field is the plan edited', () => {
    const { doc, base } = setup();
    const edit = planEdit(planOf(doc, base));
    expect(planFieldOwner(edit, 'voltage')).toBe(base);
    expect(planFieldOwner(edit, 'north')).toBe(base);
  });

  it("on a setup, the base's fields go to the base, the rest to the setup", () => {
    const s = setup();
    const edit = s.edit();
    for (const field of PLAN_BASE_FIELDS) expect(planFieldOwner(edit, field)).toBe(s.base);
    expect(planFieldOwner(edit, 'variant')).toBe(s.sera);
    expect(planFieldOwner(edit, 'north')).toBe(s.sera);
    expect(planFieldOwner(edit, 'sun')).toBe(s.sera);
    expect(planFieldWrites(edit, { voltage: 120, variant: 'Notte', north: 90 })).toEqual([
      { id: s.base, patch: { voltage: 120 } },
      { id: s.sera, patch: { variant: 'Notte', north: 90 } },
    ]);
  });

  it('writes in one transaction, removes a field set to undefined, never a list', () => {
    const s = setup();
    writePlanFields(s.doc, s.edit(), { title: 'Diner', roomSizes: false, north: 45 });
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    writePlanFields(s.doc, s.edit(), {
      roomSizes: undefined,
      north: 90,
      icons: [],
    } as Parameters<typeof writePlanFields>[2]);
    expect(changes).toBe(1);
    expect(planOf(s.doc, s.base).title).toBe('Diner');
    expect(planOf(s.doc, s.base).roomSizes).toBeUndefined();
    expect(planOf(s.doc, s.sera).north).toBe(90);
    expect(planOf(s.doc, s.sera).title).toBeUndefined();
    expect(planOf(s.doc, s.sera).icons ?? []).toEqual([]);
  });

  it('agrees with what a setup shows from its base', () => {
    const s = setup();
    writePlanFields(s.doc, planEdit(planOf(s.doc, s.base)), {
      title: 'Diner',
      scale: 50,
      grid: '0.5',
      rulers: true,
      roomSizes: false,
      voltage: 120,
      background: { assetId: 'a1' },
    });
    const shown = variantView(planOf(s.doc, s.sera), planOf(s.doc, s.base));
    for (const field of PLAN_BASE_FIELDS)
      expect(shown[field as keyof typeof shown]).toEqual(planOf(s.doc, s.base)[field]);
  });
});
