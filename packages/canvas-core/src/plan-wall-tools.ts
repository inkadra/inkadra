// SPDX-License-Identifier: MPL-2.0
import {
  MAX_PLAN_WALLS,
  MAX_WALL_POINTS,
  PLAN_OPENING_KINDS,
  type PlanOpening,
  type PlanOpeningKind,
  type PlanWall,
} from '@inkadra/doc-schema';
import type { Point } from './geometry.ts';
import { itemLocked } from './plan.ts';
import { NOMINAL_SCALE } from './plan-icons.ts';
import {
  atLength,
  DEFAULT_OPENING_METRES,
  metresToView,
  nearestOnWall,
  openingPlace,
  openingSide,
  openingSpan,
  snapWallEnd,
  toWallPoints,
  type WallAngles,
  wallPoints,
} from './plan-walls.ts';
import type { Words } from './plan-words.ts';

/**
 * The rules of the Walls and Openings tools of the set plan editor (decision 0110): when a corner
 * closes the room, where the side being drawn ends, what a press adds, which wall the Openings
 * tool finds and where its opening goes, and what the properties of an opening write. Pure
 * functions over the plan, so every client draws the same walls and places the same openings;
 * the gestures, the state of the tool and the bars stay in each client.
 *
 * `zoom` is the editor's zoom in percent (100 = the drawing's own size): the tolerances are
 * screen distances, the same on the screen whatever the zoom. `scale` is the plan's view units
 * per metre; a plan without one is drawn at NOMINAL_SCALE.
 */

/** A corner put this close to the first one (view units at 100 %) closes the room. */
export const CLOSE_SLOP = 14;
/** How far from a wall (view units at 100 %, past its half thickness) the Openings tool finds it. */
export const WALL_SLOP = 14;

const round2 = (v: number) => Math.round(v * 100) / 100;
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** A length in view units as metres, at the plan's scale or NOMINAL_SCALE. */
export function viewToMetres(units: number, scale?: number): number {
  return units / (scale ?? NOMINAL_SCALE);
}

/** A thickness in metres as a wall's `thickness`: view units, to the hundredth. */
export function wallThickness(metres: number, scale?: number): number {
  return round2(metresToView(metres, scale));
}

/** The thickness of a wall in whole centimetres, at the plan's scale or NOMINAL_SCALE. */
export function wallCentimetres(wall: Pick<PlanWall, 'thickness'>, scale?: number): number {
  return Math.round(viewToMetres(wall.thickness, scale) * 100);
}

/** How many sides a wall has: one per pair of corners, one more when it is closed. */
export function wallSideCount(wall: Pick<PlanWall, 'points' | 'closed'>): number {
  return Math.max(1, wall.points.length / 2 - (wall.closed ? 0 : 1));
}

// Drawing walls ------------------------------------------------------------------------------

/**
 * The wall being drawn: its first corner until a second one makes the wall, then the wall as
 * stored; null when none is.
 */
export type WallDraft = { start: Point } | { wall: PlanWall } | null;

/** The corners of the wall being drawn, in view units. */
export function draftCorners(draft: WallDraft): Point[] {
  if (!draft) return [];
  return 'wall' in draft ? wallPoints(draft.wall) : [draft.start];
}

/** True when the wall being drawn can be closed: open, with three corners or more. */
export function canCloseWall(wall: Pick<PlanWall, 'points' | 'closed'> | null | undefined) {
  return !!wall && !wall.closed && wall.points.length / 2 >= 3;
}

/** True when a corner at `p` closes the wall being drawn: on its first corner, within CLOSE_SLOP. */
export function closesWall(
  wall: Pick<PlanWall, 'points' | 'closed'> | null | undefined,
  p: Point,
  zoom: number,
): boolean {
  if (!wall || !canCloseWall(wall)) return false;
  const first = wallPoints(wall)[0] as Point;
  return dist(p, first) <= CLOSE_SLOP / (zoom / 100);
}

/**
 * Where the side drawn from `from` ends for the pointer at `towards`: along the nearest allowed
 * angle (90°, 45° or free), and `typedMetres` long when a length was typed (more than 0).
 */
export function wallSideEnd(
  from: Point,
  towards: Point,
  angles: WallAngles,
  typedMetres: number,
  scale?: number,
): Point {
  const end = snapWallEnd(from, towards, angles);
  return typedMetres > 0 ? atLength(from, end, metresToView(typedMetres, scale)) : end;
}

/**
 * Which way a typed length goes when it is entered without a pointer on the plan: towards the
 * pointer's last place, else straight on from the side before, else to the right. Null with no
 * corner to start from.
 */
export function typedTowards(corners: readonly Point[], pointer: Point | null): Point | null {
  const last = corners.at(-1);
  if (!last) return null;
  if (pointer) return pointer;
  const before = corners.at(-2);
  return before ? atLength(before, last, 1e6) : { x: last.x + 1, y: last.y };
}

/**
 * What a press of the Walls tool at `at` (view units) does to the wall being drawn:
 * - `close`: write `wall` (the drawn wall, closed), and the drawing ends;
 * - `start`: the first corner, nothing written yet;
 * - `add`: the second corner makes a new wall (`addPlanWall`; on a plan without a scale, give it
 *   NOMINAL_SCALE in the same transaction), which becomes the wall being drawn;
 * - `extend`: write `wall` with one more corner; `full` when it holds MAX_WALL_POINTS and the
 *   drawing ends.
 * Null when the press does nothing: a side shorter than 2 units, or MAX_PLAN_WALLS reached.
 */
export type WallStep =
  | { kind: 'close'; wall: PlanWall }
  | { kind: 'start'; at: Point }
  | { kind: 'add'; wall: Omit<PlanWall, 'id'> }
  | { kind: 'extend'; wall: PlanWall; full: boolean };

export function wallStep(
  draft: WallDraft,
  at: Point,
  opts: {
    angles: WallAngles;
    /** The length typed for the side, in metres; 0 or NaN for none. */
    typedMetres: number;
    /** The thickness chosen, in metres. */
    thickness: number;
    scale?: number | undefined;
    zoom: number;
    /** How many walls the plan has. */
    walls: number;
  },
): WallStep | null {
  const drawn = draft && 'wall' in draft ? draft.wall : null;
  if (drawn && closesWall(drawn, at, opts.zoom))
    return { kind: 'close', wall: { ...drawn, closed: true } };
  const last = draftCorners(draft).at(-1);
  if (!last) return opts.walls >= MAX_PLAN_WALLS ? null : { kind: 'start', at };
  const end = wallSideEnd(last, at, opts.angles, opts.typedMetres, opts.scale);
  if (dist(last, end) < 2) return null;
  if (!drawn)
    return {
      kind: 'add',
      wall: {
        points: toWallPoints([last, end]),
        thickness: wallThickness(opts.thickness, opts.scale),
      },
    };
  const points = [...drawn.points, ...toWallPoints([end])];
  return {
    kind: 'extend',
    wall: { ...drawn, points },
    full: points.length / 2 >= MAX_WALL_POINTS,
  };
}

// Openings -----------------------------------------------------------------------------------

/** The width of a new opening of `kind` in view units: the typed one, else the kind's default. */
export function newOpeningWidth(kind: PlanOpeningKind, typedMetres: number, scale?: number) {
  return metresToView(typedMetres > 0 ? typedMetres : DEFAULT_OPENING_METRES[kind], scale);
}

/**
 * The opening the Openings tool would place for the pointer at `p` (view units): on the nearest
 * wall within its half thickness plus WALL_SLOP, never a locked one (decision 0114), as wide as
 * typed or the kind's default, kept whole on the side nearest the pointer. Null off the walls.
 */
export function openingAt(
  walls: readonly PlanWall[],
  p: Point,
  kind: PlanOpeningKind,
  opts: { typedMetres: number; scale?: number | undefined; zoom: number },
): Omit<PlanOpening, 'id'> | null {
  let best: { wall: PlanWall; distance: number } | null = null;
  for (const wall of walls) {
    if (itemLocked(wall)) continue;
    const near = nearestOnWall(wall, p);
    if (
      near.distance <= wall.thickness / 2 + WALL_SLOP / (opts.zoom / 100) &&
      (!best || near.distance < best.distance)
    )
      best = { wall, distance: near.distance };
  }
  if (!best) return null;
  const width = newOpeningWidth(kind, opts.typedMetres, opts.scale);
  return {
    wall: best.wall.id,
    kind,
    at: round2(openingPlace(best.wall, p, width)),
    width: round2(width),
  };
}

/** An opening dragged along its wall to the pointer at `p`: kept whole on its side. */
export function dragOpening(wall: PlanWall, opening: PlanOpening, p: Point): PlanOpening {
  return { ...opening, at: round2(openingPlace(wall, p, opening.width)) };
}

/** An opening's width as shown in its properties, in metres to the centimetre. */
export function openingMetres(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  opening: Pick<PlanOpening, 'at' | 'width'>,
  scale?: number,
): number {
  const span = openingSpan(wall, opening);
  return round2(viewToMetres(span.to - span.from, scale));
}

/** The widest an opening may be, in metres: the side it sits on, to the centimetre below. */
export function openingMaxMetres(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  opening: Pick<PlanOpening, 'at'>,
  scale?: number,
): number {
  return Math.max(0.1, Math.floor(viewToMetres(openingSide(wall, opening), scale) * 100) / 100);
}

// What the properties of an opening write. A field back to its default goes as undefined, which
// `updatePlanWalls` deletes.

/** The opening `metres` wide. */
export function resizeOpening(metres: number, scale?: number): Pick<PlanOpening, 'width'> {
  return { width: round2(metresToView(metres, scale)) };
}

/** The opening opened to its other side of the wall, and back. */
export function flipOpening(opening: Pick<PlanOpening, 'side'>): Pick<PlanOpening, 'side'> {
  return { side: opening.side === 'right' ? undefined : 'right' };
}

/** A door hinged at its other end, and back. */
export function swingOpening(opening: Pick<PlanOpening, 'hinge'>): Pick<PlanOpening, 'hinge'> {
  return { hinge: opening.hinge === 'end' ? undefined : 'end' };
}

/** The opening as another kind: only a door keeps its hinge. */
export function changeOpeningKind(kind: PlanOpeningKind): Partial<PlanOpening> {
  return { kind, ...(kind === 'door' ? {} : { hinge: undefined }) };
}

// Dimensions and summaries ------------------------------------------------------------------

/**
 * Which side of a wall its dimensions go, as the sign of their offset along the normal
 * (b.y − a.y, a.x − b.x) of each side: outside a closed room, as the mockup draws them (decision
 * 0119), whichever way its corners were drawn; an open wall keeps the side it had.
 */
export function outside(wall: Pick<PlanWall, 'points' | 'closed'>): 1 | -1 {
  if (!wall.closed) return -1;
  const pts = wallPoints(wall);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Point;
    const b = pts[(i + 1) % pts.length] as Point;
    area += a.x * b.y - b.x * a.y;
  }
  return area > 0 ? 1 : -1;
}

/** What the plan holds on its Set layer besides items: "1 wall, 2 windows, 1 door". */
export function setSummary(
  plan: { walls?: PlanWall[] | undefined; openings?: PlanOpening[] | undefined },
  t: Words,
): string {
  const parts: string[] = [];
  const walls = plan.walls?.length ?? 0;
  if (walls) parts.push(t('board.plan.walls.summaryWalls', { count: walls }));
  const counts = new Map<PlanOpeningKind, number>();
  for (const o of plan.openings ?? []) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  for (const kind of PLAN_OPENING_KINDS) {
    const n = counts.get(kind);
    if (n) parts.push(t(`board.plan.walls.summary.${kind}`, { count: n }));
  }
  return parts.join(', ');
}
