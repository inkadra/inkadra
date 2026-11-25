// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createElement, listElements } from './board.ts';
import { addPlanIcon, addVariant, type PlanElement } from './plan.ts';
import { planEdit } from './plan-editing.ts';
import { sunToRepair, sunTurns, writePlanSun } from './plan-sun.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;
const iconOf = (doc: Y.Doc, plan: string, id: string) =>
  planOf(doc, plan).icons?.find((i) => i.id === id);

function setup() {
  const doc = createBoardDoc(boardId);
  const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
  const table = addPlanIcon(doc, base, { kind: 'table', color: '#1C1C1E', x: 900, y: 900 })!;
  const sera = addVariant(doc, planOf(doc, base), 'Sera', { userId: null });
  const sun = addPlanIcon(doc, sera, { kind: 'sun', color: '#FFD60A', x: 100, y: 100 })!;
  const edit = () => planEdit(planOf(doc, sera), planOf(doc, base));
  return { doc, base, sera, sun, table, edit };
}

describe('the sun of a set plan', () => {
  it('a new time turns the sun icons with it, in one transaction', () => {
    const s = setup();
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    const turned = writePlanSun(s.doc, s.edit(), { sun: { time: 600 } }, 135, 'me');
    expect(changes).toBe(1);
    expect(turned).toEqual([s.sun]);
    expect(planOf(s.doc, s.sera).sun).toEqual({ time: 600 });
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBe(135);
    // Never anything else: the table is as it was.
    expect(iconOf(s.doc, s.base, s.table)?.rotation).toBeUndefined();
  });

  it("north goes to the base, the setup's sun icons turn with it", () => {
    const s = setup();
    writePlanSun(s.doc, s.edit(), { north: 90 }, 225);
    expect(planOf(s.doc, s.base).north).toBe(90);
    expect(planOf(s.doc, s.sera).north).toBeUndefined();
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBe(225);
  });

  it('a sun icon locked, or on a locked layer, stays; one already turned so is not written', () => {
    const s = setup();
    writePlanSun(s.doc, s.edit(), {}, 90);
    expect(sunTurns(s.edit(), 90)).toEqual([]);
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    expect(writePlanSun(s.doc, s.edit(), {}, 90)).toEqual([]);
    expect(changes).toBe(0);
    const edit = s.edit();
    const lights = planEdit({ ...edit.plan, lockedLayers: ['lights'] }, edit.base);
    expect(sunTurns(lights, 180)).toEqual([]);
    const own = planEdit(
      { ...edit.plan, icons: edit.plan.icons?.map((i) => ({ ...i, locked: true })) },
      edit.base,
    );
    expect(sunTurns(own, 180)).toEqual([]);
  });

  it('the date to repair follows the day; none while the days are unread, the day gone or right', () => {
    const day = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
    const sun = { time: 600, day, date: '2026-12-01' };
    expect(sunToRepair(sun, '2026-12-03')).toEqual({ time: 600, day, date: '2026-12-03' });
    expect(sunToRepair(sun, '2026-12-01')).toBeNull();
    expect(sunToRepair(sun, undefined)).toBeNull();
    expect(sunToRepair(sun, null)).toBeNull();
    expect(sunToRepair({ time: 600, date: '2026-12-01' }, '2026-12-03')).toBeNull();
  });
});
