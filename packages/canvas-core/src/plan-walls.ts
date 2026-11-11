// SPDX-License-Identifier: MPL-2.0
import {
  MAX_PLAN_CIRCUITS,
  MAX_PLAN_OPENINGS,
  MAX_PLAN_WALLS,
  newElementId,
  type PlanCircuit,
  type PlanOpening,
  type PlanOpeningKind,
  type PlanWall,
  roots,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import type { Point } from './geometry.ts';
import { PLAN_VIEW_H, PLAN_VIEW_W, type PlanElement } from './plan.ts';
import { NOMINAL_SCALE } from './plan-icons.ts';

/**
 * Walls and openings of a plan (decision 0104). A wall is a polyline with a thickness, closed or
 * not; an opening sits along it, `at` view units from its first point, and cuts its gap. All the
 * geometry is in view units, as the rest of the plan's; renderers fill the outlines of the pieces
 * between the gaps and draw each opening's lines.
 */

/** Thickness of a new wall, in metres (view units through the scale, or NOMINAL_SCALE). */
export const DEFAULT_WALL_METRES = 0.15;
/** Width of a new opening, in metres. */
export const DEFAULT_OPENING_METRES: Readonly<Record<PlanOpeningKind, number>> = {
  door: 0.9,
  doubledoor: 1.6,
  sliding: 1.6,
  window: 1.2,
  opening: 1,
};

/** A length in metres as view units of a plan, by its scale or NOMINAL_SCALE. */
export function metresToView(metres: number, scale?: number): number {
  return metres * (scale ?? NOMINAL_SCALE);
}

/** The points of a wall in view units. */
export function wallPoints(wall: Pick<PlanWall, 'points'>): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < wall.points.length; i += 2)
    out.push({
      x: ((wall.points[i] as number) / STROKE_GRID) * PLAN_VIEW_W,
      y: ((wall.points[i + 1] as number) / STROKE_GRID) * PLAN_VIEW_H,
    });
  return out;
}

/** The wall's path: its points, the first again at the end when it is closed. */
function path(wall: Pick<PlanWall, 'points' | 'closed'>): Point[] {
  const pts = wallPoints(wall);
  return wall.closed && pts.length > 2 ? [...pts, pts[0] as Point] : pts;
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Length of a wall along its path, in view units. */
export function wallLength(wall: Pick<PlanWall, 'points' | 'closed'>): number {
  const pts = path(wall);
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1] as Point, pts[i] as Point);
  return length;
}

/** The point `at` view units along a wall and the way the wall runs there (a unit vector). */
export function pointAlongWall(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  at: number,
): { point: Point; dir: Point } {
  const pts = path(wall);
  let left = Math.max(0, at);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = dist(a, b);
    if (len === 0) continue;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    if (left <= len || i === pts.length - 1) {
      const t = Math.min(left, len);
      return { point: { x: a.x + dir.x * t, y: a.y + dir.y * t }, dir };
    }
    left -= len;
  }
  return { point: pts[0] ?? { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
}

/** The points without the ones that repeat the point before: zero-length segments drop out. */
function distinct(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out.at(-1);
    if (!last || dist(last, p) > 1e-9) out.push(p);
  }
  return out;
}

/**
 * The part of a wall's path from `from` to `to` view units along it, as a polyline. A segment
 * that only touches the span at one end adds nothing, so a gap that starts or ends on a corner
 * leaves no zero-length stub.
 */
function subPath(pts: readonly Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = dist(a, b);
    const s = walked;
    const e = walked + len;
    walked = e;
    if (e <= from || s >= to || len === 0) continue;
    const at = (d: number) => ({
      x: a.x + ((b.x - a.x) * (d - s)) / len,
      y: a.y + ((b.y - a.y) * (d - s)) / len,
    });
    if (out.length === 0) out.push(at(Math.max(s, from)));
    out.push(at(Math.min(e, to)));
  }
  return distinct(out);
}

/**
 * Where an opening's gap runs along its wall, in view units from the wall's first point: whole on
 * the side `at` falls on, never round a corner (decision 0110). An opening wider than its side
 * fills the side; one written anywhere with a middle too near a corner is drawn moved off it.
 */
export function openingSpan(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  opening: Pick<PlanOpening, 'at' | 'width'>,
): { from: number; to: number } {
  const length = wallLength(wall);
  const { index, list } = sideAt(wall, Math.max(0, Math.min(length, opening.at)));
  const side = list[index] ?? { from: 0, to: length };
  const width = Math.min(opening.width, side.to - side.from);
  const middle = Math.max(side.from + width / 2, Math.min(side.to - width / 2, opening.at));
  return { from: middle - width / 2, to: middle + width / 2 };
}

/** The length of the side of its wall an opening sits on, in view units: its widest. */
export function openingSide(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  opening: Pick<PlanOpening, 'at'>,
): number {
  const { index, list } = sideAt(wall, Math.max(0, Math.min(wallLength(wall), opening.at)));
  const side = list[index];
  return side ? side.to - side.from : 0;
}

/**
 * The pieces of a wall between the gaps of its openings, as polylines in view units. A closed
 * wall without openings comes out as one piece that starts and ends in the middle of its first
 * side, so its corners all join.
 */
export function wallPieces(
  wall: Pick<PlanWall, 'id' | 'points' | 'closed'>,
  openings: readonly PlanOpening[] = [],
): Point[][] {
  const pts = path(wall);
  if (pts.length < 2) return [];
  const length = wallLength(wall);
  const gaps = openings
    .filter((o) => o.wall === wall.id)
    .map((o) => openingSpan(wall, o))
    .sort((a, b) => a.from - b.from);
  // Merge gaps that overlap.
  const merged: Array<{ from: number; to: number }> = [];
  for (const g of gaps) {
    const last = merged.at(-1);
    if (last && g.from <= last.to) last.to = Math.max(last.to, g.to);
    else merged.push({ ...g });
  }
  if (!wall.closed) {
    const out: Point[][] = [];
    let from = 0;
    for (const g of merged) {
      if (g.from > from) out.push(subPath(pts, from, g.from));
      from = g.to;
    }
    if (from < length) out.push(subPath(pts, from, length));
    return out.filter((p) => p.length > 1);
  }
  // A loop: walk it twice so a piece may run past the first point.
  const twice = [...pts, ...pts.slice(1)];
  if (merged.length === 0) {
    const first = dist(pts[0] as Point, pts[1] as Point) / 2;
    return [subPath(twice, first, first + length)];
  }
  const out: Point[][] = [];
  for (let i = 0; i < merged.length; i++) {
    const g = merged[i] as { from: number; to: number };
    const next = merged[(i + 1) % merged.length] as { from: number; to: number };
    const end = i + 1 < merged.length ? next.from : next.from + length;
    if (end > g.to) out.push(subPath(twice, g.to, end));
  }
  return out.filter((p) => p.length > 1);
}

/**
 * The outline of a piece of wall `thickness` wide, its corners mitred (cut flat past four times
 * the thickness) and its ends square: a polygon in view units, to fill.
 */
export function pieceOutline(points: readonly Point[], thickness: number): Point[] {
  const half = thickness / 2;
  // A point repeated has no way to run: it would give a normal of zero and a needle for an end.
  const piece = distinct(points);
  const n = piece.length;
  if (n < 2) return [];
  const left: Point[] = [];
  const right: Point[] = [];
  const normal = (a: Point, b: Point) => {
    const len = dist(a, b) || 1;
    return { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  };
  for (let i = 0; i < n; i++) {
    const p = piece[i] as Point;
    const before = i > 0 ? normal(piece[i - 1] as Point, p) : null;
    const after = i < n - 1 ? normal(p, piece[i + 1] as Point) : null;
    let m = before ?? (after as Point);
    let k = half;
    if (before && after) {
      const sum = { x: before.x + after.x, y: before.y + after.y };
      const len = Math.hypot(sum.x, sum.y);
      // A wall that turns straight back has no mitre: the corner keeps the side's own normal.
      if (len > 1e-9) {
        m = { x: sum.x / len, y: sum.y / len };
        const cos = m.x * after.x + m.y * after.y;
        k = Math.min(half * 4, half / Math.max(0.05, cos));
      }
    }
    left.push({ x: p.x + m.x * k, y: p.y + m.y * k });
    right.push({ x: p.x - m.x * k, y: p.y - m.y * k });
  }
  return [...left, ...right.reverse()];
}

/** A line of an opening's drawing: the door's leaf, its swing, a window's panes, the jambs. */
export interface OpeningLine {
  points: Point[];
  dashed?: boolean;
  /** The leaf of a door: drawn heavier. */
  leaf?: boolean;
}

/**
 * How an opening is drawn, in view units: its jambs across the wall at both ends of the gap and
 * its own lines. A door's leaf stands open to its `side`, from its `hinge`, with its swing
 * dashed; a double door has two half leaves; a sliding door two panels side by side; a window
 * three panes along the wall; a plain opening a dashed line.
 */
export function openingLines(wall: PlanWall, opening: PlanOpening): OpeningLine[] {
  const { from, to } = openingSpan(wall, opening);
  const a = pointAlongWall(wall, from);
  const b = pointAlongWall(wall, to);
  const dir = { x: b.point.x - a.point.x, y: b.point.y - a.point.y };
  const width = Math.hypot(dir.x, dir.y) || 1;
  const u = { x: dir.x / width, y: dir.y / width };
  // Left of the way the wall runs (y grows down the drawing).
  const left = { x: u.y, y: -u.x };
  const side = opening.side === 'right' ? { x: -left.x, y: -left.y } : left;
  const t = wall.thickness / 2;
  const off = (p: Point, n: Point, k: number) => ({ x: p.x + n.x * k, y: p.y + n.y * k });
  const along = (k: number) => off(a.point, u, k);
  const jamb = (p: Point) => ({ points: [off(p, left, t), off(p, left, -t)] });
  // The swing of a leaf round its hinge, from open to shut, the short way round.
  const swing = (hinge: Point, open: Point, shut: Point): Point[] => {
    const a0 = Math.atan2(open.y - hinge.y, open.x - hinge.x);
    let sweep = Math.atan2(shut.y - hinge.y, shut.x - hinge.x) - a0;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    const r = dist(hinge, open);
    return Array.from({ length: 13 }, (_, i) => {
      const angle = a0 + (sweep * i) / 12;
      return { x: hinge.x + r * Math.cos(angle), y: hinge.y + r * Math.sin(angle) };
    });
  };
  const out: OpeningLine[] = [jamb(a.point), jamb(b.point)];
  switch (opening.kind) {
    case 'door': {
      const atEnd = opening.hinge === 'end';
      const hinge = atEnd ? b.point : a.point;
      const open = off(hinge, side, width);
      out.push({ points: [hinge, open], leaf: true });
      out.push({ points: swing(hinge, open, atEnd ? a.point : b.point), dashed: true });
      break;
    }
    case 'doubledoor': {
      const half = width / 2;
      const openA = off(a.point, side, half);
      const openB = off(b.point, side, half);
      const middle = along(half);
      out.push({ points: [a.point, openA], leaf: true }, { points: [b.point, openB], leaf: true });
      out.push(
        { points: swing(a.point, openA, middle), dashed: true },
        { points: swing(b.point, openB, middle), dashed: true },
      );
      break;
    }
    case 'sliding':
      out.push(
        { points: [off(along(0), left, t / 2), off(along(width * 0.6), left, t / 2)] },
        { points: [off(along(width * 0.4), left, -t / 2), off(along(width), left, -t / 2)] },
      );
      break;
    case 'window':
      out.push(
        { points: [off(a.point, left, t), off(b.point, left, t)] },
        { points: [a.point, b.point] },
        { points: [off(a.point, left, -t), off(b.point, left, -t)] },
      );
      break;
    default:
      out.push({ points: [a.point, b.point], dashed: true });
  }
  return out;
}

/** Distance from `p` to the segment a–b. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** The nearest point of a wall to `p`: how far along it, and how far from it (view units). */
export function nearestOnWall(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  p: Point,
): { at: number; distance: number } {
  const pts = path(wall);
  let best = { at: 0, distance: Number.POSITIVE_INFINITY };
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = dist(a, b);
    const d = segmentDistance(p, a, b);
    if (d < best.distance) {
      const t = len ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len) : 0;
      best = { at: walked + Math.max(0, Math.min(1, t)) * len, distance: d };
    }
    walked += len;
  }
  return best;
}

/** True when `p` (view units) is on the wall, `slack` view units around its thickness. */
export function wallHit(wall: PlanWall, p: Point, slack = 4): boolean {
  return nearestOnWall(wall, p).distance <= wall.thickness / 2 + slack;
}

/** True when `p` (view units) is in an opening's gap or on its door leaf. */
export function openingHit(wall: PlanWall, opening: PlanOpening, p: Point, slack = 4): boolean {
  const { from, to } = openingSpan(wall, opening);
  const near = nearestOnWall(wall, p);
  if (
    near.at >= from - slack &&
    near.at <= to + slack &&
    near.distance <= wall.thickness / 2 + slack
  )
    return true;
  return openingLines(wall, opening).some(
    (line) =>
      line.leaf && segmentDistance(p, line.points[0] as Point, line.points[1] as Point) <= slack,
  );
}

/**
 * The wall or opening drawn under `p` (view units), openings first; walls of hidden layers are
 * the caller's to leave out. Null when there is none.
 */
export function planWallAt(
  plan: Pick<PlanElement, 'walls' | 'openings'>,
  p: Point,
  slack = 4,
): { kind: 'walls' | 'openings'; id: string } | null {
  const walls = new Map((plan.walls ?? []).map((w) => [w.id, w]));
  const openings = plan.openings ?? [];
  for (let i = openings.length - 1; i >= 0; i--) {
    const o = openings[i] as PlanOpening;
    const wall = walls.get(o.wall);
    if (wall && openingHit(wall, o, p, slack)) return { kind: 'openings', id: o.id };
  }
  const list = plan.walls ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const wall = list[i] as PlanWall;
    if (wallHit(wall, p, slack)) return { kind: 'walls', id: wall.id };
  }
  return null;
}

/** Box of a wall with its thickness, in view units. */
export function wallBounds(wall: PlanWall): { x: number; y: number; w: number; h: number } {
  const pts = wallPoints(wall);
  const t = wall.thickness / 2;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - t;
  const y = Math.min(...ys) - t;
  return { x, y, w: Math.max(...xs) + t - x, h: Math.max(...ys) + t - y };
}

/** The openings drawn: those whose wall is there. */
export function shownOpenings(plan: Pick<PlanElement, 'walls' | 'openings'>): PlanOpening[] {
  const walls = new Set((plan.walls ?? []).map((w) => w.id));
  return (plan.openings ?? []).filter((o) => walls.has(o.wall));
}

// Writing to the document --------------------------------------------------------
//
// Walls and openings are Y.Maps in their Y.Array, as icons are (decision 0062), so two people
// editing different fields of the same wall merge instead of each replacing it with a copy.
// Lists written before that (plain objects) are still read, and an edit of such an item stores
// it as a Y.Map in its place.

/** The plan's list, created when missing; call inside the transaction that writes to it. */
type ListKey = 'walls' | 'openings' | 'circuits';

function listOf(doc: Y.Doc, planId: string, key: ListKey): Y.Array<unknown> | null {
  const map = roots(doc).elements.get(planId);
  if (map?.get('type') !== 'plan') return null;
  const current = map.get(key);
  if (current instanceof Y.Array) return current;
  const fresh = new Y.Array<unknown>();
  // Circuits written by the first builds of decision 0104: one plain list, kept as Y.Maps.
  if (Array.isArray(current))
    fresh.push(current.filter((i) => typeof i === 'object' && i !== null).map(toMap));
  map.set(key, fresh);
  return fresh;
}

const idOf = (value: unknown) =>
  value instanceof Y.Map ? value.get('id') : (value as { id?: unknown } | null)?.id;

const toMap = (item: object) =>
  new Y.Map<unknown>(Object.entries(item).filter(([, v]) => v !== undefined));

function addTo(
  doc: Y.Doc,
  planId: string,
  key: ListKey,
  item: object,
  max: number,
  origin: unknown,
): string | null {
  let id: string | null = null;
  doc.transact(() => {
    const list = listOf(doc, planId, key);
    if (!list || list.length >= max) return;
    id = newElementId();
    list.push([toMap({ ...item, id })]);
  }, origin);
  return id;
}

/** Adds a wall; its id, or null when the plan already has MAX_PLAN_WALLS. */
export function addPlanWall(
  doc: Y.Doc,
  planId: string,
  wall: Omit<PlanWall, 'id'>,
  origin?: unknown,
): string | null {
  return addTo(doc, planId, 'walls', wall, MAX_PLAN_WALLS, origin);
}

/** Adds an opening to a wall; its id, or null when the plan already has MAX_PLAN_OPENINGS. */
export function addPlanOpening(
  doc: Y.Doc,
  planId: string,
  opening: Omit<PlanOpening, 'id'>,
  origin?: unknown,
): string | null {
  return addTo(doc, planId, 'openings', opening, MAX_PLAN_OPENINGS, origin);
}

const same = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

/**
 * Writes new versions of walls or openings, matched by id, field by field: only the fields that
 * differ from what is stored are written, so one person moving an opening and another flipping
 * its side both keep their change. A field set to undefined is removed.
 */
export function updatePlanWalls(
  doc: Y.Doc,
  planId: string,
  key: 'walls' | 'openings',
  items: ReadonlyArray<PlanWall | PlanOpening>,
  origin?: unknown,
): void {
  updateList(doc, planId, key, items, origin);
}

function updateList(
  doc: Y.Doc,
  planId: string,
  key: ListKey,
  items: ReadonlyArray<{ id: string }>,
  origin?: unknown,
): void {
  const byId = new Map(items.map((i) => [i.id, i as unknown as Record<string, unknown>]));
  doc.transact(() => {
    const list = listOf(doc, planId, key);
    if (!list) return;
    list.toArray().forEach((value, index) => {
      const next = byId.get(idOf(value) as string);
      if (!next) return;
      const stored = (value instanceof Y.Map ? value.toJSON() : value) as Record<string, unknown>;
      const changed = Object.keys(next).filter((k) => !same(stored[k], next[k]));
      if (changed.length === 0) return;
      if (value instanceof Y.Map) {
        for (const k of changed)
          if (next[k] === undefined) value.delete(k);
          else value.set(k, next[k]);
        return;
      }
      // Written as a plain object before walls were Y.Maps: stored as one from now on.
      const merged: Record<string, unknown> = { ...stored };
      for (const k of changed)
        if (next[k] === undefined) delete merged[k];
        else merged[k] = next[k];
      list.delete(index, 1);
      list.insert(index, [toMap(merged)]);
    });
  }, origin);
}

/** Removes walls and openings by id; the openings of a removed wall go with it. */
export function removePlanWalls(
  doc: Y.Doc,
  planId: string,
  ids: Iterable<string>,
  origin?: unknown,
): void {
  const doomed = new Set(ids);
  doc.transact(() => {
    for (const key of ['walls', 'openings'] as const) {
      const map = roots(doc).elements.get(planId);
      const list = map?.get('type') === 'plan' ? map.get(key) : null;
      if (!(list instanceof Y.Array)) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list.get(i);
        const wall = item instanceof Y.Map ? item.get('wall') : (item as { wall?: unknown })?.wall;
        if (doomed.has(idOf(item) as string) || (key === 'openings' && doomed.has(wall as string)))
          list.delete(i, 1);
      }
    }
  }, origin);
}

// Drawing and editing walls (the Walls and Openings tools) ------------------------------

/** How the sides of a wall being drawn turn: by right angles, by 45°, or freely. */
export type WallAngles = '90' | '45' | 'free';

/** Wall thicknesses the tools offer, in metres. */
export const WALL_THICKNESSES = [0.1, 0.15, 0.2] as const;

/**
 * Where the side drawn from `from` ends for the pointer at `to` (view units): along the nearest
 * allowed direction, as far as the pointer reaches along it.
 */
export function snapWallEnd(from: Point, to: Point, angles: WallAngles): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (angles === 'free' || (dx === 0 && dy === 0)) return to;
  const step = angles === '90' ? Math.PI / 2 : Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  const along = dx * Math.cos(a) + dy * Math.sin(a);
  return { x: from.x + Math.cos(a) * along, y: from.y + Math.sin(a) * along };
}

/** The point `length` view units from `from` towards `to` (to the right when they meet). */
export function atLength(from: Point, to: Point, length: number): Point {
  const d = dist(from, to);
  const u = d > 1e-9 ? { x: (to.x - from.x) / d, y: (to.y - from.y) / d } : { x: 1, y: 0 };
  return { x: from.x + u.x * length, y: from.y + u.y * length };
}

/**
 * The angle a side makes, in whole degrees: at its first corner with the side before it (0 to
 * 180, 90 for a right angle), or with the horizontal for the first side (0 to 180).
 */
export function sideAngle(from: Point, to: Point, before?: Point): number {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  if (!before) return Math.round((Math.abs(a) * 180) / Math.PI);
  const b = Math.atan2(before.y - from.y, before.x - from.x);
  let turn = Math.abs(a - b);
  if (turn > Math.PI) turn = 2 * Math.PI - turn;
  return Math.round((turn * 180) / Math.PI);
}

/** Points in view units as a wall's `points`: grid units, kept on the drawing. */
export function toWallPoints(points: readonly Point[]): number[] {
  const grid = (v: number, size: number) =>
    Math.max(0, Math.min(STROKE_GRID, Math.round((v / size) * STROKE_GRID)));
  return points.flatMap((p) => [grid(p.x, PLAN_VIEW_W), grid(p.y, PLAN_VIEW_H)]);
}

/** The sides of a wall's path, each with where it starts and ends along the wall. */
function sides(wall: Pick<PlanWall, 'points' | 'closed'>) {
  const pts = path(wall);
  const out: Array<{ a: Point; b: Point; from: number; to: number }> = [];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = dist(a, b);
    out.push({ a, b, from: walked, to: walked + len });
    walked += len;
  }
  return out;
}

/** The side of a wall `at` view units along it, by its index. */
function sideAt(wall: Pick<PlanWall, 'points' | 'closed'>, at: number) {
  const list = sides(wall);
  const found = list.findIndex((s) => at <= s.to + 1e-9);
  return { index: found < 0 ? list.length - 1 : found, list };
}

/**
 * Where an opening `width` wide goes on a wall for a pointer at `p` (view units): its `at`, on
 * the side of the wall nearest the pointer, kept whole on that side so it never runs round a
 * corner; in the middle of a side shorter than it.
 */
export function openingPlace(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  p: Point,
  width: number,
): number {
  const near = nearestOnWall(wall, p);
  const { index, list } = sideAt(wall, near.at);
  const side = list[index];
  if (!side) return near.at;
  const lo = side.from + width / 2;
  const hi = side.to - width / 2;
  return lo > hi ? (side.from + side.to) / 2 : Math.max(lo, Math.min(hi, near.at));
}

/**
 * How far an opening's gap is from the two corners of its side (view units): what the Openings
 * tool shows while it places or moves one.
 */
export function openingCorners(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  opening: Pick<PlanOpening, 'at' | 'width'>,
): { before: number; after: number } {
  const span = openingSpan(wall, opening);
  const { index, list } = sideAt(wall, (span.from + span.to) / 2);
  const side = list[index];
  if (!side) return { before: 0, after: 0 };
  return { before: Math.max(0, span.from - side.from), after: Math.max(0, side.to - span.to) };
}

/**
 * A wall with corner `index` moved to `p` (view units), and its openings kept where they were
 * on their own side: at the same share of its length.
 */
export function moveWallCorner(
  wall: PlanWall,
  index: number,
  p: Point,
  openings: readonly PlanOpening[],
): { wall: PlanWall; openings: PlanOpening[] } {
  const points = [...wall.points];
  const [gx, gy] = toWallPoints([p]) as [number, number];
  points[index * 2] = gx;
  points[index * 2 + 1] = gy;
  const moved = { ...wall, points };
  const before = sides(wall);
  const after = sides(moved);
  const next = openings
    .filter((o) => o.wall === wall.id)
    .map((o) => {
      const { index: i } = sideAt(wall, o.at);
      const a = before[i];
      const b = after[i];
      if (!a || !b) return o;
      const share = a.to > a.from ? (o.at - a.from) / (a.to - a.from) : 0.5;
      return { ...o, at: Math.round((b.from + share * (b.to - b.from)) * 100) / 100 };
    });
  return { wall: moved, openings: next };
}

/**
 * The walls and openings of `source` added to plan `targetId` with new ids, each opening in the
 * copy of its wall: how a plan reuses the set of another (one transaction, one undo step).
 */
export function copyPlanWalls(
  doc: Y.Doc,
  source: Pick<PlanElement, 'walls' | 'openings'>,
  targetId: string,
  origin?: unknown,
): void {
  doc.transact(() => {
    const walls = listOf(doc, targetId, 'walls');
    const openings = listOf(doc, targetId, 'openings');
    if (!walls || !openings) return;
    const fresh = new Map<string, string>();
    for (const wall of source.walls ?? []) {
      if (walls.length >= MAX_PLAN_WALLS) break;
      const id = newElementId();
      fresh.set(wall.id, id);
      const { group: _group, ...rest } = wall;
      walls.push([toMap({ ...rest, id })]);
    }
    for (const o of source.openings ?? []) {
      const wall = fresh.get(o.wall);
      if (!wall || openings.length >= MAX_PLAN_OPENINGS) continue;
      openings.push([toMap({ ...o, id: newElementId(), wall })]);
    }
  }, origin);
}

// Circuits ------------------------------------------------------------------------
//
// A plan's circuits are Y.Maps in a Y.Array too, so two people renaming two circuits, or one
// renaming a circuit while another changes its breaker, both keep their change (decision 0104).

/** Adds a circuit; its id, or null when the plan already has MAX_PLAN_CIRCUITS. */
export function addPlanCircuit(
  doc: Y.Doc,
  planId: string,
  circuit: Omit<PlanCircuit, 'id'>,
  origin?: unknown,
): string | null {
  return addTo(doc, planId, 'circuits', circuit, MAX_PLAN_CIRCUITS, origin);
}

/** Writes circuits, matched by id, field by field (only what differs from what is stored). */
export function updatePlanCircuits(
  doc: Y.Doc,
  planId: string,
  circuits: readonly PlanCircuit[],
  origin?: unknown,
): void {
  updateList(doc, planId, 'circuits', circuits, origin);
}

/** Removes circuits by id; lights on a removed circuit count as on none. */
export function removePlanCircuits(
  doc: Y.Doc,
  planId: string,
  ids: Iterable<string>,
  origin?: unknown,
): void {
  const doomed = new Set(ids);
  doc.transact(() => {
    const list = listOf(doc, planId, 'circuits');
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--)
      if (doomed.has(idOf(list.get(i)) as string)) list.delete(i, 1);
  }, origin);
}
