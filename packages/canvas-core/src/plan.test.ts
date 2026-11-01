// SPDX-License-Identifier: MPL-2.0
import {
  createBoardDoc,
  PLAN_ICON_KINDS,
  type PlanIcon,
  roots,
  STROKE_GRID,
} from '@inkadra/doc-schema';
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
  addBlockingStep,
  addPlanIcon,
  addVariant,
  alignItems,
  bendThrough,
  blockingCurve,
  blockingPositions,
  duplicatePlanItems,
  gridLength,
  iconCone,
  iconHit,
  iconSize,
  itemsInRect,
  layerCounts,
  layerOf,
  lensAngle,
  measureEnds,
  moveItem,
  normalizeRotation,
  PLAN_GRID,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  planItemAt,
  removePlanItems,
  resizeItem,
  rotateItem,
  SYMBOL_SIZES,
  scaleFor,
  shownAngle,
  snapPlanPoint,
  toggleGroup,
  updatePlanItems,
  variantFamily,
  variantView,
  withGroups,
} from './plan.ts';
import { flattenPath, glyphBox, glyphOf, PLAN_CATEGORIES } from './plan-icons.ts';

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

  it('turns lines around their middle and rectangles by their rotation', () => {
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
    expect(rotateItem(rect, 90)).toEqual({ ...rect, rotation: 90 });
    expect(rotateItem({ ...rect, rotation: 270 }, 90)).toEqual(rect);
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
    expect(iconHit({ ...icon, rotation: 90 }, { x: c.x, y: c.y + 24 })).toBe(true);
    expect(iconHit(icon, { x: c.x, y: c.y + 24 })).toBe(false);
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

describe('the icon library', () => {
  it('has every kind in one category, with a glyph that flattens', () => {
    const kinds = PLAN_CATEGORIES.flatMap((c) => c.kinds);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds, 'light'].sort()).toEqual([...PLAN_ICON_KINDS].sort());
    for (const kind of kinds) {
      const box = glyphBox(glyphOf(kind));
      expect(box.w).toBeGreaterThan(4);
      expect(box.h).toBeGreaterThan(4);
    }
  });

  it('flattens arcs and curves through their end points', () => {
    const [arc] = flattenPath('M7 16a9 9 0 0 1 9-9');
    expect(arc?.points.slice(-2).map((v) => Math.round(v))).toEqual([16, 7]);
    const [curve] = flattenPath('M6 24C10 12 18 9 26 9');
    expect(curve?.points.slice(-2)).toEqual([26, 9]);
  });

  it('sizes symbols S, M, L and furniture freely', () => {
    const fresnel = { ...camera, kind: 'fresnel' as const, id: 'iconAAAAAAAAA' };
    const m = iconSize(fresnel);
    expect(Math.max(m.w, m.h)).toBe(SYMBOL_SIZES.M);
    expect(
      Math.max(iconSize({ ...fresnel, size: 'L' }).w, iconSize({ ...fresnel, size: 'L' }).h),
    ).toBe(SYMBOL_SIZES.L);
    expect(iconSize({ kind: 'sofa', w: 220, h: 90 })).toEqual({ w: 220, h: 90 });
  });

  it('narrows the camera cone with a longer lens and widens a beam with its angle', () => {
    const cam: PlanIcon = { ...camera, id: 'iconAAAAAAAAA' };
    expect(lensAngle(35)).toBeCloseTo(39, 0);
    expect(iconCone({ ...cam, lens: 85 })?.angle).toBeLessThan(iconCone(cam)?.angle ?? 0);
    expect(iconCone({ ...cam, lens: 35 }, 'ff')?.angle).toBeCloseTo(54.4, 0);
    const light: PlanIcon = { ...cam, kind: 'fresnel', beam: 60 };
    expect(iconCone(light)).toMatchObject({ angle: 60, beam: true });
    expect(iconCone({ ...cam, kind: 'table' })).toBeNull();
  });

  it('puts icons on their family layer unless they have their own', () => {
    expect(layerOf({ ...camera, id: 'iconAAAAAAAAA', kind: 'fresnel' })).toBe('lights');
    expect(layerOf({ ...camera, id: 'iconAAAAAAAAA', kind: 'sofa' })).toBe('set');
    expect(layerOf({ ...camera, id: 'iconAAAAAAAAA', layer: 'notes' })).toBe('notes');
  });
});

describe('blocking', () => {
  it('moves an icon on, keeping where it stood as a numbered step', () => {
    const actor: PlanIcon = {
      id: 'iconAAAAAAAAA',
      kind: 'actor',
      color: '#B897F0',
      x: 1000,
      y: 1000,
      note: 'Porta, entra',
    };
    const two = addBlockingStep(actor, { x: 0.5, y: 0.25 });
    expect(two).toMatchObject({
      x: 2048,
      y: 1024,
      steps: [{ x: 1000, y: 1000, note: 'Porta, entra' }],
    });
    expect(two).not.toHaveProperty('note');
    // People face the way they walk: here to the right and a little down.
    expect(two.rotation).toBeGreaterThan(0);
    expect(two.rotation).toBeLessThan(10);
    const three = addBlockingStep(two, { x: 0.5, y: 0.75 });
    expect(blockingPositions(three)).toHaveLength(3);
    expect(three.rotation).toBe(90);
    // Cameras keep their direction.
    expect(
      addBlockingStep({ ...actor, kind: 'camera', rotation: 45 }, { x: 0.9, y: 0.9 }).rotation,
    ).toBe(45);
  });

  it('bows a move through the point it is dragged to', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const bend = bendThrough(a, b, { x: 50, y: -30 });
    expect(bend).toBeCloseTo(30);
    expect(blockingCurve(a, b, bend).middle).toEqual({ x: 50, y: -30 });
  });
});

describe('resizing', () => {
  it('gives furniture any width and depth from the opposite corner', () => {
    const sofa: PlanIcon = {
      id: 'iconAAAAAAAAA',
      kind: 'sofa',
      color: '#1C1C1E',
      x: 2048,
      y: 2048,
      w: 100,
      h: 50,
    };
    const c = { x: 500, y: (2048 / STROKE_GRID) * PLAN_VIEW_H };
    const out = resizeItem(sofa, 'se', { x: c.x + 50 + 120, y: c.y + 25 + 40 });
    expect(out.w).toBeCloseTo(220);
    expect(out.h).toBeCloseTo(90);
    // The top left corner stayed: the middle moved half the growth.
    expect((out.x / STROKE_GRID) * PLAN_VIEW_W).toBeCloseTo(500 + 60, 0);
  });

  it('snaps symbols to S, M or L and texts to their three sizes', () => {
    const fresnel: PlanIcon = {
      id: 'iconAAAAAAAAA',
      kind: 'fresnel',
      color: '#EDD963',
      x: 2048,
      y: 2048,
    };
    const c = { x: 500, y: (2048 / STROKE_GRID) * PLAN_VIEW_H };
    expect(resizeItem(fresnel, 'se', { x: c.x + 40, y: c.y + 40 }, { keepRatio: true }).size).toBe(
      'L',
    );
    expect(resizeItem(fresnel, 'se', { x: c.x + 10, y: c.y + 10 }, { keepRatio: true }).size).toBe(
      'S',
    );
    const text = {
      id: 'textAAAAAAAAA',
      kind: 'text' as const,
      color: '#1C1C1E',
      width: 18,
      x0: 1000,
      y0: 1000,
      x1: 1000,
      y1: 1000,
      text: 'uscita',
    };
    const big = resizeItem(
      text,
      's',
      { x: 0, y: (1000 / STROKE_GRID) * PLAN_VIEW_H + 12 },
      { textSizes: [14, 18, 26] },
    );
    expect(big.width).toBe(26);
  });

  it('shows turned items with a signed angle', () => {
    expect(shownAngle({ ...camera, id: 'iconAAAAAAAAA', rotation: 340 })).toBe(-20);
    expect(shownAngle({ ...camera, id: 'iconAAAAAAAAA', rotation: 90 })).toBe(90);
  });
});

describe('several items', () => {
  const chair = (id: string, x: number, y: number): PlanIcon => ({
    id: `chair${id}`.padEnd(13, 'A'),
    kind: 'chair',
    color: '#1C1C1E',
    x,
    y,
  });
  const a = chair('A', 1000, 1000);
  const b = chair('B', 2000, 1500);
  const c = chair('C', 2600, 2000);

  it('lines items up on the left, the middle or the top, and spreads them evenly', () => {
    const left = alignItems([a, b, c], 'left');
    expect(new Set(left.map((i) => i.x))).toEqual(new Set([1000]));
    const top = alignItems([a, b, c], 'top');
    expect(new Set(top.map((i) => i.y))).toEqual(new Set([1000]));
    const spread = alignItems([c, a, b], 'distribute');
    // First and last stay; the one between moves to the middle.
    expect(spread.map((i) => i.x)).toEqual([2600, 1000, 1800]);
  });

  it('groups items, picks a group whole and ungroups it again', () => {
    const [ga, gb] = toggleGroup([a, b]);
    expect(ga?.group).toBeDefined();
    expect(ga?.group).toBe(gb?.group);
    const plan = { icons: [ga as PlanIcon, gb as PlanIcon, c] };
    expect(withGroups(plan, [{ kind: 'icons', id: a.id }]).map((r) => r.id)).toEqual([a.id, b.id]);
    expect(toggleGroup([ga as PlanIcon, gb as PlanIcon]).every((i) => !i.group)).toBe(true);
  });

  it('takes what a dragged box touches', () => {
    const plan = { icons: [a, b, c] };
    const hit = itemsInRect(plan, { x: 0, y: 0, w: 300, h: 200 });
    expect(hit.map((r) => r.id)).toEqual([a.id]);
  });
});

describe('scale and measures', () => {
  it('sets the scale from a line of known length', () => {
    const length = gridLength(0, 0, 4096, 0);
    expect(length).toBe(PLAN_VIEW_W);
    expect(scaleFor(length, 5.2)).toBeCloseTo(1000 / 5.2);
    expect(scaleFor(length, 0)).toBeNull();
  });

  it('keeps a measure on the icons it is attached to', () => {
    const cam: PlanIcon = { ...camera, id: 'iconCAMAAAAAA', x: 100, y: 200 };
    const actor: PlanIcon = { ...camera, id: 'iconACTAAAAAA', kind: 'actor', x: 900, y: 800 };
    const measure = {
      id: 'measureAAAAAA',
      kind: 'measure' as const,
      color: '#1C1C1E',
      width: 4,
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 1,
      from: cam.id,
      to: actor.id,
    };
    expect(measureEnds(measure, [cam, actor])).toMatchObject({
      x0: 100,
      y0: 200,
      x1: 900,
      y1: 800,
    });
    // An icon gone: its end stays.
    expect(measureEnds(measure, [cam])).toMatchObject({ x0: 100, y0: 200, x1: 1, y1: 1 });
  });
});

describe('layers and variants', () => {
  it('counts the items of each layer', () => {
    const { doc, id, read } = setup();
    addPlanIcon(doc, id, camera);
    addPlanIcon(doc, id, { ...camera, kind: 'sofa' });
    addStroke(doc, id, { tool: 'pencil', color: '#1C1C1E', width: 4, points: [0, 0, 9, 9] });
    expect(layerCounts(read())).toEqual({ set: 2, lights: 0, camera: 1, actors: 0, notes: 0 });
  });

  it('makes a variant that shares the Set layer of its base', () => {
    const { doc, id, read } = setup();
    addPlanIcon(doc, id, { ...camera, kind: 'sofa' });
    addPlanIcon(doc, id, { ...camera, kind: 'fresnel' });
    const variantId = addVariant(doc, read(), 'Sera', { userId: null });
    const all = listElements(doc);
    const variant = all.find((e) => e.id === variantId) as PlanElement;
    // Its own copy of the light, not of the sofa.
    expect(variant.icons?.map((i) => i.kind)).toEqual(['fresnel']);
    expect(variant.icons?.[0]?.id).not.toBe(read().icons?.[1]?.id);
    expect(variant).toMatchObject({ variantOf: id, variant: 'Sera' });
    // Seen together: the base's sofa under the variant's light.
    expect(variantView(variant, read()).icons?.map((i) => i.kind)).toEqual(['sofa', 'fresnel']);
    expect(variantFamily(all, variant).map((p) => p.id)).toEqual([id, variantId]);
  });
});
