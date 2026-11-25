// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createElement, listElements } from './board.ts';
import { addPlanIcon, addVariant, type PlanElement, updatePlanItems } from './plan.ts';
import { planEdit } from './plan-editing.ts';
import { sunToRepair, sunTurns, writePlanSun } from './plan-sun.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;
const iconOf = (doc: Y.Doc, plan: string, id: string) =>
  planOf(doc, plan).icons?.find((i) => i.id === id);
const SUN = { kind: 'sun', color: '#FFD60A' } as const;

function setup() {
  const doc = createBoardDoc(boardId);
  const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
  const table = addPlanIcon(doc, base, { kind: 'table', color: '#1C1C1E', x: 900, y: 900 })!;
  // A sun put on the base's Set, shared by its setups; then, once the setup is made, the base's
  // own sun (on its lights), which the setup does not show.
  const setSun = addPlanIcon(doc, base, { ...SUN, x: 70, y: 70, layer: 'set' })!;
  const sera = addVariant(doc, planOf(doc, base), 'Sera', { userId: null });
  const baseSun = addPlanIcon(doc, base, { ...SUN, x: 50, y: 50 })!;
  const sun = addPlanIcon(doc, sera, { ...SUN, x: 100, y: 100 })!;
  const edit = () => planEdit(planOf(doc, sera), planOf(doc, base));
  return { doc, base, sera, sun, baseSun, setSun, table, edit };
}

describe('the sun of a set plan', () => {
  it('a new time turns the sun icons with it: one transaction, one Undo step', () => {
    const s = setup();
    const undo = new Y.UndoManager(roots(s.doc).elements, { trackedOrigins: new Set(['me']) });
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    const turned = writePlanSun(s.doc, s.edit(), { sun: { time: 600 } }, 135, 'me');
    expect(changes).toBe(1);
    expect(turned?.sort()).toEqual([s.sun, s.setSun].sort());
    expect(planOf(s.doc, s.sera).sun).toEqual({ time: 600 });
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBe(135);
    // The Set's sun is the base's, turned there; the base's own sun is not this setup's.
    expect(iconOf(s.doc, s.base, s.setSun)?.rotation).toBe(135);
    expect(iconOf(s.doc, s.base, s.baseSun)?.rotation).toBeUndefined();
    expect(iconOf(s.doc, s.base, s.table)?.rotation).toBeUndefined();
    expect(undo.undoStack).toHaveLength(1);
    undo.undo();
    expect(planOf(s.doc, s.sera).sun).toBeUndefined();
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBeUndefined();
  });

  it("north goes to the base, the setup's sun icons turn with it; on a base, its own", () => {
    const s = setup();
    writePlanSun(s.doc, s.edit(), { north: 90 }, 225);
    expect(planOf(s.doc, s.base).north).toBe(90);
    expect(planOf(s.doc, s.sera).north).toBeUndefined();
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBe(225);
    writePlanSun(s.doc, planEdit(planOf(s.doc, s.base)), { sun: { time: 300 } }, 45);
    expect(planOf(s.doc, s.base).sun).toEqual({ time: 300 });
    expect(iconOf(s.doc, s.base, s.baseSun)?.rotation).toBe(45);
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBe(225);
  });

  it('M1: a rotation is brought to 0..359, 0 is no rotation, none that is no number', () => {
    const s = setup();
    writePlanSun(s.doc, s.edit(), {}, 360);
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBeUndefined();
    expect(sunTurns(s.edit(), 0)).toEqual([]);
    expect(sunTurns(s.edit(), 720)).toEqual([]);
    writePlanSun(s.doc, s.edit(), {}, -15);
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBe(345);
    writePlanSun(s.doc, s.edit(), {}, 90.4);
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBe(90);
    // Turned back to 0: no rotation stored, as a turned item has none at 0.
    writePlanSun(s.doc, s.edit(), {}, 360);
    expect(iconOf(s.doc, s.sera, s.sun)).not.toHaveProperty('rotation');
    writePlanSun(s.doc, s.edit(), {}, 90.4);
    expect(sunTurns(s.edit(), Number.NaN)).toEqual([]);
    expect(writePlanSun(s.doc, s.edit(), {}, Number.NaN)).toEqual([]);
    expect(iconOf(s.doc, s.sera, s.sun)?.rotation).toBe(90);
  });

  it('M2: the layers locked are the plan edited’s, and the base’s for what the base holds', () => {
    const s = setup();
    const edit = s.edit();
    const ofBase = planEdit(edit.plan, { ...edit.base!, lockedLayers: ['lights', 'set'] });
    expect(sunTurns(ofBase, 180).map((i) => i.id)).toEqual([s.sun]);
    const ofSetup = planEdit({ ...edit.plan, lockedLayers: ['lights'] }, edit.base);
    expect(sunTurns(ofSetup, 180).map((i) => i.id)).toEqual([s.setSun]);
    const own = planEdit(
      { ...edit.plan, icons: edit.plan.icons?.map((i) => ({ ...i, locked: true })) },
      edit.base,
    );
    expect(sunTurns(own, 180).map((i) => i.id)).toEqual([s.setSun]);
  });

  it('one already turned so is not written; nothing to write writes nothing', () => {
    const s = setup();
    writePlanSun(s.doc, s.edit(), {}, 90);
    expect(sunTurns(s.edit(), 90)).toEqual([]);
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    expect(writePlanSun(s.doc, s.edit(), {}, 90)).toEqual([]);
    expect(changes).toBe(0);
  });

  it('a label someone changed meanwhile stays: only the rotation is written', () => {
    const s = setup();
    const edit = s.edit();
    const now = iconOf(s.doc, s.sera, s.sun)!;
    updatePlanItems(s.doc, s.sera, [{ ...now, label: 'Afternoon' }]);
    writePlanSun(s.doc, edit, {}, 200);
    expect(iconOf(s.doc, s.sera, s.sun)).toMatchObject({ label: 'Afternoon', rotation: 200 });
  });

  it('a modifier on a sun settles with it, keeping a label a colleague gave it meanwhile', () => {
    const s = setup();
    const scrim = addPlanIcon(s.doc, s.sera, {
      kind: 'scrim',
      color: '#FFFFFF',
      x: 100,
      y: 100,
      on: s.sun,
    })!;
    const edit = s.edit();
    const before = iconOf(s.doc, s.sera, scrim)!;
    updatePlanItems(s.doc, s.sera, [{ ...before, label: 'Half' }]);
    writePlanSun(s.doc, edit, {}, 90);
    const after = iconOf(s.doc, s.sera, scrim)!;
    expect(after.label).toBe('Half');
    expect(after.on).toBe(s.sun);
    expect(after.rotation).toBe(90);
  });

  it('S2, S3: north or a sun that does not read, or a list no client may write: nothing written', () => {
    const s = setup();
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    expect(writePlanSun(s.doc, s.edit(), { north: Number.NaN }, 90)).toBeNull();
    expect(writePlanSun(s.doc, s.edit(), { sun: { time: 2000 } }, 90)).toBeNull();
    expect(
      writePlanSun(s.doc, s.edit(), { sun: { time: 600, date: '1 Dec' } } as never, 90),
    ).toBeNull();
    expect(changes).toBe(0);
    writePlanSun(s.doc, s.edit(), { north: 450 }, 90);
    expect(planOf(s.doc, s.base).north).toBe(90);
    const edit = s.edit();
    roots(s.doc).elements.get(s.sera)?.set('shapes', []);
    changes = 0;
    expect(writePlanSun(s.doc, edit, { sun: { time: 700 } }, 10)).toBeNull();
    // North alone, no icon to turn: it goes to the base, but the plan edited is checked too.
    expect(writePlanSun(s.doc, s.edit(), { north: 30 }, 90)).toBeNull();
    expect(changes).toBe(0);
  });

  it('the date to repair follows the day; none while the days are unread, the day gone or right', () => {
    const day = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
    const sun = { time: 600, day, date: '2026-12-01' };
    expect(sunToRepair(sun, '2026-12-03')).toEqual({ time: 600, day, date: '2026-12-03' });
    expect(sunToRepair({ time: 600, day }, '2026-12-03')).toEqual({
      time: 600,
      day,
      date: '2026-12-03',
    });
    expect(sunToRepair(sun, '2026-12-01')).toBeNull();
    expect(sunToRepair(sun, undefined)).toBeNull();
    expect(sunToRepair(sun, null)).toBeNull();
    expect(sunToRepair(sun, '3 Dec')).toBeNull();
    expect(sunToRepair(undefined, '2026-12-03')).toBeNull();
    expect(sunToRepair({ time: 600, date: '2026-12-01' }, '2026-12-03')).toBeNull();
  });
});
