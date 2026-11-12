// SPDX-License-Identifier: MPL-2.0
import {
  createBoardDoc,
  type Element,
  PLAN_COORD_MAX,
  PLAN_COORD_MIN,
  type PlanOpening,
  type PlanWall,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { createElement, listElements } from './board.ts';
import { addPlanIcon, PLAN_VIEW_H, PLAN_VIEW_W, type PlanElement } from './plan.ts';
import { NOMINAL_SCALE } from './plan-icons.ts';
import {
  backgroundBox,
  copySetLayer,
  fitBackground,
  planPlace,
  roomScale,
  roomWalls,
  scaleBackground,
  setSources,
} from './plan-start.ts';
import {
  addPlanOpening,
  addPlanWall,
  atLength,
  moveWallCorner,
  openingCorners,
  openingPlace,
  openingSide,
  openingSpan,
  sideAngle,
  snapWallEnd,
  toWallPoints,
  wallLength,
  wallPoints,
} from './plan-walls.ts';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, by = 0.5) =>
  Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by;

describe('drawing walls', () => {
  it('snaps a side to right angles, to 45° or leaves it free', () => {
    const o = { x: 100, y: 100 };
    expect(near(snapWallEnd(o, { x: 300, y: 120 }, '90'), { x: 300, y: 100 })).toBe(true);
    expect(near(snapWallEnd(o, { x: 110, y: 300 }, '90'), { x: 100, y: 300 })).toBe(true);
    const diagonal = snapWallEnd(o, { x: 200, y: 190 }, '45');
    expect(diagonal.x - o.x).toBeCloseTo(diagonal.y - o.y, 6);
    expect(snapWallEnd(o, { x: 200, y: 190 }, 'free')).toEqual({ x: 200, y: 190 });
  });

  it('gives a typed length to the side, the way the pointer points', () => {
    expect(near(atLength({ x: 0, y: 0 }, { x: 30, y: 40 }, 100), { x: 60, y: 80 })).toBe(true);
    // A pointer still on the corner draws to the right.
    expect(atLength({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toEqual({ x: 15, y: 5 });
  });

  it('reads the angle at a corner, or with the horizontal for the first side', () => {
    expect(sideAngle({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(0);
    expect(sideAngle({ x: 0, y: 0 }, { x: 0, y: -100 })).toBe(90);
    expect(sideAngle({ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 0 })).toBe(90);
    expect(sideAngle({ x: 100, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 0 })).toBe(135);
  });

  it("keeps wall points within the plan's reach, in grid units (decision 0117)", () => {
    expect(toWallPoints([{ x: -5, y: PLAN_VIEW_H * 2 }])).toEqual([-20, STROKE_GRID * 2]);
    expect(toWallPoints([{ x: -1e6, y: 1e6 }])).toEqual([PLAN_COORD_MIN, PLAN_COORD_MAX]);
    expect(toWallPoints([{ x: PLAN_VIEW_W / 2, y: 0 }])).toEqual([STROKE_GRID / 2, 0]);
  });
});

describe('placing openings', () => {
  const room: PlanWall = {
    id: 'roomAAAAAAAAA',
    points: toWallPoints([
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 400 },
      { x: 100, y: 400 },
    ]),
    thickness: 10,
    closed: true,
  };

  it('puts an opening on the side under the pointer, whole, never round a corner', () => {
    expect(openingPlace(room, { x: 300, y: 95 }, 80)).toBeCloseTo(200, 0);
    // Near the corner it stops where its gap still fits on the side.
    expect(openingPlace(room, { x: 495, y: 103 }, 80)).toBeCloseTo(360, 0);
    // On the second side.
    expect(openingPlace(room, { x: 505, y: 250 }, 80)).toBeCloseTo(550, 0);
    // A side shorter than the opening takes it in its middle.
    const short = {
      ...room,
      points: toWallPoints([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ]),
      closed: false,
    };
    expect(openingPlace(short, { x: 5, y: 0 }, 80)).toBeCloseTo(20, 0);
  });

  it('keeps a gap on its side: wider than the side it fills it, never round a corner', () => {
    // Side 0 is 400 long: 600 wide at 200 would cross the corner into side 1.
    const span = openingSpan(room, { at: 200, width: 600 });
    expect(span.from).toBeCloseTo(0, 0);
    expect(span.to).toBeCloseTo(400, 0);
    // A middle written near a corner is drawn moved off it, on its own side.
    const near = openingSpan(room, { at: 390, width: 80 });
    expect(near.to).toBeLessThanOrEqual(400.5);
    expect(openingSide(room, { at: 550 })).toBeCloseTo(300, 0);
  });

  it('measures the gap from the two corners of its side', () => {
    const corners = openingCorners(room, { at: 200, width: 80 });
    expect(corners.before).toBeCloseTo(160, 0);
    expect(corners.after).toBeCloseTo(160, 0);
    const second = openingCorners(room, { at: 550, width: 80 });
    expect(second.before).toBeCloseTo(110, 0);
    expect(second.after).toBeCloseTo(110, 0);
  });

  it('moves a corner and keeps each opening at its share of its own side', () => {
    const door: PlanOpening = {
      id: 'doorAAAAAAAAA',
      wall: room.id,
      kind: 'door',
      at: 550,
      width: 80,
    };
    const { wall, openings } = moveWallCorner(room, 1, { x: 700, y: 100 }, [door]);
    expect(near(wallPoints(wall)[1] as { x: number; y: number }, { x: 700, y: 100 })).toBe(true);
    expect(wallLength(wall)).toBeGreaterThan(wallLength(room));
    // Half way down the second side before, half way down it after.
    const [moved] = openings;
    const side1 = Math.hypot(600, 0);
    const side2 = Math.hypot(200, 300);
    expect(moved?.at).toBeCloseTo(side1 + side2 / 2, -1);
  });
});

describe('ready rooms', () => {
  it('draws a room at the plan scale, or picks a scale that fits', () => {
    expect(roomScale(8, 5)).toBe(NOMINAL_SCALE);
    expect(6.3 * (roomScale(8, 6.3) as number)).toBeLessThanOrEqual(PLAN_VIEW_H * 0.8);
    const big = roomScale(40, 10) as number;
    expect(40 * big).toBeLessThanOrEqual(PLAN_VIEW_W * 0.8);
    expect(roomScale(8, 6, 50)).toBe(50);
    expect(roomScale(30, 6, 50)).toBeNull();
  });

  it('makes a rectangle, an L, a U, three walls of a studio and no walls outside', () => {
    const [rect] = roomWalls('rect', 8, 6, 50);
    expect(rect?.closed).toBe(true);
    expect(wallPoints(rect as PlanWall)).toHaveLength(4);
    expect(wallLength(rect as PlanWall)).toBeCloseTo(28 * 50, -1);
    expect(rect?.thickness).toBeCloseTo(0.15 * 50, 2);
    const pts = wallPoints(rect as PlanWall);
    // In the middle of the drawing.
    expect(((pts[0]?.x ?? 0) + (pts[2]?.x ?? 0)) / 2).toBeCloseTo(PLAN_VIEW_W / 2, 0);
    expect(wallPoints(roomWalls('l', 8, 6, 50)[0] as PlanWall)).toHaveLength(6);
    expect(wallPoints(roomWalls('u', 8, 6, 50)[0] as PlanWall)).toHaveLength(8);
    const [studio] = roomWalls('studio', 8, 6, 50);
    expect(studio?.closed).toBeUndefined();
    expect(wallLength(studio as PlanWall)).toBeCloseTo((6 + 8 + 6) * 50, -1);
    expect(roomWalls('exterior', 8, 6, 50)).toEqual([]);
  });
});

describe('reusing the set of another plan', () => {
  const doc = createBoardDoc('boardAAAAAAAA');
  const add = <T extends Element['type']>(type: T, props: Record<string, unknown>) =>
    createElement(doc, type, { x: 0, y: 0 }, props as never, { userId: null });
  const diner = add('location', { name: "Rosa's diner" });
  const garage = add('location', { name: 'Garage' });
  const scene = add('scene', { number: '5', title: 'Coffee', location: " rosa's DINER " });
  const wall = {
    points: toWallPoints([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]),
    thickness: 10,
  };
  const empty = add('plan', { locationId: diner.id });
  const sameCard = add('plan', {
    locationId: diner.id,
    title: 'Scene 5',
    walls: [{ ...wall, id: 'wallAAAAAAAAA' }],
  });
  const byScene = add('plan', { sceneIds: [scene.id], walls: [{ ...wall, id: 'wallBBBBBBBBB' }] });
  const otherPlace = add('plan', {
    locationId: garage.id,
    walls: [{ ...wall, id: 'wallCCCCCCCCC' }],
  });
  const nothingOnSet = add('plan', { locationId: diner.id });
  const setup = add('plan', { locationId: diner.id, variantOf: sameCard.id });
  const all = () => listElements(doc);
  const cards = () => new Map(all().map((e) => [e.id, e]));
  const plans = () => all().filter((e): e is PlanElement => e.type === 'plan');
  const plan = (id: string) => plans().find((p) => p.id === id) as PlanElement;

  it('finds the place by the location card, else by the location of a scene', () => {
    expect(planPlace(plan(empty.id), cards())).toBe("rosa's diner");
    expect(planPlace(plan(byScene.id), cards())).toBe("rosa's diner");
    expect(planPlace(plan(nothingOnSet.id), new Map())).toBeNull();
  });

  it('offers the plans of the same location with a set, never setups or empty ones', () => {
    const ids = setSources(plan(empty.id), plans(), cards()).map((p) => p.id);
    expect(ids).toEqual([sameCard.id, byScene.id]);
    expect(ids).not.toContain(otherPlace.id);
    expect(ids).not.toContain(nothingOnSet.id);
    expect(ids).not.toContain(setup.id);
    // A plan of a place nobody names has none.
    expect(setSources({ ...plan(empty.id), locationId: undefined }, plans(), cards())).toEqual([]);
  });

  it('copies walls, openings and the Set layer, not lights, cameras, people or notes', () => {
    const source = sameCard.id;
    const [wallId] = (plan(source).walls ?? []).map((w) => w.id);
    addPlanOpening(doc, source, { wall: wallId as string, kind: 'door', at: 50, width: 30 });
    addPlanIcon(doc, source, { kind: 'table', color: '#1C1C1E', x: 100, y: 100 });
    addPlanIcon(doc, source, { kind: 'fresnel', color: '#EDD963', x: 200, y: 200 });
    addPlanIcon(doc, source, { kind: 'camera', color: '#9DB8F2', x: 300, y: 300 });
    addPlanIcon(doc, source, { kind: 'actor', color: '#B897F0', x: 400, y: 400 });
    // An actor seated on the Set's table and a practical standing on it: theirs, not the Set's.
    const table = plan(source).icons?.find((i) => i.kind === 'table')?.id as string;
    addPlanIcon(doc, source, { kind: 'actor', color: '#B897F0', x: 100, y: 100, on: table });
    addPlanIcon(doc, source, { kind: 'practical', color: '#EDD963', x: 100, y: 100, on: table });
    const target = add('plan', {});
    const copied = copySetLayer(doc, plan(source), target.id);
    const after = plan(target.id);
    expect(after.walls).toHaveLength(1);
    expect(after.walls?.[0]?.id).not.toBe(wallId);
    expect(after.openings?.[0]?.wall).toBe(after.walls?.[0]?.id);
    expect(after.icons?.map((i) => i.kind)).toEqual(['table']);
    expect(copied).toHaveLength(1);
    // Nothing attached from another layer comes along, and no copy points at what was not copied.
    expect(after.icons?.every((i) => !i.on)).toBe(true);
    // The source keeps everything.
    expect(plan(source).icons).toHaveLength(6);
    addPlanWall(doc, target.id, wall);
    expect(plan(target.id).walls).toHaveLength(2);
  });
});

describe('the background picture', () => {
  it('lies over the drawing until it is placed', () => {
    expect(backgroundBox({ assetId: 'a' })).toEqual({ x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H });
    expect(backgroundBox({ assetId: 'a', x: 1, y: 2, w: 3, h: 4 })).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 4,
    });
  });

  it('fits a picture in the middle with its shape, and scales it from a corner', () => {
    const tall = fitBackground(500, 1000);
    expect(tall.h).toBeCloseTo(PLAN_VIEW_H, 6);
    expect(tall.w).toBeCloseTo(PLAN_VIEW_H / 2, 6);
    expect(tall.x).toBeCloseTo((PLAN_VIEW_W - tall.w) / 2, 6);
    const box = { x: 100, y: 100, w: 200, h: 100 };
    const bigger = scaleBackground(box, 2, { x: 500, y: 150 });
    expect(bigger).toEqual({ x: 100, y: 100, w: 400, h: 200 });
    const fromTopLeft = scaleBackground(box, 0, { x: 200, y: 0 });
    expect(fromTopLeft.x + fromTopLeft.w).toBe(300);
    expect(fromTopLeft.y + fromTopLeft.h).toBe(200);
    expect(fromTopLeft.w / fromTopLeft.h).toBeCloseTo(2, 6);
  });
});
