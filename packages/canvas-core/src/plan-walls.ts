// SPDX-License-Identifier: MPL-2.0
import {
  MAX_PLAN_OPENINGS,
  MAX_PLAN_WALLS,
  newElementId,
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

/** The part of a wall's path from `from` to `to` view units along it, as a polyline. */
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
    if (e < from || s > to || len === 0) continue;
    const at = (d: number) => ({
      x: a.x + ((b.x - a.x) * (d - s)) / len,
      y: a.y + ((b.y - a.y) * (d - s)) / len,
    });
    if (out.length === 0) out.push(at(Math.max(s, from)));
    out.push(at(Math.min(e, to)));
  }
  return out;
}

/** Where an opening's gap runs along its wall, in view units from the wall's first point. */
export function openingSpan(
  wall: Pick<PlanWall, 'points' | 'closed'>,
  opening: Pick<PlanOpening, 'at' | 'width'>,
): { from: number; to: number } {
  const length = wallLength(wall);
  const width = Math.min(opening.width, length);
  const middle = Math.max(width / 2, Math.min(length - width / 2, opening.at));
  return { from: middle - width / 2, to: middle + width / 2 };
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
export function pieceOutline(piece: readonly Point[], thickness: number): Point[] {
  const half = thickness / 2;
  const n = piece.length;
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
      const len = Math.hypot(sum.x, sum.y) || 1;
      m = { x: sum.x / len, y: sum.y / len };
      const cos = m.x * after.x + m.y * after.y;
      k = Math.min(half * 4, half / Math.max(0.05, cos));
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

function listOf(doc: Y.Doc, planId: string, key: 'walls' | 'openings'): Y.Array<unknown> | null {
  const map = roots(doc).elements.get(planId);
  if (map?.get('type') !== 'plan') return null;
  const current = map.get(key);
  if (current instanceof Y.Array) return current;
  const fresh = new Y.Array<unknown>();
  map.set(key, fresh);
  return fresh;
}

/** Adds a wall; its id, or null when the plan already has MAX_PLAN_WALLS. */
export function addPlanWall(
  doc: Y.Doc,
  planId: string,
  wall: Omit<PlanWall, 'id'>,
  origin?: unknown,
): string | null {
  const list = listOf(doc, planId, 'walls');
  if (!list || list.length >= MAX_PLAN_WALLS) return null;
  const id = newElementId();
  doc.transact(() => list.push([{ ...wall, id }]), origin);
  return id;
}

/** Adds an opening to a wall; its id, or null when the plan already has MAX_PLAN_OPENINGS. */
export function addPlanOpening(
  doc: Y.Doc,
  planId: string,
  opening: Omit<PlanOpening, 'id'>,
  origin?: unknown,
): string | null {
  const list = listOf(doc, planId, 'openings');
  if (!list || list.length >= MAX_PLAN_OPENINGS) return null;
  const id = newElementId();
  doc.transact(() => list.push([{ ...opening, id }]), origin);
  return id;
}

/** Replaces walls or openings by id, where they are in their list. */
export function updatePlanWalls(
  doc: Y.Doc,
  planId: string,
  key: 'walls' | 'openings',
  items: ReadonlyArray<PlanWall | PlanOpening>,
  origin?: unknown,
): void {
  const byId = new Map(items.map((i) => [i.id, i]));
  doc.transact(() => {
    const list = listOf(doc, planId, key);
    if (!list) return;
    list.toArray().forEach((value, index) => {
      const next = byId.get((value as { id?: string }).id ?? '');
      if (!next) return;
      list.delete(index, 1);
      list.insert(index, [{ ...(value as object), ...next }]);
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
      const list = listOf(doc, planId, key);
      if (!list) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list.get(i) as { id?: string; wall?: string };
        if (doomed.has(item.id ?? '') || (key === 'openings' && doomed.has(item.wall ?? '')))
          list.delete(i, 1);
      }
    }
  }, origin);
}
