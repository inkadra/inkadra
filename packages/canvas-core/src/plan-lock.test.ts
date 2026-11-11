// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, type PlanIcon, type PlanWall, STROKE_GRID } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createElement, listElements } from './board.ts';
import { addShape } from './film.ts';
import {
  addPlanIcon,
  duplicatePlanItems,
  itemsInRect,
  lockAllows,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  planGroupOf,
  planItemAt,
  planStack,
  removePlanItems,
  updatePlanItems,
} from './plan.ts';
import { moveWithAttached, rotateWithAttached, snapTarget } from './plan-attach.ts';
import { mergeProjectKits, projectKit } from './plan-kit.ts';
import { addPlanOpening, addPlanWall, removePlanWalls, updatePlanWalls } from './plan-walls.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const grid = (v: number, w: number) => Math.round((v / w) * STROKE_GRID);
const planOf = (doc: Y.Doc, id: string) =>
  listElements(doc).find((e) => e.id === id) as PlanElement;

/** A plan with a free light on a C-stand, a locked softbox on the light, a locked chair. */
function setUp() {
  const doc = createBoardDoc(boardId);
  const el = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
  const icon = (kind: PlanIcon['kind'], x: number, y: number, extra: Partial<PlanIcon> = {}) =>
    addPlanIcon(doc, el.id, {
      kind,
      color: '#EDD963',
      x: grid(x, PLAN_VIEW_W),
      y: grid(y, PLAN_VIEW_H),
      ...extra,
    }) as string;
  const stand = icon('cstand', 300, 300);
  const light = icon('cob', 300, 300, { on: stand });
  const box = icon('softbox', 330, 300, { on: light, locked: true });
  const chair = icon('chair', 600, 300, { locked: true, w: 60, h: 60 });
  const plan = () => planOf(doc, el.id);
  const byId = (id: string) => plan().icons?.find((i) => i.id === id) as PlanIcon;
  return { doc, el, stand, light, box, chair, plan, byId };
}

describe('items locked on their own (decision 0110)', () => {
  it('lets a write change only the lock of a locked item', () => {
    const { doc, el, chair, byId } = setUp();
    const before = byId(chair);
    updatePlanItems(doc, el.id, [{ ...before, x: before.x + 100, label: 'Moved', rotation: 90 }]);
    expect(byId(chair)).toEqual(before);
    // Unlocking is the write it takes; then it moves.
    updatePlanItems(doc, el.id, [{ ...before, locked: undefined }]);
    expect(byId(chair).locked).toBeUndefined();
    updatePlanItems(doc, el.id, [{ ...byId(chair), x: before.x + 100 }]);
    expect(byId(chair).x).toBe(before.x + 100);
    expect(lockAllows({ locked: true }, ['locked'], new Set())).toBe(true);
    expect(lockAllows({ locked: true }, ['x'], new Set())).toBe(false);
    expect(lockAllows({}, ['x', 'label'], new Set())).toBe(true);
  });

  it('carries a locked item on its base when the base moves or turns, and edits nothing else', () => {
    const { doc, el, stand, box, byId, plan } = setUp();
    const icons = plan().icons ?? [];
    const was = byId(box);
    updatePlanItems(doc, el.id, moveWithAttached(icons, [stand], { x: 100, y: 0 }));
    expect(byId(box).x).toBeGreaterThan(was.x);
    expect(byId(box).on).toBe(was.on);
    updatePlanItems(doc, el.id, rotateWithAttached(plan().icons ?? [], stand, 90));
    expect(byId(box).rotation).toBe(90);
    // Written alone, without its base, it does not move.
    const now = byId(box);
    updatePlanItems(doc, el.id, [{ ...now, x: now.x + 50 }]);
    expect(byId(box)).toEqual(now);
  });

  it('keeps locked items when deleting, and what sits on a locked base', () => {
    const { doc, el, stand, light, box, chair, plan } = setUp();
    const person = addPlanIcon(doc, el.id, {
      kind: 'actor',
      color: '#B897F0',
      x: 1,
      y: 1,
      on: chair,
    }) as string;
    // The locked chair stays, and so does the person on it.
    removePlanItems(doc, el.id, [chair]);
    expect(plan().icons?.map((i) => i.id)).toEqual([stand, light, box, chair, person]);
    // A free base goes with its free attachments, and leaves the locked one where it was.
    removePlanItems(doc, el.id, [stand]);
    expect(plan().icons?.map((i) => i.id)).toEqual([box, chair, person]);
    // The person on the locked chair goes when asked for.
    removePlanItems(doc, el.id, [person]);
    expect(plan().icons?.map((i) => i.id)).toEqual([box, chair]);
  });

  it('copies the lock with a duplicate', () => {
    const { doc, el, chair, plan } = setUp();
    const [copy] = duplicatePlanItems(doc, plan(), [{ kind: 'icons', id: chair }], { x: 10, y: 0 });
    expect(plan().icons?.find((i) => i.id === copy?.id)?.locked).toBe(true);
  });

  it('is picked by a click, but no snap target and left out of a box selection', () => {
    const { chair, plan } = setUp();
    const p = { x: 600 / PLAN_VIEW_W, y: 300 / PLAN_VIEW_H };
    expect(planItemAt(plan(), p)).toEqual({ kind: 'icons', id: chair });
    expect(snapTarget({ kind: 'actor' }, { x: 600, y: 300 }, plan().icons ?? [])).toBeNull();
    const free = (plan().icons ?? []).map((i) =>
      i.id === chair ? { ...i, locked: undefined } : i,
    );
    expect(snapTarget({ kind: 'actor' }, { x: 600, y: 300 }, free)?.id).toBe(chair);
    const all = itemsInRect(plan(), { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H }).map(
      (r) => r.id,
    );
    expect(all).not.toContain(chair);
    expect(all).toHaveLength(2);
  });

  it('locks strokes and shapes as icons', () => {
    const { doc, el, plan } = setUp();
    const id = addShape(doc, el.id, {
      kind: 'rect',
      color: '#EDEDED',
      width: 2,
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 100,
    }) as string;
    const shape = () => plan().shapes?.find((s) => s.id === id);
    updatePlanItems(doc, el.id, [{ ...shape()!, locked: true }]);
    updatePlanItems(doc, el.id, [{ ...shape()!, x1: 400 }]);
    expect(shape()?.x1).toBe(100);
    removePlanItems(doc, el.id, [id]);
    expect(shape()).toBeDefined();
  });

  it('locks walls and openings', () => {
    const { doc, el, plan } = setUp();
    const wall = addPlanWall(doc, el.id, { points: [0, 0, 1000, 0], thickness: 9, locked: true });
    const free = addPlanWall(doc, el.id, { points: [0, 500, 1000, 500], thickness: 9 });
    const win = addPlanOpening(doc, el.id, {
      wall: free as string,
      kind: 'window',
      at: 50,
      width: 20,
      locked: true,
    });
    const w = (plan().walls ?? []).find((x) => x.id === wall) as PlanWall;
    updatePlanWalls(doc, el.id, 'walls', [{ ...w, thickness: 40 }]);
    expect(plan().walls?.find((x) => x.id === wall)?.thickness).toBe(9);
    updatePlanWalls(doc, el.id, 'walls', [{ ...w, locked: undefined }]);
    expect(plan().walls?.find((x) => x.id === wall)?.locked).toBeUndefined();
    updatePlanWalls(doc, el.id, 'walls', [{ ...w, locked: true }]);
    // The locked wall stays; the free one goes, and its locked window stays (not drawn).
    removePlanWalls(doc, el.id, [wall as string, free as string]);
    expect(plan().walls?.map((x) => x.id)).toEqual([wall]);
    expect(plan().openings?.map((x) => x.id)).toEqual([win]);
  });
});

describe('the Grip and crew group of Elements (decision 0110)', () => {
  const icon = (kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
    id: `${kind}AAAAAAAAAAAAA`.slice(0, 13),
    kind,
    color: '#EDD963',
    x: 100,
    y: 100,
    ...extra,
  });

  it('takes the grip, video, sound and crew on their own layer, the rest by layer', () => {
    expect(planGroupOf(icon('flag'))).toBe('grip');
    expect(planGroupOf(icon('cstand'))).toBe('grip');
    expect(planGroupOf(icon('village'))).toBe('grip');
    expect(planGroupOf(icon('crew'))).toBe('grip');
    expect(planGroupOf(icon('softbox'))).toBe('grip');
    expect(planGroupOf(icon('softbox', { on: 'cobAAAAAAAAAA' }))).toBe('lights');
    expect(planGroupOf(icon('flag', { layer: 'set' }))).toBe('set');
    expect(planGroupOf(icon('cob'))).toBe('lights');
    expect(planGroupOf(icon('camera'))).toBe('camera');
    expect(planGroupOf(icon('dolly'))).toBe('camera');
    expect(planGroupOf(icon('actor'))).toBe('actors');
  });

  it('is left out of the drawing when hidden, its items keeping their layer', () => {
    const plan = { icons: [icon('cob'), icon('flag'), icon('village')] };
    expect(planStack(plan, ['grip']).map((e) => (e.item as PlanIcon).kind)).toEqual(['cob']);
    expect(planStack(plan, ['lights']).map((e) => (e.item as PlanIcon).kind)).toEqual(['village']);
    const p = { x: 100 / STROKE_GRID, y: 100 / STROKE_GRID };
    expect(planItemAt(plan, p, { hidden: new Set(['grip', 'lights']) })).toBeNull();
  });
});

describe('the project kit across boards (decision 0110)', () => {
  const icon = (id: string, kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
    id: id.padEnd(13, 'A'),
    kind,
    color: '#EDD963',
    x: 100,
    y: 100,
    ...extra,
  });

  it('lists each light and camera once, gathering a camera’s lenses from every board', () => {
    const here = projectKit([
      {
        icons: [
          icon('a', 'cob', { make: 'Aputure 600d' }),
          icon('c', 'camera', { label: 'A cam', lens: 50 }),
        ],
      },
    ]);
    const there = projectKit([
      {
        icons: [
          icon('b', 'cob', { make: 'Aputure 600d' }),
          icon('d', 'camera', { label: 'A cam', lens: 32 }),
          icon('e', 'fresnel', { watts: 2000 }),
        ],
      },
    ]);
    const kit = mergeProjectKits(here, there);
    expect(kit.map((k) => k.icon.make ?? k.icon.label ?? k.icon.watts)).toEqual([
      'Aputure 600d',
      'A cam',
      2000,
    ]);
    expect(kit[1]?.lenses).toEqual([32, 50]);
    // The inputs are left as they were.
    expect(here[1]?.lenses).toEqual([50]);
  });
});
