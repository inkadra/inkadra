// SPDX-License-Identifier: MPL-2.0
import {
  MAX_PLAN_WALLS,
  MAX_WALL_POINTS,
  type PlanOpening,
  type PlanWall,
} from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type { Point } from './geometry.ts';
import { NOMINAL_SCALE } from './plan-icons.ts';
import {
  CLOSE_SLOP,
  canCloseWall,
  changeOpeningKind,
  closesWall,
  draftCorners,
  dragOpening,
  flipOpening,
  newOpeningWidth,
  openingAt,
  openingMaxMetres,
  openingMetres,
  outside,
  resizeOpening,
  setSummary,
  swingOpening,
  typedTowards,
  viewToMetres,
  WALL_SLOP,
  wallCentimetres,
  wallSideCount,
  wallSideEnd,
  wallStep,
  wallThickness,
} from './plan-wall-tools.ts';
import {
  moveWallCorner,
  openingCorners,
  openingSpan,
  toWallPoints,
  wallPoints,
} from './plan-walls.ts';
import { english } from './plan-words.fixture.ts';

const near = (a: Point, b: Point, by = 0.5) =>
  Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by;
const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

// A room 375 × 250 at a scale of 100 units per metre: 3.75 m by 2.5 m, walls 10 units thick.
// Its corners fall on the grid of wall points, so its sides are as long as drawn. Along it, the
// sides run 0 to 375 (top), to 625 (right), to 1000 (bottom) and to 1250 (left, back up).
const square: Point[] = [
  { x: 125, y: 125 },
  { x: 500, y: 125 },
  { x: 500, y: 375 },
  { x: 125, y: 375 },
];
const room: PlanWall = {
  id: 'roomAAAAAAAAA',
  points: toWallPoints(square),
  thickness: 10,
  closed: true,
};
const open: PlanWall = { ...room, id: 'openAAAAAAAAA', closed: undefined };
const step = {
  angles: '90' as const,
  typedMetres: Number.NaN,
  thickness: 0.15,
  scale: 100,
  zoom: 100,
  walls: 0,
};

describe('drawing walls', () => {
  it('closes a room on its first corner, within the tolerance at the zoom', () => {
    expect(canCloseWall(open)).toBe(true);
    expect(canCloseWall(room)).toBe(false);
    expect(canCloseWall({ points: toWallPoints(square.slice(0, 2)) })).toBe(false);
    expect(closesWall(open, { x: 125 + CLOSE_SLOP - 0.1, y: 125 }, 100)).toBe(true);
    expect(closesWall(open, { x: 125 + CLOSE_SLOP + 1, y: 125 }, 100)).toBe(false);
    // Zoomed in twice, the same distance on the screen is half as far on the plan.
    expect(closesWall(open, { x: 125 + CLOSE_SLOP / 2 - 0.1, y: 125 }, 200)).toBe(true);
    expect(closesWall(open, { x: 125 + CLOSE_SLOP - 0.1, y: 125 }, 200)).toBe(false);
    expect(closesWall(room, { x: 125, y: 125 }, 100)).toBe(false);
    expect(closesWall(null, { x: 125, y: 125 }, 100)).toBe(false);
    const closing = wallStep({ wall: open }, { x: 130, y: 121 }, step);
    expect(closing).toEqual({ kind: 'close', wall: { ...open, closed: true } });
  });

  it('turns the side by right angles, by 45° or freely', () => {
    const o = { x: 100, y: 100 };
    const to = { x: 300, y: 160 };
    expect(near(wallSideEnd(o, to, '90', 0), { x: 300, y: 100 })).toBe(true);
    const diagonal = wallSideEnd(o, { x: 300, y: 260 }, '45', 0);
    expect(diagonal.x - o.x).toBeCloseTo(diagonal.y - o.y, 6);
    expect(wallSideEnd(o, to, 'free', 0)).toEqual(to);
  });

  it('gives the side the typed length, at the plan scale or the nominal one', () => {
    const o = { x: 100, y: 100 };
    // 2.5 m at 100 units per metre, along the right angle nearest the pointer.
    expect(near(wallSideEnd(o, { x: 900, y: 130 }, '90', 2.5, 100), { x: 350, y: 100 })).toBe(true);
    const free = wallSideEnd(o, { x: 400, y: 500 }, 'free', 2, undefined);
    expect(len(o, free)).toBeCloseTo(2 * NOMINAL_SCALE, 6);
    // No length typed (empty, or what does not read as one): the pointer's.
    expect(wallSideEnd(o, { x: 300, y: 100 }, '90', Number.NaN, 100)).toEqual({ x: 300, y: 100 });
    // A typed length entered without a pointer goes on straight, or to the right.
    expect(typedTowards([], null)).toBeNull();
    expect(typedTowards([o], null)).toEqual({ x: 101, y: 100 });
    const straight = typedTowards([{ x: 100, y: 0 }, o], null) as Point;
    expect(near(straight, { x: 100, y: 1e6 })).toBe(true);
    expect(typedTowards([o], { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it('starts, adds, extends and stops a wall corner by corner', () => {
    expect(wallStep(null, { x: 10, y: 10 }, step)).toEqual({ kind: 'start', at: { x: 10, y: 10 } });
    expect(wallStep(null, { x: 10, y: 10 }, { ...step, walls: MAX_PLAN_WALLS })).toBeNull();
    // A side shorter than 2 units is no side.
    expect(wallStep({ start: { x: 10, y: 10 } }, { x: 11, y: 10 }, step)).toBeNull();
    const added = wallStep({ start: { x: 100, y: 100 } }, { x: 400, y: 120 }, step);
    expect(added?.kind).toBe('add');
    if (added?.kind !== 'add') return;
    expect(added.wall.thickness).toBe(15);
    expect(wallPoints(added.wall).map((p) => Math.round(p.y))).toEqual([100, 100]);
    const wall = { ...added.wall, id: 'wallAAAAAAAAA' };
    const extended = wallStep({ wall }, { x: 410, y: 400 }, step);
    expect(extended?.kind === 'extend' && extended.full).toBe(false);
    expect(extended?.kind === 'extend' && extended.wall.points.length).toBe(6);
    const long = {
      ...wall,
      points: Array.from({ length: (MAX_WALL_POINTS - 1) * 2 }, (_, i) => i),
    };
    const last = wallStep({ wall: long }, { x: 900, y: 900 }, { ...step, angles: 'free' });
    expect(last?.kind === 'extend' && last.full).toBe(true);
    expect(draftCorners({ wall: open })).toHaveLength(4);
    expect(draftCorners(null)).toEqual([]);
  });

  it('turns a thickness to plan units and back, with and without a scale', () => {
    expect(wallThickness(0.15, 100)).toBe(15);
    expect(wallThickness(0.15)).toBe(13.2);
    expect(wallCentimetres({ thickness: 13.2 })).toBe(15);
    expect(wallCentimetres({ thickness: 20 }, 100)).toBe(20);
    expect(viewToMetres(176)).toBe(2);
    expect(wallSideCount(room)).toBe(4);
    expect(wallSideCount(open)).toBe(3);
  });
});

describe('placing openings', () => {
  const tool = { typedMetres: Number.NaN, scale: 100, zoom: 100 };
  const door: PlanOpening = {
    id: 'doorAAAAAAAAA',
    wall: room.id,
    kind: 'door',
    at: 175,
    width: 90,
  };
  const at = (o: Omit<PlanOpening, 'id'> | null) => ({ id: 'newAAAAAAAAAA', ...o }) as PlanOpening;

  it('finds the nearest wall within half its thickness and the tolerance, never a locked one', () => {
    const reach = room.thickness / 2 + WALL_SLOP;
    expect(openingAt([room], { x: 300, y: 125 - reach + 0.1 }, 'door', tool)?.wall).toBe(room.id);
    expect(openingAt([room], { x: 300, y: 125 - reach - 0.1 }, 'door', tool)).toBeNull();
    // Zoomed in twice, half as far.
    expect(openingAt([room], { x: 300, y: 125 - 13 }, 'door', { ...tool, zoom: 200 })).toBeNull();
    expect(openingAt([{ ...room, locked: true }], { x: 300, y: 125 }, 'door', tool)).toBeNull();
    const other: PlanWall = {
      ...room,
      id: 'nextAAAAAAAAA',
      closed: undefined,
      points: toWallPoints([
        { x: 125, y: 140 },
        { x: 500, y: 140 },
      ]),
    };
    expect(openingAt([other, room], { x: 300, y: 128 }, 'door', tool)?.wall).toBe(room.id);
    expect(openingAt([other, room], { x: 300, y: 136 }, 'door', tool)?.wall).toBe(other.id);
  });

  it("is the kind's width by default, or the typed one", () => {
    expect(openingAt([room], { x: 300, y: 125 }, 'door', tool)).toEqual({
      wall: room.id,
      kind: 'door',
      at: 175,
      width: 90,
    });
    expect(openingAt([room], { x: 300, y: 125 }, 'window', tool)?.width).toBe(120);
    const typed = openingAt([room], { x: 300, y: 125 }, 'door', { ...tool, typedMetres: 1.25 });
    expect(typed?.width).toBe(125);
    expect(newOpeningWidth('doubledoor', 0)).toBeCloseTo(1.6 * NOMINAL_SCALE, 6);
  });

  it('stays whole on its side at a corner, and measures from the corners', () => {
    // Pointed at the top right corner: the door ends at it, on the top side.
    const placed = at(openingAt([room], { x: 498, y: 125 }, 'door', tool));
    expect(placed.at).toBe(330);
    expect(openingCorners(room, placed)).toEqual({ before: 285, after: 0 });
  });

  it('fills a side narrower than it, and is no wider than its side', () => {
    const wide = at(openingAt([room], { x: 300, y: 125 }, 'door', { ...tool, typedMetres: 5 }));
    expect(wide.at).toBe(187.5);
    const span = openingSpan(room, wide);
    expect([span.from, span.to]).toEqual([0, 375]);
    expect(openingMaxMetres(room, wide, 100)).toBe(3.75);
    expect(openingMaxMetres(room, { at: 500 }, 100)).toBeCloseTo(2.5, 1);
    expect(openingMetres(room, door, 100)).toBe(0.9);
    expect(openingMetres(room, wide, 100)).toBe(3.75);
    expect(resizeOpening(2.5, 100)).toEqual({ width: 250 });
  });

  it("goes on a closed wall's last side, the one back to the first corner", () => {
    const placed = at(openingAt([room], { x: 125, y: 250 }, 'window', tool));
    expect(placed.at).toBeCloseTo(1125, 1);
    const corners = openingCorners(room, placed);
    expect(corners.before).toBeCloseTo(65, 1);
    expect(corners.after).toBeCloseTo(65, 1);
    // The same wall open has no side there.
    expect(openingAt([open], { x: 125, y: 250 }, 'window', tool)).toBeNull();
  });

  it('flips its side and swing and back, and only a door keeps its hinge', () => {
    const flipped = { ...door, ...flipOpening(door) };
    expect(flipped.side).toBe('right');
    expect({ ...flipped, ...flipOpening(flipped) }.side).toBeUndefined();
    const swung = { ...door, ...swingOpening(door) };
    expect(swung.hinge).toBe('end');
    expect({ ...swung, ...swingOpening(swung) }.hinge).toBeUndefined();
    expect(changeOpeningKind('window')).toEqual({ kind: 'window', hinge: undefined });
    expect(changeOpeningKind('door')).toEqual({ kind: 'door' });
  });

  it('drags along the wall, whole on the side under the pointer', () => {
    expect(dragOpening(room, door, { x: 260, y: 115 })).toEqual({ ...door, at: 135 });
    expect(dragOpening(room, door, { x: 126, y: 115 }).at).toBe(45);
  });

  it('moves a corner from the openings as they were when the drag started', () => {
    const openings: PlanOpening[] = [
      { id: 'doorAAAAAAAAA', wall: room.id, kind: 'door', at: 500, width: 60 },
      { id: 'windAAAAAAAAA', wall: room.id, kind: 'window', at: 187.5, width: 120 },
    ];
    const once = moveWallCorner(room, 1, { x: 750, y: 125 }, openings);
    // Through the moves of a drag, each from the start: the same place as one move.
    let shown = openings;
    for (const to of [
      { x: 560, y: 145 },
      { x: 620, y: 165 },
      { x: 750, y: 125 },
    ])
      shown = moveWallCorner(room, 1, to, openings).openings;
    expect(shown).toEqual(once.openings);
    // Each stays half way along its own side: the top, now 625 long, and the right one.
    const [doorAt, windowAt] = once.openings.map((o) => o.at) as [number, number];
    expect(windowAt).toBeCloseTo(312.5, 1);
    expect(doorAt).toBeCloseTo(625 + Math.hypot(250, 250) / 2, 1);
  });
});

describe('dimensions and summaries', () => {
  it('writes the sizes of a closed room outside it, whichever way its corners were drawn', () => {
    const square = [0, 0, 1000, 0, 1000, 1000, 0, 1000];
    const back = [0, 0, 0, 1000, 1000, 1000, 1000, 0];
    // The top side runs to the right: its normal points up, out of a room drawn clockwise.
    expect(outside({ points: square, closed: true })).toBe(1);
    expect(outside({ points: back, closed: true })).toBe(-1);
    expect(outside({ points: square, closed: false })).toBe(-1);
  });

  it('sums up the walls and openings of a Set', () => {
    const o = (kind: PlanOpening['kind']) => ({
      id: 'xAAAAAAAAAAAA',
      wall: room.id,
      kind,
      at: 0,
      width: 1,
    });
    expect(setSummary({}, english)).toBe('');
    expect(
      setSummary({ walls: [room], openings: [o('window'), o('door'), o('window')] }, english),
    ).toBe('1 wall, 1 door, 2 windows');
  });
});
