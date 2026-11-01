// SPDX-License-Identifier: MPL-2.0
import {
  type Element,
  type FrameShape,
  MAX_PLAN_ICONS,
  MAX_SHAPES,
  MAX_STROKES,
  newElementId,
  PLAN_ASPECT,
  type PlanIcon,
  type PlanIconKind,
  roots,
  STROKE_GRID,
  type Stroke,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { shapeHit, strokeHit } from './film.ts';
import type { Point } from './geometry.ts';

/**
 * Set plans (decision 0062): strokes and shapes as on frame drawings, plus set icons. Points
 * relative to the drawing go from 0 to 1 on both axes; the drawing is PLAN_ASPECT wide per unit
 * of height, so "view units" (thousandths of the width) measure both axes alike.
 */

export type PlanElement = Extract<Element, { type: 'plan' }>;
/** A stroke, a shape or an icon of a plan, by the array it lives in. */
export type PlanItemKind = 'strokes' | 'shapes' | 'icons';
export interface PlanItemRef {
  kind: PlanItemKind;
  id: string;
}

/** Width of the drawing in view units; its height is PLAN_VIEW_W / PLAN_ASPECT. */
export const PLAN_VIEW_W = 1000;
export const PLAN_VIEW_H = PLAN_VIEW_W / PLAN_ASPECT;
/** Spacing of the plan's own grid, in view units. */
export const PLAN_GRID = 25;
/** Degrees the rotate button and the R key turn an item by. */
export const ROTATE_STEP = 15;

export function normalizeRotation(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** A point of the drawing (0 to 1) on the nearest crossing of the plan grid. */
export function snapPlanPoint(p: Point): Point {
  const sx = PLAN_GRID / PLAN_VIEW_W;
  const sy = PLAN_GRID / PLAN_VIEW_H;
  return {
    x: Math.min(1, Math.max(0, Math.round(p.x / sx) * sx)),
    y: Math.min(1, Math.max(0, Math.round(p.y / sy) * sy)),
  };
}

const clampGrid = (n: number) => Math.round(Math.max(0, Math.min(STROKE_GRID, n)));

// Geometry of the set icons ------------------------------------------------------

/** How a part of an icon is painted: in the icon's colour, a wash of it, or the card's surfaces. */
export type PlanPaint = 'ink' | 'soft' | 'wash' | 'faint' | 'muted' | 'surface' | 'raised';

/**
 * A part of an icon in view units around its centre, facing right (rotation 0): a polyline
 * (closed when `closed`) or a circle. `beam` marks a camera's view cone or a light's beam,
 * which neither selects nor counts in the icon's box.
 */
export interface PlanPart {
  points?: number[];
  circle?: { cx: number; cy: number; r: number };
  closed?: boolean;
  fill?: PlanPaint;
  stroke?: PlanPaint;
  width: number;
  dash?: boolean;
  beam?: boolean;
}

/** View units per unit of the icon drawings below (drawn on a 400-wide plan). */
const S = PLAN_VIEW_W / 400;
/** A camera's view cone: fixed in this version, not adjustable (decision 0062). */
export const CAMERA_CONE = { length: 125, halfAngle: 20 } as const;
const LIGHT_BEAM = { length: 100, halfAngle: 14 } as const;

const scale = (points: number[]) => points.map((v) => v * S);
const box = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

function cone(apex: number, spec: { length: number; halfAngle: number }): PlanPart {
  const a = (spec.halfAngle * Math.PI) / 180;
  const far = apex + spec.length * Math.cos(a);
  const side = spec.length * Math.sin(a);
  return {
    points: scale([apex, 0, far, -side, far, side]),
    closed: true,
    fill: 'wash',
    stroke: 'faint',
    width: 1 * S,
    beam: true,
  };
}

function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 8): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  return out;
}

const PARTS: Record<PlanIconKind, PlanPart[]> = {
  camera: [
    cone(14, CAMERA_CONE),
    {
      points: scale(box(-10, -7, 8, 7)),
      closed: true,
      fill: 'surface',
      stroke: 'ink',
      width: 2 * S,
    },
    {
      points: scale([8, -4, 14, -7, 14, 7, 8, 4]),
      closed: true,
      fill: 'ink',
      stroke: 'ink',
      width: 1.5 * S,
    },
  ],
  light: [
    cone(9, LIGHT_BEAM),
    { circle: { cx: 0, cy: 0, r: 9 * S }, fill: 'surface', stroke: 'ink', width: 2 * S },
    { points: scale([-5, 0, 5, 0]), stroke: 'ink', width: 1.5 * S },
    { points: scale([0, -5, 0, 5]), stroke: 'ink', width: 1.5 * S },
  ],
  actor: [
    { circle: { cx: 0, cy: 0, r: 9 * S }, fill: 'soft', stroke: 'ink', width: 2 * S },
    {
      points: scale([8, -5, 16, 0, 8, 5]),
      closed: true,
      fill: 'ink',
      stroke: 'ink',
      width: 1.5 * S,
    },
  ],
  door: [
    { points: scale([-18, 18, -18, -18]), stroke: 'ink', width: 1.5 * S },
    { points: scale(arc(-18, 18, 36, -90, 0)), stroke: 'muted', width: 1 * S, dash: true },
  ],
  window: [
    {
      points: scale(box(-42, -4, 42, 4)),
      closed: true,
      fill: 'surface',
      stroke: 'ink',
      width: 1.5 * S,
    },
    { points: scale([-42, 0, 42, 0]), stroke: 'ink', width: 1 * S },
  ],
  table: [
    {
      points: scale(box(-36, -21, 36, 21)),
      closed: true,
      fill: 'raised',
      stroke: 'ink',
      width: 1.5 * S,
    },
  ],
  track: [
    { points: scale([-64, -5, 64, -5]), stroke: 'ink', width: 1.5 * S },
    { points: scale([-64, 5, 64, 5]), stroke: 'ink', width: 1.5 * S },
    ...Array.from({ length: 10 }, (_, i) => ({
      points: scale([-54 + i * 12, -5, -54 + i * 12, 5]),
      stroke: 'ink' as const,
      width: 1 * S,
    })),
  ],
};

export function planIconParts(kind: PlanIconKind): readonly PlanPart[] {
  return PARTS[kind];
}

/** Centre of an icon in view units. */
export function iconCentre(icon: Pick<PlanIcon, 'x' | 'y'>): Point {
  return { x: (icon.x / STROKE_GRID) * PLAN_VIEW_W, y: (icon.y / STROKE_GRID) * PLAN_VIEW_H };
}

function turn(p: Point, degrees: number): Point {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Half the size of an icon's body (without its cone), unrotated, in view units. */
export function iconExtent(kind: PlanIconKind): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const part of PARTS[kind]) {
    if (part.beam) continue;
    if (part.circle) {
      w = Math.max(w, Math.abs(part.circle.cx) + part.circle.r);
      h = Math.max(h, Math.abs(part.circle.cy) + part.circle.r);
    }
    const pts = part.points ?? [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      w = Math.max(w, Math.abs(pts[i] as number));
      h = Math.max(h, Math.abs(pts[i + 1] as number));
    }
  }
  return { w, h };
}

/** True when `p` (view units) is on the body of the icon, its cone left out. */
export function iconHit(icon: PlanIcon, p: Point, slack = 6): boolean {
  const c = iconCentre(icon);
  const local = turn({ x: p.x - c.x, y: p.y - c.y }, -(icon.rotation ?? 0));
  const e = iconExtent(icon.kind);
  return Math.abs(local.x) <= e.w + slack && Math.abs(local.y) <= e.h + slack;
}

/** Where an icon's label sits, below its body whatever the rotation, in view units. */
export function labelAnchor(icon: PlanIcon): Point {
  const c = iconCentre(icon);
  const e = iconExtent(icon.kind);
  const t = ((icon.rotation ?? 0) * Math.PI) / 180;
  const below = Math.abs(e.w * Math.sin(t)) + Math.abs(e.h * Math.cos(t));
  return { x: c.x, y: c.y + below + 26 };
}

// Moving, turning and finding items ---------------------------------------------

/** Converts a move in view units to STROKE_GRID units. */
function gridDelta(d: Point): Point {
  return { x: (d.x / PLAN_VIEW_W) * STROKE_GRID, y: (d.y / PLAN_VIEW_H) * STROKE_GRID };
}

/** Turns grid points around a centre (grid units), measuring both axes in view units. */
function turnGrid(points: readonly number[], centre: Point, degrees: number): number[] {
  const kx = PLAN_VIEW_W / STROKE_GRID;
  const ky = PLAN_VIEW_H / STROKE_GRID;
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const q = turn(
      {
        x: ((points[i] as number) - centre.x) * kx,
        y: ((points[i + 1] as number) - centre.y) * ky,
      },
      degrees,
    );
    out.push(clampGrid(centre.x + q.x / kx), clampGrid(centre.y + q.y / ky));
  }
  return out;
}

function middle(points: readonly number[]): Point {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i += 2) {
    x0 = Math.min(x0, points[i] as number);
    x1 = Math.max(x1, points[i] as number);
    y0 = Math.min(y0, points[i + 1] as number);
    y1 = Math.max(y1, points[i + 1] as number);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Moves a stroke, a shape or an icon by `d` view units, kept inside the drawing. */
export function moveItem<T extends Stroke | FrameShape | PlanIcon>(item: T, d: Point): T {
  const g = gridDelta(d);
  if ('points' in item)
    return {
      ...item,
      points: item.points.map((v, i) => clampGrid(v + (i % 2 === 0 ? g.x : g.y))),
    };
  if ('x0' in item)
    return {
      ...item,
      x0: clampGrid(item.x0 + g.x),
      y0: clampGrid(item.y0 + g.y),
      x1: clampGrid(item.x1 + g.x),
      y1: clampGrid(item.y1 + g.y),
    };
  return { ...item, x: clampGrid(item.x + g.x), y: clampGrid(item.y + g.y) };
}

/**
 * Whether an item turns: icons, strokes, lines and arrows do; rectangles and ellipses stay
 * upright (their shapes have no angle), and so do texts.
 */
export function canRotate(item: Stroke | FrameShape | PlanIcon): boolean {
  return !('x0' in item) || item.kind === 'line' || item.kind === 'arrow';
}

/** Turns an item clockwise by `degrees` around its centre; items that cannot turn stay. */
export function rotateItem<T extends Stroke | FrameShape | PlanIcon>(item: T, degrees: number): T {
  if (!canRotate(item)) return item;
  if ('points' in item) {
    return { ...item, points: turnGrid(item.points, middle(item.points), degrees) };
  }
  if ('x0' in item) {
    const pts = [item.x0, item.y0, item.x1, item.y1];
    const [x0, y0, x1, y1] = turnGrid(pts, middle(pts), degrees) as [
      number,
      number,
      number,
      number,
    ];
    return { ...item, x0, y0, x1, y1 };
  }
  const rotation = normalizeRotation((item.rotation ?? 0) + degrees);
  const turned = { ...item, rotation };
  if (rotation === 0) delete (turned as Partial<PlanIcon>).rotation;
  return turned;
}

/** The item drawn on top under `p` (relative to the drawing, 0 to 1): icons, shapes, strokes. */
export function planItemAt(plan: PlanElement, p: Point, radius = 0.012): PlanItemRef | null {
  const view = { x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H };
  const icons = plan.icons ?? [];
  for (let i = icons.length - 1; i >= 0; i--) {
    const icon = icons[i] as PlanIcon;
    if (iconHit(icon, view)) return { kind: 'icons', id: icon.id };
  }
  const shapes = plan.shapes ?? [];
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i] as FrameShape;
    if (shapeHit(shape, p, radius, PLAN_ASPECT)) return { kind: 'shapes', id: shape.id };
  }
  const strokes = plan.strokes ?? [];
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i] as Stroke;
    if (strokeHit(stroke, p, radius)) return { kind: 'strokes', id: stroke.id };
  }
  return null;
}

/** The item a reference points at, if it is still there. */
export function planItem(
  plan: PlanElement,
  ref: PlanItemRef,
): Stroke | FrameShape | PlanIcon | undefined {
  const list = (plan[ref.kind] ?? []) as ReadonlyArray<Stroke | FrameShape | PlanIcon>;
  return list.find((item) => item.id === ref.id);
}

// Writing to the document --------------------------------------------------------

function listOf(doc: Y.Doc, planId: string, kind: PlanItemKind): Y.Array<unknown> | null {
  const map = roots(doc).elements.get(planId);
  if (map?.get('type') !== 'plan') return null;
  const current = map.get(kind);
  if (current instanceof Y.Array) return current;
  const fresh = new Y.Array<unknown>();
  map.set(kind, fresh);
  return fresh;
}

const idOf = (value: unknown) =>
  value instanceof Y.Map ? value.get('id') : (value as { id?: unknown } | null)?.id;

const LIMITS: Record<PlanItemKind, number> = {
  strokes: MAX_STROKES,
  shapes: MAX_SHAPES,
  icons: MAX_PLAN_ICONS,
};

/** Adds a set icon; null when the plan is full. */
export function addPlanIcon(
  doc: Y.Doc,
  planId: string,
  icon: Omit<PlanIcon, 'id'>,
  origin?: unknown,
): string | null {
  const icons = listOf(doc, planId, 'icons');
  if (!icons || icons.length >= MAX_PLAN_ICONS) return null;
  const id = newElementId();
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    for (const [key, value] of Object.entries({ ...icon, id }))
      if (value !== undefined) map.set(key, value);
    icons.push([map]);
  }, origin);
  return id;
}

/**
 * Writes new versions of items, matched by id. Icons change field by field, so two people
 * editing one icon merge; strokes and shapes are replaced where they are.
 */
export function updatePlanItems(
  doc: Y.Doc,
  planId: string,
  items: ReadonlyArray<Stroke | FrameShape | PlanIcon>,
  origin?: unknown,
): void {
  const byId = new Map(items.map((item) => [item.id, item]));
  doc.transact(() => {
    for (const kind of ['strokes', 'shapes', 'icons'] as const) {
      const list = listOf(doc, planId, kind);
      if (!list) return;
      list.toArray().forEach((value, index) => {
        const next = byId.get(idOf(value) as string);
        if (!next) return;
        if (value instanceof Y.Map) {
          for (const key of [...value.keys()])
            if (!(key in next) || (next as Record<string, unknown>)[key] === undefined)
              value.delete(key);
          for (const [key, v] of Object.entries(next))
            if (v !== undefined && value.get(key) !== v) value.set(key, v);
        } else {
          list.delete(index, 1);
          list.insert(index, [next]);
        }
      });
    }
  }, origin);
}

export function removePlanItems(
  doc: Y.Doc,
  planId: string,
  ids: Iterable<string>,
  origin?: unknown,
): void {
  const doomed = new Set(ids);
  doc.transact(() => {
    for (const kind of ['strokes', 'shapes', 'icons'] as const) {
      const list = listOf(doc, planId, kind);
      if (!list) return;
      for (let i = list.length - 1; i >= 0; i--)
        if (doomed.has(idOf(list.get(i)) as string)) list.delete(i, 1);
    }
  }, origin);
}

/** Copies items next to the originals, `offset` view units away. Returns the copies. */
export function duplicatePlanItems(
  doc: Y.Doc,
  plan: PlanElement,
  refs: readonly PlanItemRef[],
  offset: Point,
  origin?: unknown,
): PlanItemRef[] {
  const out: PlanItemRef[] = [];
  doc.transact(() => {
    for (const ref of refs) {
      const item = planItem(plan, ref);
      const list = listOf(doc, plan.id, ref.kind);
      if (!item || !list || list.length >= LIMITS[ref.kind]) continue;
      const copy = { ...moveItem(item, offset), id: newElementId() };
      if (ref.kind === 'icons') {
        const map = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(copy)) map.set(key, value);
        list.push([map]);
      } else list.push([copy]);
      out.push({ kind: ref.kind, id: copy.id });
    }
  }, origin);
  return out;
}
