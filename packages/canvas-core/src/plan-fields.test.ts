// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, PlanElement as PlanElementSchema } from '@inkadra/doc-schema';
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
import { type PlanBase, standAlone } from './plan-variants.ts';

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
    expect(planFieldOwner(edit, 'north')).toBe(s.base);
    expect(planFieldOwner(edit, 'locationId')).toBe(s.base);
    expect(planFieldOwner(edit, 'sceneIds')).toBe(s.sera);
    expect(planFieldOwner(edit, 'sun')).toBe(s.sera);
    expect(
      planFieldWrites(edit, { voltage: 120, north: 90, variant: 'Notte', sceneIds: ['s1'] }),
    ).toEqual([
      { id: s.base, patch: { voltage: 120, north: 90 } },
      { id: s.sera, patch: { variant: 'Notte', sceneIds: ['s1'] } },
    ]);
  });

  it('writes in one transaction, removes a field set to undefined, never a list', () => {
    const s = setup();
    writePlanFields(s.doc, s.edit(), { title: 'Diner', roomSizes: false, sun: { time: 600 } });
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    writePlanFields(s.doc, s.edit(), {
      roomSizes: undefined,
      sun: { time: 720 },
      icons: [],
    } as Parameters<typeof writePlanFields>[2]);
    expect(changes).toBe(1);
    expect(planOf(s.doc, s.base).title).toBe('Diner');
    expect(planOf(s.doc, s.base).roomSizes).toBeUndefined();
    expect(planOf(s.doc, s.sera).sun).toEqual({ time: 720 });
    expect(planOf(s.doc, s.sera).title).toBeUndefined();
    expect(planOf(s.doc, s.sera).icons ?? []).toEqual([]);
  });

  it('is exactly what variantView and standAlone take from a base, the scenes aside', () => {
    // Every plain field of a plan, with a value of its own on the setup and another on the base.
    const lists = new Set(['strokes', 'shapes', 'icons', 'walls', 'openings', 'circuits']);
    const fields = Object.keys(PlanElementSchema.shape).filter(
      (k) => !lists.has(k) && !['id', 'type', 'variantOf'].includes(k),
    );
    const own = Object.fromEntries(fields.map((k) => [k, `own ${k}`]));
    const base = Object.fromEntries(fields.map((k) => [k, `base ${k}`]));
    const shown = variantView(own as unknown as PlanElement, base as unknown as PlanElement);
    const fromView = fields.filter((k) => (shown as Record<string, unknown>)[k] === base[k]);
    const alone = standAlone({}, base as unknown as PlanBase).fields as Record<string, unknown>;
    const fromAlone = fields.filter((k) => alone[k] === base[k]);
    const expected = new Set([...fromView, ...fromAlone]);
    // The scenes: a setup's own, the base's only as a fallback (decision 0117).
    expected.delete('sceneIds');
    expect([...PLAN_BASE_FIELDS].sort()).toEqual([...expected].sort());
  });
});
