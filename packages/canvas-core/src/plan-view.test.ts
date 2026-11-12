// SPDX-License-Identifier: MPL-2.0
import { type PlanIcon, STROKE_GRID } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { iconCone, labelAnchor, PLAN_VIEW_H, PLAN_VIEW_W, variantView } from './plan.ts';
import { PLAN_LABEL_SIZE } from './plan-labels.ts';
import {
  boundPlanView,
  canZoomPlan,
  fitPlanView,
  panPlanBy,
  pinchPlanView,
  planBaseZoom,
  planContentBox,
  planFrame,
  planRoomBox,
  planZoomPercent,
  stepPlanZoom,
  zoomPlanAround,
} from './plan-view.ts';
import {
  planRoomDims,
  planRooms,
  type RoomDim,
  roomDims,
  roomMetres,
  roomSizeText,
} from './plan-walls.ts';
import { english, wordsOf } from './plan-words.fixture.ts';
import { PLAN_WORDS_IT } from './plan-words-it.ts';

const area = { w: 876, h: 848 };
const words = (length: number, scale: number, overall: boolean) =>
  roomSizeText(length, scale, overall, english, 'en');
const toScreen = (v: { x: number; y: number; zoom: number }, p: { x: number; y: number }) => ({
  x: (p.x - v.x) * v.zoom,
  y: (p.y - v.y) * v.zoom,
});

describe('the view of the plan surface', () => {
  it('calls 100 % the zoom at which the whole drawing fits the area', () => {
    const v = fitPlanView(null, area);
    expect(planZoomPercent(v, area)).toBe(100);
    // The drawing is in the middle.
    const a = toScreen(v, { x: 0, y: 0 });
    const b = toScreen(v, { x: PLAN_VIEW_W, y: PLAN_VIEW_H });
    expect((a.x + b.x) / 2).toBeCloseTo(area.w / 2);
    expect((a.y + b.y) / 2).toBeCloseTo(area.h / 2);
  });

  it('fits a room in the middle of what the bars leave, closer than the whole drawing', () => {
    const room = { x: 160, y: 200, w: 560, h: 440 };
    const insets = { top: 0, right: 0, bottom: 72, left: 0 };
    const v = fitPlanView(room, area, insets);
    expect(v.zoom).toBeGreaterThan(planBaseZoom(area));
    const a = toScreen(v, { x: room.x, y: room.y });
    const b = toScreen(v, { x: room.x + room.w, y: room.y + room.h });
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(area.w);
    expect(b.y).toBeLessThanOrEqual(area.h - insets.bottom);
    expect((a.y + b.y) / 2).toBeCloseTo((area.h - insets.bottom) / 2);
  });

  it('never fits one small icon closer than 250 %', () => {
    const v = fitPlanView({ x: 500, y: 300, w: 10, h: 10 }, area);
    expect(planZoomPercent(v, area)).toBe(250);
  });

  it('zooms around the pointer: the point under it stays under it', () => {
    const v = fitPlanView(null, area);
    const pointer = { x: 600, y: 300 };
    const under = { x: pointer.x / v.zoom + v.x, y: pointer.y / v.zoom + v.y };
    const next = zoomPlanAround(v, area, v.zoom * 2, pointer);
    expect(planZoomPercent(next, area)).toBe(200);
    const after = toScreen(next, under);
    expect(after.x).toBeCloseTo(pointer.x);
    expect(after.y).toBeCloseTo(pointer.y);
  });

  it('keeps the zoom between 25 % and 800 %', () => {
    const v = fitPlanView(null, area);
    expect(planZoomPercent(zoomPlanAround(v, area, v.zoom * 100, { x: 0, y: 0 }), area)).toBe(800);
    expect(planZoomPercent(zoomPlanAround(v, area, v.zoom / 100, { x: 0, y: 0 }), area)).toBe(25);
  });

  it('steps the buttons through the levels round the middle', () => {
    const v = fitPlanView(null, area);
    const inOnce = stepPlanZoom(v, area, 1);
    expect(planZoomPercent(inOnce, area)).toBe(150);
    expect(planZoomPercent(stepPlanZoom(inOnce, area, -1), area)).toBe(100);
    expect(planZoomPercent(stepPlanZoom(v, area, -1), area)).toBe(75);
    // From an odd level the next step is the next round one.
    const odd = zoomPlanAround(v, area, v.zoom * 1.3, { x: 0, y: 0 });
    expect(planZoomPercent(stepPlanZoom(odd, area, 1), area)).toBe(150);
    expect(planZoomPercent(stepPlanZoom(odd, area, -1), area)).toBe(100);
    // The middle of the area stays where it was.
    const mid = { x: area.w / 2 / v.zoom + v.x, y: area.h / 2 / v.zoom + v.y };
    const m = toScreen(inOnce, mid);
    expect(m.x).toBeCloseTo(area.w / 2);
    expect(m.y).toBeCloseTo(area.h / 2);
  });

  it("pans by pixels and never past the plan's reach", () => {
    const v = fitPlanView(null, area);
    const moved = panPlanBy(v, area, 100, -40);
    expect(toScreen(moved, { x: 0, y: 0 }).x).toBeCloseTo(toScreen(v, { x: 0, y: 0 }).x + 100);
    expect(toScreen(moved, { x: 0, y: 0 }).y).toBeCloseTo(toScreen(v, { x: 0, y: 0 }).y - 40);
    // The reach: four extents on every side of the old one.
    const near = { x: -4 * PLAN_VIEW_W, y: -4 * PLAN_VIEW_H };
    const farEnd = { x: 5 * PLAN_VIEW_W, y: 5 * PLAN_VIEW_H };
    const far = panPlanBy(v, area, 1e7, 1e7);
    // At least 64 px of the reach still show at the far edge.
    expect(toScreen(far, near).x).toBeLessThanOrEqual(area.w - 64 + 0.001);
    expect(toScreen(far, near).y).toBeLessThanOrEqual(area.h - 64 + 0.001);
    const back = boundPlanView({ ...v, x: 1e7, y: 1e7 }, area);
    expect(toScreen(back, farEnd).x).toBeGreaterThanOrEqual(63.999);
    expect(toScreen(back, farEnd).y).toBeGreaterThanOrEqual(63.999);
  });

  it('pinches: the point under the fingers follows their middle, zoomed by their spread', () => {
    const v = fitPlanView(null, area);
    const from = [
      { x: 300, y: 400 },
      { x: 400, y: 400 },
    ] as const;
    const to = [
      { x: 250, y: 450 },
      { x: 450, y: 450 },
    ] as const;
    const under = { x: 350 / v.zoom + v.x, y: 400 / v.zoom + v.y };
    const next = pinchPlanView(v, area, from, to);
    expect(next.zoom).toBeCloseTo(v.zoom * 2);
    const after = toScreen(next, under);
    expect(after.x).toBeCloseTo(350);
    expect(after.y).toBeCloseTo(450);
  });

  it('frames what is on the plan: items, walls and the background', () => {
    expect(planContentBox({}, words)).toBeNull();
    const icon = { id: 'aAAAAAAAAAAAA', kind: 'table', color: '#1C1C1E', x: 2048, y: 2048 };
    const box = planContentBox({ icons: [icon as PlanIcon] }, words);
    expect(box?.x).toBeGreaterThan(400);
    expect(box?.x).toBeLessThan(500);
    const walls = planContentBox(
      {
        walls: [{ id: 'wAAAAAAAAAAAA', points: [0, 0, 2048, 0, 2048, 4096], thickness: 10 }],
      },
      words,
    );
    expect(walls).toEqual({ x: -5, y: -5, w: 510, h: PLAN_VIEW_H + 10 });
    const placed = planContentBox(
      {
        background: { assetId: 'pic', x: -200, y: -100, w: 400, h: 200 },
      },
      words,
    );
    expect(placed).toEqual({ x: -200, y: -100, w: 400, h: 200 });
    expect(planContentBox({ background: { assetId: 'pic', hidden: true } }, words)).toBeNull();
  });

  it("frames what is drawn in the plan's shape, beyond the old extent too", () => {
    expect(planFrame({}, words)).toEqual({ x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H });
    const far = { id: 'aAAAAAAAAAAAA', kind: 'table', color: '#1C1C1E', x: -2048, y: 6000 };
    const near = { ...far, id: 'bAAAAAAAAAAAA', x: 2048, y: 2048 };
    const content = planContentBox({ icons: [far, near] as PlanIcon[] }, words);
    const f = planFrame({ icons: [far, near] as PlanIcon[] }, words);
    expect(f.w / f.h).toBeCloseTo(1.5);
    expect(f.x).toBeLessThan(content?.x ?? 0);
    expect(f.y).toBeLessThan(content?.y ?? 0);
    expect(f.x + f.w).toBeGreaterThan((content?.x ?? 0) + (content?.w ?? 0));
    expect(f.y + f.h).toBeGreaterThan((content?.y ?? 0) + (content?.h ?? 0));
    // One small item: never narrower than 400 view units, centred on it.
    const one = planFrame({ icons: [near] as PlanIcon[] }, words);
    expect(one.w).toBe(400);
    const box = planContentBox({ icons: [near] as PlanIcon[] }, words);
    expect(one.x + one.w / 2).toBeCloseTo((box?.x ?? 0) + (box?.w ?? 0) / 2);
    // The background counts only when asked.
    const bg = { assetId: 'pic', x: -900, y: -900, w: 100, h: 100 };
    expect(planFrame({ icons: [near] as PlanIcon[], background: bg }, words, false)).toEqual(one);
    expect(planFrame({ icons: [near] as PlanIcon[], background: bg }, words).x).toBeLessThan(-900);
  });

  it('fits a phone by its width, from the top', () => {
    const phone = { w: 390, h: 728 };
    const room = { x: 100, y: 100, w: 600, h: 500 };
    const v = fitPlanView(room, phone, { top: 48, right: 0, bottom: 0, left: 0 }, true);
    expect(v.zoom).toBeCloseTo((390 - 48) / 600);
    expect(toScreen(v, { x: room.x, y: room.y }).y).toBeCloseTo(48 + 24);
  });

  it("lets everything within the plan's reach be seen: Fit and panning are not held to the extent", () => {
    // An item far out, as the reach allows (review of #615, 1).
    const far = { x: 2500, y: 1500, w: 40, h: 40 };
    const v = fitPlanView(far, area);
    const c = toScreen(v, { x: far.x + far.w / 2, y: far.y + far.h / 2 });
    expect(c.x).toBeCloseTo(area.w / 2);
    expect(c.y).toBeCloseTo(area.h / 2);
    // And a pan from the plan reaches it at 100 %.
    const start = fitPlanView(null, area);
    const there = panPlanBy(start, area, -(2500 * start.zoom), -(1500 * start.zoom));
    expect(toScreen(there, { x: 2500, y: 1500 }).x).toBeLessThan(area.w);
    expect(toScreen(there, { x: 2500, y: 1500 }).y).toBeLessThan(area.h);
  });

  it("frames only what is drawn: hidden layers and a caller's hidden list are left out", () => {
    // Review of #615, 2: a hidden item far away must not shrink the rest into a corner.
    const seen = { id: 'aAAAAAAAAAAAA', kind: 'table', color: '#1C1C1E', x: 2048, y: 2048 };
    const away = { id: 'bAAAAAAAAAAAA', kind: 'cob', color: '#EDD963', x: 20000, y: 20000 };
    const icons = [seen, away] as PlanIcon[];
    const alone = planFrame({ icons: [seen] as PlanIcon[] }, words);
    expect(planFrame({ icons, hiddenLayers: ['lights'] }, words)).toEqual(alone);
    expect(planFrame({ icons }, words, true, ['lights'])).toEqual(alone);
    // Nothing drawn: the standard extent.
    expect(planFrame({ icons, hiddenLayers: ['lights', 'set'] }, words)).toEqual({
      x: 0,
      y: 0,
      w: PLAN_VIEW_W,
      h: PLAN_VIEW_H,
    });
  });

  it("frames what is drawn for an item: labels, a light's second line, beams, blocking", () => {
    // Review of #615, 3: nothing drawn may be cut at the edge of the card or the sheet.
    const key = {
      id: 'aAAAAAAAAAAAA',
      kind: 'cob',
      color: '#EDD963',
      x: 2048,
      y: 2048,
      label: 'Key light with a long name',
      kelvin: 3200,
      intensity: 0.8,
      rotation: 90,
    } as PlanIcon;
    const box = planContentBox({ icons: [key] }, words) as {
      x: number;
      y: number;
      w: number;
      h: number;
    };
    const anchor = labelAnchor(key);
    // The second line, 12 + 2 + 11 units under the label's baseline.
    expect(box.y + box.h).toBeGreaterThanOrEqual(anchor.y + PLAN_LABEL_SIZE + 2);
    // The beam, pointing down, reaches its default length.
    const cone = iconCone(key);
    for (const p of cone?.points ?? []) expect(box.y + box.h).toBeGreaterThanOrEqual(p.y - 0.5);
    // A label wider than the icon.
    expect(box.w).toBeGreaterThan(PLAN_LABEL_SIZE * 0.5 * 'Key light with a long name'.length);
    // Earlier positions of a person and the way between them.
    const walker = {
      id: 'cAAAAAAAAAAAA',
      kind: 'actor',
      color: '#7AD689',
      x: 2048,
      y: 2048,
      steps: [{ x: 0, y: 0 }],
    } as PlanIcon;
    const moved = planContentBox({ icons: [walker] }, words) as { x: number; y: number };
    expect(moved.x).toBeLessThan(0);
    expect(moved.y).toBeLessThan(0);
  });
});

describe('zoom, room sizes and the room a phone fits (decision 0119)', () => {
  const g = (v: number) => Math.round((v / PLAN_VIEW_W) * STROKE_GRID);
  const gy = (v: number) => Math.round((v / PLAN_VIEW_H) * STROKE_GRID);
  const room = {
    id: 'wallRoomAAAAA',
    points: [g(160), gy(100), g(720), gy(100), g(720), gy(540), g(160), gy(540)],
    thickness: 9,
    closed: true,
  };

  it('reads 100 % on the plan fitted, and steps from there', () => {
    const box = { x: 160, y: 100, w: 560, h: 440 };
    const fitted = fitPlanView(box, area);
    const home = fitted.zoom;
    expect(planZoomPercent(fitted, area, home)).toBe(100);
    expect(planZoomPercent(fitted, area)).toBeGreaterThan(100);
    const inOnce = stepPlanZoom(fitted, area, 1, home);
    expect(planZoomPercent(inOnce, area, home)).toBe(150);
    expect(planZoomPercent(stepPlanZoom(inOnce, area, -1, home), area, home)).toBe(100);
    expect(canZoomPlan(fitted, area, 1)).toBe(true);
    const most = zoomPlanAround(fitted, area, fitted.zoom * 1000, { x: 0, y: 0 });
    expect(canZoomPlan(most, area, 1)).toBe(false);
    expect(canZoomPlan(most, area, -1)).toBe(true);
  });

  it('draws a closed room’s sizes with a scale, outside its walls', () => {
    expect(planRoomDims({ walls: [room] })).toEqual([]);
    expect(planRoomDims({ walls: [{ ...room, closed: false }], scale: 70 })).toEqual([]);
    expect(planRoomDims({ walls: [room], scale: 70 }, ['set'])).toEqual([]);
    expect(planRoomDims({ walls: [room], scale: 70, hiddenLayers: ['set'] })).toEqual([]);
    const [top, left] = planRoomDims({ walls: [room], scale: 70 });
    expect(top?.length).toBeCloseTo(560, 0);
    expect(left?.length).toBeCloseTo(440, 0);
    expect(top?.a.y).toBeLessThan(100);
    expect(left?.a.x).toBeLessThan(160);
    expect(roomMetres(560, 70, 'en')).toBe('8.0 m');
    expect(
      roomDims({
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        thickness: 9,
        walls: [],
      }),
    ).toEqual([]);
    // The plan's own switch hides them (version 26).
    expect(planRoomDims({ walls: [room], scale: 70, roomSizes: false })).toEqual([]);
  });

  const wall = (id: string, pts: Array<[number, number]>, closed = false) => ({
    id: `wall${id}`.padEnd(13, 'A'),
    points: pts.flatMap(([x, y]) => [g(x), gy(y)]),
    thickness: 9,
    ...(closed ? { closed: true } : {}),
  });
  const box = (id: string, x0: number, y0: number, x1: number, y1: number) =>
    wall(
      id,
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      true,
    );

  it('writes the sizes of a room on its free sides, clear of the room beside or above it', () => {
    // Side by side: the right room's depth would cross the left room, so it goes on its right.
    const left = box('L', 100, 100, 300, 300);
    const right = box('R', 320, 100, 520, 300);
    const dims = planRoomDims({ walls: [left, right], scale: 70 });
    expect(dims).toHaveLength(4);
    expect(dims[3]?.a.x).toBeGreaterThan(520);
    // One below another: the lower room's width goes under it, not across the upper room.
    const upper = box('U', 100, 100, 400, 200);
    const lower = box('D', 100, 220, 400, 320);
    expect(planRoomDims({ walls: [upper, lower], scale: 70 })[2]?.a.y).toBeGreaterThan(320);
    // Alone, a room keeps the mockup's sides: over the top and down the left.
    const [top, side] = planRoomDims({ walls: [left], scale: 70 });
    expect(top?.a.y).toBeLessThan(100);
    expect(side?.a.x).toBeLessThan(100);
  });

  it('gives an L room its overall size, and makes a room of open walls that close a loop', () => {
    const l = wall(
      'L',
      [
        [100, 100],
        [300, 100],
        [300, 200],
        [200, 200],
        [200, 300],
        [100, 300],
      ],
      true,
    );
    expect(planRoomDims({ walls: [l], scale: 70 }).map((d) => d.overall)).toEqual([true, true]);
    expect(planRoomDims({ walls: [room], scale: 70 }).map((d) => d.overall)).toEqual([
      false,
      false,
    ]);
    // Four walls drawn one by one, two of them backwards, meet in a loop: one room.
    const sides = [
      wall('1', [
        [100, 100],
        [300, 100],
      ]),
      wall('2', [
        [300, 300],
        [300, 100],
      ]),
      wall('3', [
        [300, 300],
        [100, 300],
      ]),
      wall('4', [
        [100, 100],
        [100, 300],
      ]),
    ];
    const rooms = planRooms(sides);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.walls).toHaveLength(4);
    const [w, d] = planRoomDims({ walls: sides, scale: 70 });
    expect(w?.length).toBeCloseTo(200, 0);
    expect(d?.length).toBeCloseTo(200, 0);
    expect(w?.overall).toBe(false);
    // Three walls that do not close: no room, no sizes.
    expect(planRoomDims({ walls: sides.slice(0, 3), scale: 70 })).toEqual([]);
    // Worked out once per list of walls.
    const walls = [l];
    expect(planRoomDims({ walls, scale: 70 })).toBe(planRoomDims({ walls, scale: 70 }));
  });

  it('frames the room sizes with what is drawn', () => {
    const bare = planContentBox({ walls: [room] }, words) as { y: number };
    const sized = planContentBox({ walls: [room], scale: 70 }, words) as { y: number };
    expect(sized.y).toBeLessThan(bare.y);
  });

  it("frames a side's size with its whole text, as the editor and the exports draw it", () => {
    const plan = { walls: [room], scale: 70 };
    const side = planRoomDims(plan).find((d) => d.a.x === d.b.x && d.a.x < 160) as RoomDim;
    const text = words(side.length, 70, side.overall);
    const box = planContentBox(plan, words) as { x: number; y: number; w: number; h: number };
    // The exports write it level, 5 units left of the line: at least half its size per letter.
    expect(box.x).toBeLessThanOrEqual(side.a.x - 5 - text.length * 12 * 0.5);
    // The editor turns it along the line, centred on it: inside the box top to bottom.
    const mid = (side.a.y + side.b.y) / 2;
    expect(box.y).toBeLessThanOrEqual(mid - text.length * 12 * 0.25);
    // The words it is given count: "2,9 m in tutto" is wider than "2.9 m".
    const italian = (length: number, scale: number) =>
      roomSizeText(length, scale, true, wordsOf(PLAN_WORDS_IT), 'it');
    expect((planContentBox(plan, italian) as { x: number }).x).toBeLessThan(box.x);
  });

  it('gives a phone the box of the rooms, none without a closed wall or with the Set hidden', () => {
    const box = planRoomBox({ walls: [room] }) as { x: number; w: number };
    expect(box.x).toBeCloseTo(160 - 4.5, 0);
    expect(box.w).toBeCloseTo(560 + 9, 0);
    expect(planRoomBox({ walls: [{ ...room, closed: false }] })).toBeNull();
    expect(planRoomBox({ walls: [room] }, ['set'])).toBeNull();
  });
});

describe('the frame of a sheet (decision 0119)', () => {
  it('takes the shape of the frame it fills, so a near-square sheet frame is filled', () => {
    const icons = [
      { id: 'iconAAAAAAAAA', kind: 'cob', color: '#EDD963', x: 1000, y: 1000 },
      { id: 'iconBBBBBBBBB', kind: 'cob', color: '#EDD963', x: 3000, y: 3000 },
    ] as PlanIcon[];
    const square = planFrame({ icons }, words, true, [], 1);
    expect(square.w / square.h).toBeCloseTo(1, 5);
    const plain = planFrame({ icons }, words);
    expect(plain.w / plain.h).toBeCloseTo(1.5, 5);
    // The same content, a frame no larger than it needs on its long side.
    expect(square.h).toBeLessThanOrEqual(plain.h * 1.5 + 1);
  });
});

describe("a setup's room sizes (decision 0119)", () => {
  it("follow the base's switch, as its walls do", () => {
    const base = { strokes: [], shapes: [], icons: [], scale: 70, roomSizes: false };
    const setup = { strokes: [], shapes: [], icons: [], roomSizes: true };
    expect(variantView(setup, base).roomSizes).toBe(false);
    expect(variantView(setup, { ...base, roomSizes: undefined }).roomSizes).toBeUndefined();
  });
});

describe('rooms of the wall graph (decision 0119)', () => {
  const g = (v: number) => Math.round((v / PLAN_VIEW_W) * STROKE_GRID);
  const gy = (v: number) => Math.round((v / PLAN_VIEW_H) * STROKE_GRID);
  const wall = (id: string, pts: Array<[number, number]>, closed = false) => ({
    id: `wall${id}`.padEnd(13, 'A'),
    points: pts.flatMap(([x, y]) => [g(x), gy(y)]),
    thickness: 9,
    ...(closed ? { closed: true } : {}),
  });
  const outer = wall(
    'O',
    [
      [100, 100],
      [500, 100],
      [500, 300],
      [100, 300],
    ],
    true,
  );

  it('makes two rooms of one divided by a wall that meets the others in the middle (a T)', () => {
    const divider = wall('D', [
      [300, 100],
      [300, 300],
    ]);
    const rooms = planRooms([outer, divider]);
    expect(rooms).toHaveLength(2);
    // The dividing wall bounds both; each room is a plain rectangle, not an "overall" size.
    for (const r of rooms) {
      expect(r.walls).toContain(divider.id);
      expect(r.points).toHaveLength(4);
    }
    const dims = planRoomDims({ walls: [outer, divider], scale: 70 });
    expect(dims).toHaveLength(4);
    expect(dims.every((d) => !d.overall)).toBe(true);
    expect(dims.map((d) => Math.round(d.length)).sort()).toEqual([200, 200, 200, 200]);
    // The right room's depth does not sit in the left room: it goes on its right.
    const depths = dims.filter((d) => d.a.x === d.b.x).map((d) => d.a.x);
    expect(depths.some((x) => x > 500)).toBe(true);
  });

  it('keeps a size on its side while a wall is dragged near it, and moves it past a margin', () => {
    const room = wall(
      'R',
      [
        [100, 200],
        [400, 200],
        [400, 300],
        [100, 300],
      ],
      true,
    );
    // The width line sits 34.5 units over the top (y 165.5), its text 16 either side.
    const sideAt = (y: number) => {
      const near = wall('N', [
        [150, y],
        [350, y],
      ]);
      const [width] = planRoomDims({ walls: [room, near], scale: 70 });
      return (width?.a.y ?? 0) < 200 ? 'top' : 'bottom';
    };
    expect(sideAt(120)).toBe('top');
    expect(sideAt(152)).toBe('top');
    expect(sideAt(165)).toBe('bottom');
    expect(sideAt(152)).toBe('bottom');
    expect(sideAt(120)).toBe('top');
  });
});
