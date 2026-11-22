// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, MAX_SHAPES, MAX_STROKES, type PlanShape } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createElement, listElements } from './board.ts';
import { addPlanMark, addVariant, type PlanElement } from './plan.ts';
import { placePlanMark, planEdit } from './plan-editing.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;
const stroke = { tool: 'pencil' as const, color: '#1C1C1E', width: 4, points: [10, 10, 200, 40] };
const box = { color: '#1C1C1E', width: 4, x0: 100, y0: 100, x1: 400, y1: 300 };
const measure: Omit<PlanShape, 'id'> = { kind: 'measure', ...box };
const rect: Omit<PlanShape, 'id'> = { kind: 'rect', ...box };

function setup() {
  const doc = createBoardDoc(boardId);
  const base = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null }).id;
  const sera = addVariant(doc, planOf(doc, base), 'Sera', { userId: null });
  const edit = () => planEdit(planOf(doc, sera), planOf(doc, base));
  return { doc, base, sera, edit };
}

describe('strokes and shapes placed on a plan', () => {
  it('on a setup, a mark on Set goes to the base, one on Notes to the setup', () => {
    const s = setup();
    const line = placePlanMark(s.doc, s.edit(), 'strokes', stroke);
    expect(line?.owner).toBe(s.base);
    const dim = placePlanMark(s.doc, s.edit(), 'shapes', measure);
    expect(dim?.owner).toBe(s.sera);
    const lit = placePlanMark(s.doc, s.edit(), 'shapes', { ...rect, layer: 'lights' });
    expect(lit?.owner).toBe(s.sera);
    expect(planOf(s.doc, s.base).strokes?.map((m) => m.id)).toEqual([line?.id]);
    expect(planOf(s.doc, s.sera).shapes?.map((m) => m.id)).toEqual([dim?.id, lit?.id]);
    // The setup draws the base's line under its own marks.
    expect(s.edit().drawn.strokes?.map((m) => m.id)).toEqual([line?.id]);
  });

  it('refuses an empty mark and a full plan, and writes nothing then', () => {
    const s = setup();
    expect(placePlanMark(s.doc, s.edit(), 'strokes', { ...stroke, points: [] })).toBeNull();
    expect(
      placePlanMark(s.doc, s.edit(), 'shapes', { ...rect, kind: 'text', text: '  ' }),
    ).toBeNull();
    for (let i = 0; i < MAX_SHAPES; i++) addPlanMark(s.doc, s.sera, 'shapes', measure);
    expect(placePlanMark(s.doc, s.edit(), 'shapes', measure)).toBeNull();
    expect(planOf(s.doc, s.sera).shapes).toHaveLength(MAX_SHAPES);
    for (let i = 0; i < MAX_STROKES; i++) addPlanMark(s.doc, s.base, 'strokes', stroke);
    expect(addPlanMark(s.doc, s.base, 'strokes', stroke)).toBeNull();
    expect(planOf(s.doc, s.base).strokes).toHaveLength(MAX_STROKES);
  });

  it('is one transaction, and nothing on a card that is no plan', () => {
    const s = setup();
    let changes = 0;
    s.doc.on('afterTransaction', () => changes++);
    placePlanMark(s.doc, s.edit(), 'shapes', measure);
    expect(changes).toBe(1);
    const note = createElement(s.doc, 'note', { x: 0, y: 0 }, {}, { userId: null }).id;
    expect(addPlanMark(s.doc, note, 'strokes', stroke)).toBeNull();
  });
});
