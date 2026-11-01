// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, type PlanIcon, roots, STROKE_GRID } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  copyElements,
  createElement,
  duplicateElements,
  listElements,
  pasteElements,
} from './board.ts';
import { addShape, addStroke } from './film.ts';
import {
  addPlanIcon,
  duplicatePlanItems,
  iconHit,
  moveItem,
  normalizeRotation,
  PLAN_GRID,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  planItemAt,
  removePlanItems,
  rotateItem,
  snapPlanPoint,
  updatePlanItems,
} from './plan.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

function setup() {
  const doc = createBoardDoc(boardId);
  const el = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const read = () => listElements(doc).find((e) => e.id === el.id) as PlanElement;
  return { doc, id: el.id, read };
}

const camera = { kind: 'camera' as const, color: '#9DB8F2', x: 2048, y: 2048 };

describe('set plan icons', () => {
  it('places an icon and draws on the plan with the frame tools', () => {
    const { doc, id, read } = setup();
    const iconId = addPlanIcon(doc, id, { ...camera, label: 'A cam' });
    addStroke(doc, id, { tool: 'pencil', color: '#1C1C1E', width: 3, points: [0, 0, 9, 9] });
    addShape(doc, id, { kind: 'rect', color: '#1C1C1E', width: 3, x0: 1, y0: 1, x1: 90, y1: 90 });
    const plan = read();
    expect(plan.icons).toEqual([{ ...camera, label: 'A cam', id: iconId }]);
    expect(plan.strokes).toHaveLength(1);
    expect(plan.shapes).toHaveLength(1);
    expect(roots(doc).elements.get(id)?.get('icons')).toBeInstanceOf(Y.Array);
  });

  it('turns icons in steps and wraps the angle', () => {
    expect(normalizeRotation(-15)).toBe(345);
    expect(normalizeRotation(720)).toBe(0);
    const icon: PlanIcon = { ...camera, id: 'iconAAAAAAAAA' };
    expect(rotateItem(icon, 15).rotation).toBe(15);
    expect(rotateItem({ ...icon, rotation: 350 }, 15).rotation).toBe(5);
    // A full turn drops the field instead of storing 0.
    expect(rotateItem({ ...icon, rotation: 345 }, 15)).not.toHaveProperty('rotation');
  });

  it('turns lines around their middle and keeps rectangles upright', () => {
    const line = {
      id: 'shapeAAAAAAAA',
      kind: 'line' as const,
      color: '#1C1C1E',
      width: 3,
      x0: 1000,
      y0: 2048,
      x1: 3096,
      y1: 2048,
    };
    const turned = rotateItem(line, 90);
    expect(turned.x0).toBe(turned.x1);
    expect((turned.y0 + turned.y1) / 2).toBeCloseTo(2048, -1);
    // The same length on screen: the height of the drawing is shorter than its width.
    const length = (Math.abs(turned.y1 - turned.y0) / STROKE_GRID) * PLAN_VIEW_H;
    expect(length).toBeCloseTo(((3096 - 1000) / STROKE_GRID) * PLAN_VIEW_W, -1);
    const rect = { ...line, kind: 'rect' as const };
    expect(rotateItem(rect, 90)).toBe(rect);
  });

  it('moves items inside the drawing only', () => {
    const icon = { ...camera, id: 'iconAAAAAAAAA' };
    expect(moveItem(icon, { x: PLAN_VIEW_W / 4, y: 0 }).x).toBe(3072);
    expect(moveItem(icon, { x: 5000, y: -5000 })).toMatchObject({ x: STROKE_GRID, y: 0 });
  });

  it('snaps to the plan grid, the same step across and down', () => {
    const p = snapPlanPoint({ x: 0.0137, y: 0.5 });
    expect(p.x * PLAN_VIEW_W).toBeCloseTo(PLAN_GRID * 1);
    expect((p.y * PLAN_VIEW_H) % PLAN_GRID).toBeCloseTo(0);
  });

  it('hits the body of an icon but not its view cone', () => {
    const icon = { ...camera, id: 'iconAAAAAAAAA' };
    const c = { x: PLAN_VIEW_W / 2, y: PLAN_VIEW_H / 2 };
    expect(iconHit(icon, c)).toBe(true);
    expect(iconHit(icon, { x: c.x + 200, y: c.y })).toBe(false);
    // Turned 90°, it is taller than wide.
    expect(iconHit({ ...icon, rotation: 90 }, { x: c.x, y: c.y + 30 })).toBe(true);
  });

  it('finds the top item, moves it, duplicates it and removes it', () => {
    const { doc, id, read } = setup();
    const iconId = addPlanIcon(doc, id, camera) as string;
    const ref = planItemAt(read(), { x: 0.5, y: 0.5 });
    expect(ref).toEqual({ kind: 'icons', id: iconId });
    const icon = read().icons?.[0];
    if (!icon) throw new Error('no icon');
    updatePlanItems(doc, id, [{ ...rotateItem(icon, 30), label: 'A cam' }]);
    expect(read().icons?.[0]).toMatchObject({ rotation: 30, label: 'A cam' });
    updatePlanItems(doc, id, [{ ...icon }]);
    expect(read().icons?.[0]).not.toHaveProperty('label');

    const [copy] = duplicatePlanItems(doc, read(), [{ kind: 'icons', id: iconId }], {
      x: 50,
      y: 0,
    });
    expect(read().icons).toHaveLength(2);
    expect(read().icons?.[1]?.id).toBe(copy?.id);
    expect(read().icons?.[1]?.x).toBe(2048 + Math.round((50 / PLAN_VIEW_W) * STROKE_GRID));

    removePlanItems(doc, id, [iconId]);
    expect(read().icons?.map((i) => i.id)).toEqual([copy?.id]);
  });

  it('replaces a moved shape where it was, keeping the order', () => {
    const { doc, id, read } = setup();
    const shape = {
      kind: 'rect' as const,
      color: '#1C1C1E',
      width: 3,
      x0: 0,
      y0: 0,
      x1: 99,
      y1: 99,
    };
    const a = addShape(doc, id, shape) as string;
    addShape(doc, id, shape);
    const first = read().shapes?.[0];
    if (!first) throw new Error('no shape');
    updatePlanItems(doc, id, [moveItem(first, { x: 10, y: 0 })]);
    expect(read().shapes?.[0]?.id).toBe(a);
    expect(read().shapes?.[0]?.x0).toBeGreaterThan(0);
  });
});

describe('set plans on the clipboard', () => {
  it('copies, pastes and duplicates a plan with its drawing and icons', () => {
    const { doc, id, read } = setup();
    addPlanIcon(doc, id, { ...camera, label: 'A cam' });
    addStroke(doc, id, { tool: 'pencil', color: '#1C1C1E', width: 4, points: [0, 0, 9, 9] });
    const [copy] = duplicateElements(doc, [id], { x: 20, y: 20 }, { userId: null });
    const [pasted] = pasteElements(
      doc,
      copyElements(doc, [id]),
      { x: 900, y: 0 },
      { userId: null },
    );
    for (const other of [copy, pasted]) {
      const plan = listElements(doc).find((e) => e.id === other) as PlanElement;
      expect(plan.icons).toEqual(read().icons);
      expect(plan.strokes).toEqual(read().strokes);
      // Still Y.Maps, so the copies merge field by field too.
      const icons = roots(doc)
        .elements.get(other as string)
        ?.get('icons') as Y.Array<unknown>;
      expect(icons.get(0)).toBeInstanceOf(Y.Map);
    }
  });
});
