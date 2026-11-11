// SPDX-License-Identifier: MPL-2.0
import {
  createBoardDoc,
  type Element,
  LEGACY_PLAN_ICON_KINDS,
  PLAN_ICON_KINDS,
  type PlanIcon,
  type PlanOpening,
  type PlanWall,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { createElement, listElements } from './board.ts';
import {
  addPlanIcon,
  beamWarmth,
  defaultIconSize,
  duplicatePlanItems,
  iconCentre,
  iconCone,
  iconGlow,
  iconSize,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  planStack,
  removePlanItems,
  SYMBOL_SIZES,
  variantView,
  withAttached,
} from './plan.ts';
import {
  attachedPlacement,
  attachIcon,
  detachIcon,
  modifiersOn,
  moveWithAttached,
  pulledAway,
  rotateWithAttached,
  seatSlots,
  snapTarget,
} from './plan-attach.ts';
import {
  attachRole,
  canAttach,
  catalogueKind,
  flattenGlyph,
  flattenPath,
  glyphBox,
  glyphOf,
  groupOf,
  iconGlyph,
  isSized,
  kindLayer,
  kindTier,
  NOMINAL_SCALE,
  PLAN_CATEGORIES,
} from './plan-icons.ts';
import {
  lensMillimetres,
  linkedCharacter,
  linkedLabel,
  linkedLocation,
  linkedScenes,
  linkedShot,
  setupFrames,
  unlinkCharacter,
} from './plan-links.ts';
import { circuitStatus, iconWatts, parseWatts, planPower } from './plan-power.ts';
import {
  addPlanOpening,
  addPlanWall,
  nearestOnWall,
  openingLines,
  openingSpan,
  pieceOutline,
  planWallAt,
  removePlanWalls,
  wallBounds,
  wallHit,
  wallLength,
  wallPieces,
} from './plan-walls.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

/** An icon at (x, y) view units. */
const at = (kind: PlanIcon['kind'], x: number, y: number, extra: Partial<PlanIcon> = {}) =>
  ({
    id: `${kind}${'A'.repeat(13)}`.slice(0, 13),
    kind,
    color: '#1C1C1E',
    x: Math.round((x / PLAN_VIEW_W) * STROKE_GRID),
    y: Math.round((y / PLAN_VIEW_H) * STROKE_GRID),
    ...extra,
  }) as PlanIcon;
const near = (a: { x: number; y: number }, b: { x: number; y: number }, slack = 2) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= slack;

describe('the catalogue of 163 icons', () => {
  it('has 15 groups in 6 categories, every kind of the schema in one of them but the legacy ones', () => {
    const groups = PLAN_CATEGORIES.flatMap((c) => c.groups);
    expect(PLAN_CATEGORIES.map((c) => c.id)).toEqual([
      'lights',
      'grip',
      'camera',
      'people',
      'set',
      'av',
    ]);
    expect(groups).toHaveLength(15);
    const kinds = groups.flatMap((g) => g.kinds);
    expect(kinds).toHaveLength(163);
    expect(new Set(kinds).size).toBe(163);
    expect([...kinds, ...LEGACY_PLAN_ICON_KINDS].sort()).toEqual([...PLAN_ICON_KINDS].sort());
    for (const c of PLAN_CATEGORIES) expect(c.kinds).toEqual(c.groups.flatMap((g) => g.kinds));
  });

  it('draws every kind with a glyph inside its 40 box, centred on its middle', () => {
    for (const kind of PLAN_ICON_KINDS) {
      const box = glyphBox(glyphOf(kind));
      expect(Math.max(box.w, box.h), kind).toBeGreaterThan(10);
      expect(box.x, kind).toBeGreaterThanOrEqual(-20.5);
      expect(box.y, kind).toBeGreaterThanOrEqual(-20.5);
      expect(box.x + box.w, kind).toBeLessThanOrEqual(20.5);
      expect(box.y + box.h, kind).toBeLessThanOrEqual(20.5);
    }
    // The kinds of version 22 and before, drawn as what they became.
    expect(glyphOf('light')).toBe(glyphOf('fresnel'));
    expect(glyphOf('recorder')).toBe(glyphOf('soundcart'));
    expect(catalogueKind('light')).toBe('fresnel');
  });

  it('keeps fills opaque but for the see-through parts the mockup leaves see-through', () => {
    const fills = (kind: PlanIcon['kind']) =>
      flattenGlyph(glyphOf(kind)).flatMap((p) => (p.fill ? [p.fill] : []));
    expect(fills('fresnel')).toEqual([{ mix: 0.22 }]);
    for (const kind of ['butterfly', 'tent', 'tripod', 'prompter'] as const)
      expect(
        fills(kind).some((f) => f.alpha !== undefined && f.alpha < 0.5),
        kind,
      ).toBe(true);
    expect(fills('ring')).toContainEqual({ hole: true });
    expect(flattenGlyph(glyphOf('gel'))[0]).toMatchObject({
      color: '#F79B54',
      fill: { alpha: 0.7 },
    });
  });

  it('flattens quadratic and smooth curves through their end points', () => {
    const [q] = flattenPath('M5-8q7 8 0 16');
    expect(q?.points.slice(-2)).toEqual([5, 8]);
    const [t] = flattenPath('M-15-3q3.75 8 7.5 0t7.5 0');
    expect(t?.points.slice(-2).map(Math.round)).toEqual([0, -3]);
    const [s] = flattenPath('M0 0c0 5 5 5 5 0s5-5 5 0');
    expect(s?.points.slice(-2)).toEqual([10, 0]);
  });

  it('knows the layer, the stacking tier and the size of each kind', () => {
    expect(kindLayer('cob')).toBe('lights');
    expect(kindLayer('softbox')).toBe('lights');
    expect(kindLayer('hihat')).toBe('camera');
    expect(kindLayer('crew')).toBe('actors');
    expect(kindLayer('seated')).toBe('actors');
    expect(kindLayer('bathtub')).toBe('set');
    expect([kindTier('rug'), kindTier('sofa'), kindTier('tripod'), kindTier('camera')]).toEqual([
      0, 1, 2, 3,
    ]);
    expect([kindTier('actor'), kindTier('cstand'), kindTier('wall')]).toEqual([4, 2, 0]);
    expect(groupOf('octa').id).toBe('modifiers');
    expect(isSized('sofa') && isSized('track') && isSized('butterfly')).toBe(true);
    expect(isSized('fresnel') || isSized('actor')).toBe(false);
  });

  it('draws a posed person with the seated or lying glyph', () => {
    expect(iconGlyph({ kind: 'actor', pose: 'seated' })).toBe(glyphOf('seated'));
    expect(iconGlyph({ kind: 'actor', pose: 'lying' })).toBe(glyphOf('lying'));
    expect(iconGlyph({ kind: 'actor', pose: 'standing' })).toBe(glyphOf('actor'));
    expect(iconGlyph({ kind: 'cob', pose: 'seated' })).toBe(glyphOf('cob'));
  });
});

describe('sizes when dropped', () => {
  it('keeps a person a medium symbol without a scale, and lands at real size with one', () => {
    expect(defaultIconSize('actor')).toEqual({ percent: 100 });
    expect(defaultIconSize('camera')).toEqual({ percent: 100 });
    // 0.5 m at 200 view units per metre is 100 units: 227 % of the 44 of a medium symbol.
    expect(defaultIconSize('actor', 200)).toEqual({ percent: 227 });
    const person = { kind: 'actor' as const, ...defaultIconSize('actor', 200) };
    expect(Math.max(iconSize(person).w, iconSize(person).h)).toBeCloseTo(100, 0);
    expect(SYMBOL_SIZES.M).toBe(44);
  });

  it('lays the sides of furniture along its glyph', () => {
    // The desk's glyph is long from top to bottom.
    expect(defaultIconSize('desk', 100)).toEqual({ w: 70, h: 140 });
    // The car's from left to right.
    expect(defaultIconSize('car', 100)).toEqual({ w: 450, h: 180 });
    expect(defaultIconSize('sofa')).toEqual({ w: 0.9 * NOMINAL_SCALE, h: 2 * NOMINAL_SCALE });
    expect(defaultIconSize('track', 100)).toEqual({ w: 150, h: 60 });
    expect(defaultIconSize('bulb')).toEqual({ percent: 30 });
  });
});

describe('beams and glows', () => {
  it('gives directional lights a beam, a free softbox of version 15 too, and lamps a glow', () => {
    const cob = at('cob', 500, 300);
    expect(iconCone(cob)?.beam).toBe(true);
    expect(iconCone(at('softbox', 500, 300))?.beam).toBe(true);
    expect(iconCone(at('softbox', 500, 300, { on: cob.id }))).toBeNull();
    expect(iconCone(at('practical', 500, 300))).toBeNull();
    expect(iconGlow(at('practical', 500, 300))?.radius).toBeGreaterThan(0);
    expect(iconGlow(cob)).toBeNull();
  });

  it('tints a beam from cool to warm by its colour temperature', () => {
    expect(beamWarmth(undefined)).toBeNull();
    expect(beamWarmth(7000)).toBe(0);
    expect(beamWarmth(2000)).toBe(1);
    expect(beamWarmth(5600)).toBeCloseTo(0.2);
    expect(beamWarmth(3200)).toBeGreaterThan(0.7);
  });
});

describe('stacking', () => {
  it('draws by tier, an attached icon over its base, then in the plan order', () => {
    const sofa = at('sofa', 300, 300);
    const anna = at('actor', 300, 300, { id: 'annaAAAAAAAAA', on: sofa.id });
    const cob = at('cob', 100, 100);
    const box = at('softbox', 120, 100, { id: 'boxAAAAAAAAAA', on: cob.id });
    const stand = at('cstand', 100, 100);
    const rug = at('rug', 300, 300);
    const lifted = at('table', 600, 300, { id: 'tableAAAAAAAA', tier: 5 });
    const plan = {
      icons: [anna, box, cob, sofa, stand, rug, lifted],
      shapes: [
        {
          id: 'textAAAAAAAAA',
          kind: 'text' as const,
          color: '#7AD689',
          width: 18,
          x0: 0,
          y0: 0,
          x1: 0,
          y1: 0,
          text: 'Nota',
        },
      ],
    };
    expect(planStack(plan).map((e) => e.item.id)).toEqual([
      rug.id,
      sofa.id,
      stand.id,
      cob.id,
      box.id,
      anna.id,
      'textAAAAAAAAA',
      lifted.id,
    ]);
    expect(planStack(plan, ['actors', 'notes']).map((e) => e.item.id)).not.toContain(anna.id);
  });
});

describe('attachments', () => {
  it('follows the table of what attaches to what', () => {
    expect(canAttach('softbox', 'cob')).toBe(true);
    expect(canAttach('gel', 'fresnel')).toBe(true);
    expect(canAttach('softbox', 'chair')).toBe(false);
    expect(canAttach('actor', 'sofa')).toBe(true);
    expect(canAttach('actor', 'car')).toBe(true);
    expect(canAttach('actor', 'table')).toBe(false);
    expect(canAttach('hmi', 'combo')).toBe(true);
    expect(canAttach('cob', 'tripod')).toBe(false);
    expect(canAttach('camera', 'tripod')).toBe(true);
    expect(canAttach('camera', 'cstand')).toBe(false);
    expect(canAttach('dolly', 'track')).toBe(true);
    expect(canAttach('dolly', 'curve')).toBe(true);
    expect(canAttach('flag', 'cstand')).toBe(true);
    expect(canAttach('flag', 'combo')).toBe(false);
    expect(attachRole('door')).toBeNull();
    // A kind of version 14 attaches as what it became.
    expect(canAttach('softbox', 'light')).toBe(true);
  });

  it('finds the base under a drop, never the item itself or what is on it', () => {
    const chair = at('chair', 400, 300, { ...defaultIconSize('chair') });
    const sofa = at('sofa', 600, 300, { ...defaultIconSize('sofa') });
    const icons = [chair, sofa];
    expect(snapTarget({ kind: 'actor' }, iconCentre(chair), icons)?.id).toBe(chair.id);
    expect(snapTarget({ kind: 'actor' }, { x: 600, y: 330 }, icons)?.id).toBe(sofa.id);
    expect(snapTarget({ kind: 'actor' }, { x: 100, y: 100 }, icons)).toBeNull();
    expect(snapTarget({ kind: 'softbox' }, iconCentre(chair), icons)).toBeNull();
    const cob = at('cob', 200, 200);
    const box = at('softbox', 220, 200, { id: 'boxAAAAAAAAAA', on: cob.id });
    expect(snapTarget({ kind: 'softbox', id: cob.id }, iconCentre(cob), [cob, box])).toBeNull();
  });

  it('clips modifiers to the front of a light, stacked softbox, grid, gel, turning with it', () => {
    const cob = at('cob', 300, 300, { rotation: 90 });
    const gel = at('gel', 100, 100, { id: 'gelAAAAAAAAAA' });
    const box = at('softbox', 100, 100, { id: 'boxAAAAAAAAAA' });
    const grid = at('grid', 100, 100, { id: 'gridAAAAAAAAA' });
    let icons = [cob, gel, box, grid];
    for (const id of [gel.id, box.id, grid.id]) {
      const changed = new Map(attachIcon(icons, id, cob.id).map((i) => [i.id, i]));
      icons = icons.map((i) => changed.get(i.id) ?? i);
    }
    expect(modifiersOn(cob, icons).map((m) => m.kind)).toEqual(['softbox', 'grid', 'gel']);
    const placed = Object.fromEntries(icons.map((i) => [i.kind, i]));
    // Facing down: each further down the light's axis, turned with it.
    const y = (k: string) => iconCentre(placed[k] as PlanIcon).y;
    expect(y('softbox')).toBeGreaterThan(iconCentre(cob).y);
    expect(y('grid')).toBeGreaterThan(y('softbox'));
    expect(y('gel')).toBeGreaterThan(y('grid'));
    for (const k of ['softbox', 'grid', 'gel']) {
      expect(placed[k]?.rotation).toBe(90);
      expect(placed[k]?.on).toBe(cob.id);
      expect(Math.abs(iconCentre(placed[k] as PlanIcon).x - iconCentre(cob).x)).toBeLessThan(1);
    }
    // Detaching the grid closes the row.
    const gridOff = new Map(detachIcon(icons, grid.id).map((i) => [i.id, i]));
    expect(gridOff.get(grid.id)?.on).toBeUndefined();
    expect(iconCentre(gridOff.get(gel.id) as PlanIcon).y).toBeLessThan(y('gel'));
  });

  it('seats people on the free seat nearest to them, facing the front, and lays them on a bed', () => {
    const sofa = at('sofa', 500, 300, { ...defaultIconSize('sofa') });
    expect(seatSlots(sofa)).toHaveLength(3);
    const anna = at('actor', 500, 200, { id: 'annaAAAAAAAAA', on: sofa.id });
    const leo = at('actor', 500, 200, { id: 'leoAAAAAAAAAA', on: sofa.id });
    const first = attachedPlacement(anna, sofa, [sofa, anna]);
    expect(first).toMatchObject({ pose: 'seated' });
    expect(first?.rotation).toBeUndefined();
    const seated = { ...anna, ...first };
    const second = attachedPlacement(leo, sofa, [sofa, seated, leo]);
    expect(near(iconCentre({ x: second?.x ?? 0, y: second?.y ?? 0 }), iconCentre(seated))).toBe(
      false,
    );
    const bed = at('bed', 300, 300, { ...defaultIconSize('bed'), rotation: 90 });
    const lying = attachedPlacement(at('actor', 300, 300, { on: bed.id }), bed, [bed]);
    expect(lying).toMatchObject({ pose: 'lying', rotation: 270 });
  });

  it('stands a light on a stand and a camera at the end of a jib, keeping where they aim', () => {
    const stand = at('cstand', 300, 300);
    const hmi = at('hmi', 330, 330, { rotation: 45, on: stand.id });
    const place = attachedPlacement(hmi, stand, [stand, hmi]);
    expect(place?.rotation).toBe(45);
    const jib = at('jib', 500, 300, { rotation: 180 });
    const cam = at('camera', 500, 300, { on: jib.id });
    const onJib = attachedPlacement(cam, jib, [jib, cam]);
    // The arm's end is to the left once the jib is turned round.
    expect(iconCentre({ x: onJib?.x ?? 0, y: onJib?.y ?? 0 }).x).toBeLessThan(500);
  });

  it('runs a dolly along its track only', () => {
    const track = at('track', 500, 300, { ...defaultIconSize('track', 100), rotation: 90 });
    const dolly = at('dolly', 560, 310, { on: track.id });
    const place = attachedPlacement(dolly, track, [track, dolly]);
    const c = iconCentre({ x: place?.x ?? 0, y: place?.y ?? 0 });
    // Back on the track's axis (x = 500), as far along it as the drop.
    expect(Math.abs(c.x - 500)).toBeLessThan(1);
    expect(Math.abs(c.y - 310)).toBeLessThan(1);
    expect(place?.rotation).toBe(90);
    const far = attachedPlacement(at('dolly', 500, 900, { on: track.id }), track, [track]);
    expect(iconCentre({ x: far?.x ?? 0, y: far?.y ?? 0 }).y).toBeLessThan(380);
  });

  it('moves and turns a base with everything on it, and detaches what is pulled away', () => {
    const stand = at('cstand', 300, 300);
    const cob = at('cob', 300, 300, { on: stand.id });
    const box = at('softbox', 320, 300, { id: 'boxAAAAAAAAAA', on: cob.id });
    const other = at('fresnel', 100, 100);
    const icons = [stand, cob, box, other];
    expect([...withAttached(icons, [stand.id])].sort()).toEqual([box.id, cob.id, stand.id].sort());
    const moved = moveWithAttached(icons, [stand.id], { x: 100, y: 0 });
    expect(moved.map((i) => i.id).sort()).toEqual([box.id, cob.id, stand.id].sort());
    for (const m of moved) {
      const before = icons.find((i) => i.id === m.id) as PlanIcon;
      expect(Math.round(iconCentre(m).x - iconCentre(before).x)).toBe(100);
    }
    const turned = rotateWithAttached(icons, stand.id, 90);
    const boxTurned = turned.find((i) => i.id === box.id) as PlanIcon;
    expect(boxTurned.rotation).toBe(90);
    expect(near(iconCentre(boxTurned), { x: 300, y: 320 })).toBe(true);
    // A loop of `on` attaches nothing more.
    expect(withAttached([{ ...stand, on: cob.id }, cob], [cob.id]).size).toBe(2);
    const seated = attachedPlacement(cob, stand, icons);
    const sits = iconCentre({ x: seated?.x ?? 0, y: seated?.y ?? 0 });
    expect(pulledAway(cob, sits, icons)).toBe(false);
    expect(pulledAway(cob, { x: sits.x + 100, y: sits.y }, icons)).toBe(true);
  });

  it('deletes and duplicates a base with what is on it, and keeps the copies attached', () => {
    const doc = createBoardDoc(boardId);
    const el = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
    const read = () => listElements(doc).find((e) => e.id === el.id) as PlanElement;
    const cob = addPlanIcon(doc, el.id, { kind: 'cob', color: '#EDD963', x: 900, y: 900 });
    const box = addPlanIcon(doc, el.id, {
      kind: 'softbox',
      color: '#1C1C1E',
      x: 1000,
      y: 900,
      on: cob as string,
    });
    const gel = addPlanIcon(doc, el.id, {
      kind: 'gel',
      color: '#1C1C1E',
      x: 1100,
      y: 900,
      on: cob as string,
    });
    // The copy of the light takes its modifiers, attached to it.
    const copies = duplicatePlanItems(doc, read(), [{ kind: 'icons', id: cob as string }], {
      x: 50,
      y: 50,
    });
    expect(copies).toHaveLength(3);
    const icons = read().icons ?? [];
    const copyOfCob = icons.find((i) => i.id === copies[0]?.id) as PlanIcon;
    expect(copyOfCob.kind).toBe('cob');
    expect(icons.filter((i) => i.on === copyOfCob.id).map((i) => i.kind)).toEqual([
      'softbox',
      'gel',
    ]);
    // A modifier copied alone stands free.
    const [lone] = duplicatePlanItems(doc, read(), [{ kind: 'icons', id: gel as string }], {
      x: 0,
      y: 50,
    });
    expect(read().icons?.find((i) => i.id === lone?.id)?.on).toBeUndefined();
    // Deleting the light deletes what is on it, not the copies.
    removePlanItems(doc, el.id, [cob as string]);
    const left = read().icons ?? [];
    expect(left.some((i) => i.id === box || i.id === gel || i.id === cob)).toBe(false);
    expect(left).toHaveLength(4);
  });
});

describe('walls and openings', () => {
  // A room 400 × 300 view units, its corner at (100, 100).
  const g = (x: number, y: number) => [
    Math.round((x / PLAN_VIEW_W) * STROKE_GRID),
    Math.round((y / PLAN_VIEW_H) * STROKE_GRID),
  ];
  const room: PlanWall = {
    id: 'roomAAAAAAAAA',
    points: [...g(100, 100), ...g(500, 100), ...g(500, 400), ...g(100, 400)],
    thickness: 10,
    closed: true,
  };
  const door: PlanOpening = {
    id: 'doorAAAAAAAAA',
    wall: room.id,
    kind: 'door',
    at: 200,
    width: 80,
  };

  it('measures a wall and cuts a gap for each opening', () => {
    expect(wallLength(room)).toBeCloseTo(1400, -1);
    expect(openingSpan(room, door)).toEqual({ from: 160, to: 240 });
    const [whole] = wallPieces(room);
    // Closed without openings: one piece that starts and ends mid-side, so every corner joins.
    expect(near(whole?.[0] as { x: number; y: number }, { x: 300, y: 100 })).toBe(true);
    expect(near(whole?.at(-1) as { x: number; y: number }, { x: 300, y: 100 })).toBe(true);
    const pieces = wallPieces(room, [door]);
    expect(pieces).toHaveLength(1);
    expect(near(pieces[0]?.[0] as { x: number; y: number }, { x: 340, y: 100 })).toBe(true);
    expect(near(pieces[0]?.at(-1) as { x: number; y: number }, { x: 260, y: 100 })).toBe(true);
    // An open wall with an opening in the middle is two pieces.
    const open = { ...room, closed: false };
    expect(wallPieces(open, [door])).toHaveLength(2);
    // An opening wider than the wall is cut to it.
    expect(openingSpan(open, { ...door, at: 0, width: 5000 })).toEqual({
      from: 0,
      to: wallLength(open),
    });
  });

  it('outlines a piece with square ends and mitred corners', () => {
    const outline = pieceOutline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      10,
    );
    expect(outline).toHaveLength(6);
    expect(near(outline[1] as { x: number; y: number }, { x: 105, y: -5 }, 0.01)).toBe(true);
    expect(near(outline[4] as { x: number; y: number }, { x: 95, y: 5 }, 0.01)).toBe(true);
  });

  it('draws a door open to its side with its swing, and hits walls and openings', () => {
    const lines = openingLines(room, door);
    const leaf = lines.find((l) => l.leaf);
    // Hinged at the start of the gap, open to the left of the wall (up the drawing).
    expect(near(leaf?.points[0] as { x: number; y: number }, { x: 260, y: 100 })).toBe(true);
    expect(near(leaf?.points[1] as { x: number; y: number }, { x: 260, y: 20 })).toBe(true);
    const swing = lines.find((l) => l.dashed);
    expect(near(swing?.points.at(-1) as { x: number; y: number }, { x: 340, y: 100 })).toBe(true);
    const right = openingLines(room, { ...door, side: 'right', hinge: 'end' }).find((l) => l.leaf);
    expect(near(right?.points[1] as { x: number; y: number }, { x: 340, y: 180 })).toBe(true);
    expect(openingLines(room, { ...door, kind: 'window' })).toHaveLength(5);
    expect(wallHit(room, { x: 500, y: 250 })).toBe(true);
    expect(wallHit(room, { x: 300, y: 250 })).toBe(false);
    const plan = { walls: [room], openings: [door] };
    expect(planWallAt(plan, { x: 300, y: 101 })).toEqual({ kind: 'openings', id: door.id });
    expect(planWallAt(plan, { x: 100, y: 300 })).toEqual({ kind: 'walls', id: room.id });
    expect(planWallAt(plan, { x: 300, y: 300 })).toBeNull();
    const nearest = nearestOnWall(room, { x: 300, y: 90 });
    // The corners sit on the grid of the drawing, a little off the round numbers.
    expect(nearest.at).toBeCloseTo(200, 0);
    expect(nearest.distance).toBeCloseTo(10, 0);
    expect(wallBounds(room)).toEqual({ x: 95, y: 95, w: 410, h: 310 });
  });

  it('writes walls within the limits, removes a wall with its openings, and shares them with variants', () => {
    const doc = createBoardDoc(boardId);
    const el = createElement(doc, 'plan', { x: 0, y: 0 }, {}, { userId: null });
    const read = () => listElements(doc).find((e) => e.id === el.id) as PlanElement;
    const wall = addPlanWall(doc, el.id, { points: room.points, thickness: 10 }) as string;
    addPlanOpening(doc, el.id, { wall, kind: 'window', at: 100, width: 60 });
    expect(read().walls).toHaveLength(1);
    expect(read().openings).toHaveLength(1);
    removePlanWalls(doc, el.id, [wall]);
    expect(read().walls).toEqual([]);
    expect(read().openings).toEqual([]);
    const variant = variantView({ icons: [] }, { strokes: [], walls: [room], openings: [door] });
    expect(variant).toMatchObject({ walls: [room], openings: [door] });
  });
});

describe('power', () => {
  it('reads watts from the power text of version 15 and prefers the watts', () => {
    expect(parseWatts('1,2K')).toBe(1200);
    expect(parseWatts('2 kW')).toBe(2000);
    expect(parseWatts('300 W')).toBe(300);
    expect(parseWatts('650')).toBe(650);
    expect(parseWatts('HMI')).toBeNull();
    expect(iconWatts({ kind: 'fresnel', power: '1,2K', watts: 1000 })).toBe(1000);
    expect(iconWatts({ kind: 'fresnel', power: '1,2K' })).toBe(1200);
    expect(iconWatts({ kind: 'camera', watts: 50 })).toBe(0);
  });

  it('turns watts into amps per circuit, warning above 80 % and over above the breaker', () => {
    expect(circuitStatus(12, 16)).toBe('ok');
    expect(circuitStatus(13, 16)).toBe('warning');
    expect(circuitStatus(16.5, 16)).toBe('over');
    const plan = {
      circuits: [
        { id: 'circAAAAAAAAA', name: 'A', amps: 16 },
        { id: 'circBBBBBBBBB', name: 'B', amps: 10 },
      ],
      icons: [
        at('fresnel', 0, 0, { id: 'f1AAAAAAAAAAA', watts: 2000, circuit: 'circAAAAAAAAA' }),
        at('cob', 0, 0, { id: 'c1AAAAAAAAAAA', watts: 1200, circuit: 'circAAAAAAAAA' }),
        at('hmi', 0, 0, { id: 'h1AAAAAAAAAAA', watts: 2500, circuit: 'circBBBBBBBBB' }),
        at('practical', 0, 0, { id: 'p1AAAAAAAAAAA', power: '60 W' }),
        at('camera', 0, 0, { watts: 100 }),
      ],
    };
    const p = planPower(plan);
    expect(p).toMatchObject({ voltage: 230, watts: 5760, amps: 25 });
    expect(p.circuits.map((c) => [c.name, c.amps, c.status])).toEqual([
      ['A', 13.9, 'warning'],
      ['B', 10.9, 'over'],
      ['', 0.3, 'ok'],
    ]);
    expect(p.circuits[2]?.lights).toEqual(['p1AAAAAAAAAAA']);
    expect(planPower({ ...plan, voltage: 120 }).circuits[0]?.status).toBe('over');
    expect(planPower({ ...plan, hiddenLayers: ['lights'] }).watts).toBe(0);
  });
});

describe('links', () => {
  const base = { x: 0, y: 0, w: 100, z: 'a0', parent: null, createdBy: null, createdAt: 1 };
  const cards = new Map<string, Element>(
    [
      { ...base, id: 'charAAAAAAAAA', type: 'character', name: 'Anna', actor: 'Rita' },
      {
        ...base,
        id: 'frameAAAAAAAA',
        type: 'frame',
        lens: '32mm',
        label: '2A',
        shot: 'wide',
      },
      {
        ...base,
        id: 'sceneAAAAAAAA',
        type: 'scene',
        number: '2',
        title: 'Diner',
        setting: 'int',
        time: 'night',
      },
      { ...base, id: 'placeAAAAAAAA', type: 'location', name: "Rosa's diner", light: 'Neon' },
    ].map((c) => [c.id, c as Element]),
  );

  it('shows the live value of a linked card, and the item text once it is gone', () => {
    const actor = at('actor', 0, 0, { characterId: 'charAAAAAAAAA', label: 'old' });
    expect(linkedLabel(actor, cards)).toBe('Anna');
    expect(linkedLabel({ ...actor, characterId: 'goneAAAAAAAAA' }, cards)).toBe('old');
    expect(linkedCharacter(actor, cards)).toEqual({
      id: 'charAAAAAAAAA',
      name: 'Anna',
      actor: 'Rita',
    });
    expect(unlinkCharacter(actor, cards)).toMatchObject({ label: 'Anna' });
    expect(unlinkCharacter(actor, cards).characterId).toBeUndefined();
    const cam = at('camera', 0, 0, { frameId: 'frameAAAAAAAA' });
    expect(linkedShot(cam, cards)).toMatchObject({
      label: '2A',
      frameLens: 32,
      lens: 32,
      shot: 'wide',
    });
    expect(
      linkedShot({ ...cam, lens: 85 }, cards, new Map([['frameAAAAAAAA', '2B']])),
    ).toMatchObject({ label: '2B', frameLens: 32, lens: 85 });
    expect(linkedShot({ ...cam, frameId: 'charAAAAAAAAA' }, cards)).toBeNull();
    expect(setupFrames({ icons: [cam, cam, actor] }, cards)).toEqual(['frameAAAAAAAA']);
    expect(linkedScenes({ sceneIds: ['sceneAAAAAAAA', 'goneAAAAAAAAA'] }, cards)).toEqual([
      { id: 'sceneAAAAAAAA', number: '2', title: 'Diner', setting: 'int', time: 'night' },
    ]);
    expect(linkedLocation({ locationId: 'placeAAAAAAAA' }, cards)).toEqual({
      id: 'placeAAAAAAAA',
      name: "Rosa's diner",
      light: 'Neon',
    });
    expect(linkedLocation({}, cards)).toBeNull();
    expect(lensMillimetres('35 mm')).toBe(35);
    expect(lensMillimetres('Cooke')).toBeNull();
  });
});
