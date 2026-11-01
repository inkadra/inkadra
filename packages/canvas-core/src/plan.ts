// SPDX-License-Identifier: MPL-2.0
import {
  type Element,
  type FrameShape,
  MAX_PLAN_ICONS,
  MAX_SHAPES,
  MAX_STROKES,
  newElementId,
  PLAN_ASPECT,
  PLAN_SENSORS,
  type PlanIcon,
  type PlanLayer,
  type PlanSensor,
  type PlanShape,
  type PlanStroke,
  roots,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { shapeHit, strokeHit } from './film.ts';
import type { Point } from './geometry.ts';
import { BEAM_KINDS, categoryOf, GLYPH_FACING, glyphBox, glyphOf } from './plan-icons.ts';

/**
 * Set plans (decision 0062): strokes and shapes as on frame drawings, plus set icons. Points
 * relative to the drawing go from 0 to 1 on both axes; the drawing is PLAN_ASPECT wide per unit
 * of height, so "view units" (thousandths of the width) measure both axes alike.
 */

export type PlanElement = Extract<Element, { type: 'plan' }>;
/** A stroke, a shape or an icon of a plan. */
export type PlanItem = PlanStroke | PlanShape | PlanIcon;
/** A stroke, a shape or an icon of a plan, by the array it lives in. */
export type PlanItemKind = 'strokes' | 'shapes' | 'icons';
export interface PlanItemRef {
  kind: PlanItemKind;
  id: string;
}

/** Width of the drawing in view units; its height is PLAN_VIEW_W / PLAN_ASPECT. */
export const PLAN_VIEW_W = 1000;
export const PLAN_VIEW_H = PLAN_VIEW_W / PLAN_ASPECT;
/** Spacing of the plan's own grid, in view units, when it has no real scale. */
export const PLAN_GRID = 25;
/** Degrees the rotate button and the R key turn an item by. */
export const ROTATE_STEP = 15;
/** Longest side of a symbol (lights, cameras, people…) in view units, by size. */
export const SYMBOL_SIZES = { S: 32, M: 44, L: 60 } as const;
/** Default lens of a camera, in mm: about the 40° cone of version 14 on Super 35. */
export const DEFAULT_LENS = 35;
const DEFAULT_REACH = { cone: 312, beam: 250 };
const DEFAULT_BEAM = 30;

export function normalizeRotation(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** Grid step in view units: the metres of a scaled plan, or PLAN_GRID. */
export function gridStep(plan: Pick<PlanElement, 'scale' | 'grid'>): number {
  return plan.scale ? plan.scale * Number(plan.grid ?? '0.5') : PLAN_GRID;
}

/** A point of the drawing (0 to 1) on the nearest crossing of the plan grid. */
export function snapPlanPoint(p: Point, step = PLAN_GRID): Point {
  const sx = step / PLAN_VIEW_W;
  const sy = step / PLAN_VIEW_H;
  return {
    x: Math.min(1, Math.max(0, Math.round(p.x / sx) * sx)),
    y: Math.min(1, Math.max(0, Math.round(p.y / sy) * sy)),
  };
}

const clampGrid = (n: number) => Math.round(Math.max(0, Math.min(STROKE_GRID, n)));

/** The layer an item is on: its own, or its family's (icons) or Set (strokes and shapes). */
export function layerOf(item: PlanItem): PlanLayer {
  if (item.layer) return item.layer;
  if ('kind' in item && 'x' in item) return categoryOf(item.kind).layer;
  if ('kind' in item && (item.kind === 'measure' || item.kind === 'text')) return 'notes';
  return 'set';
}

// Icons ---------------------------------------------------------------------------

function turn(p: Point, degrees: number): Point {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Centre of an icon in view units. */
export function iconCentre(icon: Pick<PlanIcon, 'x' | 'y'>): Point {
  return { x: (icon.x / STROKE_GRID) * PLAN_VIEW_W, y: (icon.y / STROKE_GRID) * PLAN_VIEW_H };
}

/** Width and depth of an icon's drawing, unturned, in view units. */
export function iconSize(icon: Pick<PlanIcon, 'kind' | 'size' | 'w' | 'h'>): {
  w: number;
  h: number;
} {
  const box = glyphBox(glyphOf(icon.kind));
  if (categoryOf(icon.kind).sized && icon.w && icon.h) return { w: icon.w, h: icon.h };
  const long = categoryOf(icon.kind).sized ? 64 : SYMBOL_SIZES[icon.size ?? 'M'];
  const k = long / Math.max(box.w, box.h);
  return { w: icon.w ?? box.w * k, h: icon.h ?? box.h * k };
}

/** Angle the glyph of an icon is drawn at: where it faces, less where its drawing faces. */
export function iconAngle(icon: Pick<PlanIcon, 'kind' | 'rotation'>): number {
  return (icon.rotation ?? 0) - (GLYPH_FACING[icon.kind] ?? 0);
}

/**
 * How the glyph of an icon lands on the plan: a glyph point p goes to
 * centre + turn((p - origin) · scale, angle), in view units. Sizes are along the drawing.
 */
export function iconTransform(icon: PlanIcon): {
  centre: Point;
  origin: Point;
  sx: number;
  sy: number;
  angle: number;
} {
  const box = glyphBox(glyphOf(icon.kind));
  const size = iconSize(icon);
  return {
    centre: iconCentre(icon),
    origin: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    sx: size.w / box.w,
    sy: size.h / box.h,
    angle: iconAngle(icon),
  };
}

/** A glyph point of an icon in view units. */
export function iconPoint(t: ReturnType<typeof iconTransform>, x: number, y: number): Point {
  const q = turn({ x: (x - t.origin.x) * t.sx, y: (y - t.origin.y) * t.sy }, t.angle);
  return { x: t.centre.x + q.x, y: t.centre.y + q.y };
}

/** True when `p` (view units) is on the body of the icon, its cone left out. */
export function iconHit(icon: PlanIcon, p: Point, slack = 6): boolean {
  const c = iconCentre(icon);
  const local = turn({ x: p.x - c.x, y: p.y - c.y }, -iconAngle(icon));
  const s = iconSize(icon);
  return Math.abs(local.x) <= s.w / 2 + slack && Math.abs(local.y) <= s.h / 2 + slack;
}

/** Box of an icon turned, around its centre, in view units. */
export function iconBounds(icon: PlanIcon): { x: number; y: number; w: number; h: number } {
  const c = iconCentre(icon);
  const s = iconSize(icon);
  const t = (iconAngle(icon) * Math.PI) / 180;
  const w = Math.abs(s.w * Math.cos(t)) + Math.abs(s.h * Math.sin(t));
  const h = Math.abs(s.w * Math.sin(t)) + Math.abs(s.h * Math.cos(t));
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

/** Where an icon's label sits, below its body whatever the rotation, in view units. */
export function labelAnchor(icon: PlanIcon): Point {
  const b = iconBounds(icon);
  return { x: b.x + b.w / 2, y: b.y + b.h + 18 };
}

/** Horizontal angle of view of a lens on a sensor, in degrees. */
export function lensAngle(lens: number, sensor: PlanSensor = 's35'): number {
  return (2 * Math.atan(PLAN_SENSORS[sensor] / (2 * lens)) * 180) / Math.PI;
}

/**
 * A camera's view cone or a light's beam: the triangle from the front of the icon, `reach`
 * long, `angle` wide, in view units. Null for icons without one.
 */
export function iconCone(
  icon: PlanIcon,
  sensor?: PlanSensor,
): { points: [Point, Point, Point]; angle: number; reach: number; beam: boolean } | null {
  const beam = BEAM_KINDS.has(icon.kind);
  if (!beam && icon.kind !== 'camera') return null;
  const angle = beam ? (icon.beam ?? DEFAULT_BEAM) : lensAngle(icon.lens ?? DEFAULT_LENS, sensor);
  const reach = icon.reach ?? (beam ? DEFAULT_REACH.beam : DEFAULT_REACH.cone);
  const c = iconCentre(icon);
  const size = iconSize(icon);
  const front = (GLYPH_FACING[icon.kind] ?? 0) % 180 === 0 ? size.w / 2 : size.h / 2;
  const at = (dist: number, deg: number) => {
    const q = turn({ x: dist, y: 0 }, (icon.rotation ?? 0) + deg);
    return { x: c.x + q.x, y: c.y + q.y };
  };
  return {
    points: [at(front, 0), at(front + reach, -angle / 2), at(front + reach, angle / 2)],
    angle,
    reach,
    beam,
  };
}

// Blocking ------------------------------------------------------------------------

/** The positions of an icon in blocking, first first, ending where it stands; view units. */
export function blockingPositions(icon: PlanIcon): Point[] {
  return [
    ...(icon.steps ?? []).map((s) => ({
      x: (s.x / STROKE_GRID) * PLAN_VIEW_W,
      y: (s.y / STROKE_GRID) * PLAN_VIEW_H,
    })),
    iconCentre(icon),
  ];
}

/**
 * The move from `a` to `b`, bowed by `bend` view units at its middle (positive to the left of
 * the way), as a quadratic curve: its control point and its middle.
 */
export function blockingCurve(a: Point, b: Point, bend = 0): { control: Point; middle: Point } {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return {
    control: { x: mid.x + n.x * bend * 2, y: mid.y + n.y * bend * 2 },
    middle: { x: mid.x + n.x * bend, y: mid.y + n.y * bend },
  };
}

/** The bend that puts the middle of the move from `a` to `b` through `p`. */
export function bendThrough(a: Point, b: Point, p: Point): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return Math.max(-1000, Math.min(1000, (p.x - mid.x) * n.x + (p.y - mid.y) * n.y));
}

/** Points along a quadratic curve, for exports. */
export function curvePoints(a: Point, control: Point, b: Point, steps = 16): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
    };
  });
}

/**
 * The icon moved on to `to` (relative to the drawing): where it stood becomes its last step.
 * People turn to face the way they walk; cameras keep their direction.
 */
export function addBlockingStep(icon: PlanIcon, to: Point): PlanIcon {
  const from = iconCentre(icon);
  const at = { x: to.x * PLAN_VIEW_W, y: to.y * PLAN_VIEW_H };
  const step = {
    x: icon.x,
    y: icon.y,
    ...(icon.rotation ? { rotation: icon.rotation } : {}),
    ...(icon.note ? { note: icon.note } : {}),
  };
  const next: PlanIcon = {
    ...icon,
    x: clampGrid(to.x * STROKE_GRID),
    y: clampGrid(to.y * STROKE_GRID),
    steps: [...(icon.steps ?? []), step].slice(-30),
  };
  delete next.note;
  if (categoryOf(icon.kind).family === 'person') {
    const facing = normalizeRotation((Math.atan2(at.y - from.y, at.x - from.x) * 180) / Math.PI);
    if (facing) next.rotation = facing;
    else delete next.rotation;
  }
  return next;
}

// Resizing ------------------------------------------------------------------------

/** A handle of the selection box: corners and sides. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * The box an item resizes in: its middle, its size along its own axes and the angle those
 * axes are turned by, in view units. Null for items that do not resize (strokes, lines,
 * arrows and measures, which move their ends instead).
 */
export function itemFrame(
  item: PlanItem,
): { centre: Point; w: number; h: number; angle: number } | null {
  if ('x' in item) {
    const size = iconSize(item);
    return { centre: iconCentre(item), w: size.w, h: size.h, angle: iconAngle(item) };
  }
  if ('points' in item || !TURNED.has(item.kind)) return null;
  const a = { x: item.x0 * kx, y: item.y0 * ky };
  const b =
    item.kind === 'text'
      ? { x: a.x + item.width * 0.6 * (item.text?.length ?? 1), y: a.y - item.width }
      : { x: item.x1 * kx, y: item.y1 * ky };
  return {
    centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
    angle: item.rotation ?? 0,
  };
}

const SIGN: Record<ResizeHandle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

/**
 * The item with its `handle` dragged to `p` (view units). The opposite side stays, or the
 * middle with `fromCentre`; `keepRatio` keeps the proportions. Furniture takes any width and
 * depth; symbols snap to S, M or L; texts to the three font sizes in `textSizes`.
 */
export function resizeItem<T extends PlanItem>(
  item: T,
  handle: ResizeHandle,
  p: Point,
  opts: { keepRatio?: boolean; fromCentre?: boolean; textSizes?: readonly number[] } = {},
): T {
  const f = itemFrame(item);
  if (!f) return item;
  const [sx, sy] = SIGN[handle];
  const q = turn({ x: p.x - f.centre.x, y: p.y - f.centre.y }, -f.angle);
  const fixed = {
    x: opts.fromCentre ? 0 : -sx * (f.w / 2),
    y: opts.fromCentre ? 0 : -sy * (f.h / 2),
  };
  const k = opts.fromCentre ? 2 : 1;
  let w = sx ? Math.max(8, Math.abs(q.x - fixed.x) * k) : f.w;
  let h = sy ? Math.max(8, Math.abs(q.y - fixed.y) * k) : f.h;
  if (opts.keepRatio && sx && sy) {
    const r = Math.max(w / f.w, h / f.h);
    w = f.w * r;
    h = f.h * r;
  }
  const local = opts.fromCentre
    ? { x: 0, y: 0 }
    : { x: fixed.x + (sx * w) / 2, y: fixed.y + (sy * h) / 2 };
  const off = turn(local, f.angle);
  const centre = { x: f.centre.x + off.x, y: f.centre.y + off.y };
  if ('x' in item) {
    if (categoryOf(item.kind).sized)
      return {
        ...item,
        w: Math.round(w * 10) / 10,
        h: Math.round(h * 10) / 10,
        x: clampGrid(centre.x / kx),
        y: clampGrid(centre.y / ky),
      };
    // Symbols keep their middle and pick the nearest of the three sizes.
    const long = Math.max(f.w, f.h) * Math.max(w / f.w, h / f.h);
    const sizes = Object.entries(SYMBOL_SIZES) as Array<['S' | 'M' | 'L', number]>;
    const [size] = sizes.reduce((best, s) =>
      Math.abs(s[1] - long) < Math.abs(best[1] - long) ? s : best,
    );
    const next = { ...item, size };
    if (size === 'M') delete (next as Partial<PlanIcon>).size;
    return next;
  }
  if ('x0' in item && item.kind === 'text') {
    const sizes = opts.textSizes ?? [item.width];
    const want = (h / f.h) * item.width;
    const width = sizes.reduce((best, s) =>
      Math.abs(s - want) < Math.abs(best - want) ? s : best,
    );
    return { ...item, width };
  }
  if ('x0' in item) {
    return {
      ...item,
      x0: clampGrid((centre.x - w / 2) / kx),
      y0: clampGrid((centre.y - h / 2) / ky),
      x1: clampGrid((centre.x + w / 2) / kx),
      y1: clampGrid((centre.y + h / 2) / ky),
    };
  }
  return item;
}

/** The angle shown for an item: -180 to 180, "−20°" rather than "340°". */
export function shownAngle(item: PlanItem): number {
  const r = 'rotation' in item ? (item.rotation ?? 0) : 0;
  return r > 180 ? r - 360 : r;
}

// Moving, turning and finding items ---------------------------------------------

/** Converts a move in view units to STROKE_GRID units. */
function gridDelta(d: Point): Point {
  return { x: (d.x / PLAN_VIEW_W) * STROKE_GRID, y: (d.y / PLAN_VIEW_H) * STROKE_GRID };
}

const kx = PLAN_VIEW_W / STROKE_GRID;
const ky = PLAN_VIEW_H / STROKE_GRID;

/** Turns grid points around a centre (grid units), measuring both axes in view units. */
function turnGrid(points: readonly number[], centre: Point, degrees: number): number[] {
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
export function moveItem<T extends PlanItem>(item: T, d: Point): T {
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

/** Shapes that turn by their `rotation`; strokes, lines, arrows and measures turn their points. */
const TURNED = new Set(['rect', 'ellipse', 'text', 'zone']);

/** Every item turns since version 15: rectangles, ellipses, texts and zones by `rotation`. */
export function canRotate(_item: PlanItem): boolean {
  return true;
}

/** Turns an item clockwise by `degrees` around its centre (`about`, in view units, if given). */
export function rotateItem<T extends PlanItem>(item: T, degrees: number, about?: Point): T {
  const pivot = about ? { x: about.x / kx, y: about.y / ky } : null;
  if ('points' in item) {
    return { ...item, points: turnGrid(item.points, pivot ?? middle(item.points), degrees) };
  }
  if ('x0' in item) {
    const pts = [item.x0, item.y0, item.x1, item.y1];
    const centre = middle(pts);
    if (!TURNED.has(item.kind)) {
      const [x0, y0, x1, y1] = turnGrid(pts, pivot ?? centre, degrees) as [
        number,
        number,
        number,
        number,
      ];
      return { ...item, x0, y0, x1, y1 };
    }
    const moved = pivot ? turnGrid([centre.x, centre.y], pivot, degrees) : null;
    const rotation = normalizeRotation((item.rotation ?? 0) + degrees);
    const out = moved
      ? moveItem(item, {
          x: ((moved[0] as number) - centre.x) * kx,
          y: ((moved[1] as number) - centre.y) * ky,
        })
      : { ...item };
    if (rotation === 0) delete (out as Partial<PlanShape>).rotation;
    else (out as PlanShape).rotation = rotation;
    return out;
  }
  const rotation = normalizeRotation((item.rotation ?? 0) + degrees);
  let turned: T = { ...item, rotation };
  if (pivot) {
    const [x, y] = turnGrid([item.x, item.y], pivot, degrees) as [number, number];
    turned = { ...turned, x, y };
  }
  if (rotation === 0) delete (turned as Partial<PlanIcon>).rotation;
  return turned;
}

/** Corners of a shape that turns by its `rotation`, for hit tests, in view units. */
function shapeLocal(shape: PlanShape, p: Point): Point {
  if (!shape.rotation) return p;
  const c = { x: ((shape.x0 + shape.x1) / 2) * kx, y: ((shape.y0 + shape.y1) / 2) * ky };
  const q = turn({ x: p.x - c.x, y: p.y - c.y }, -shape.rotation);
  return { x: c.x + q.x, y: c.y + q.y };
}

/** True when `p` (relative to the drawing) is on a plan shape. */
export function planShapeHit(shape: PlanShape, p: Point, radius = 0.012): boolean {
  const local = shapeLocal(shape, { x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H });
  const q = { x: local.x / PLAN_VIEW_W, y: local.y / PLAN_VIEW_H };
  const kind = shape.kind === 'measure' ? 'line' : shape.kind === 'zone' ? 'rect' : shape.kind;
  if (shape.kind === 'zone') {
    const [x0, x1] = [shape.x0, shape.x1].sort((a, b) => a - b) as [number, number];
    const [y0, y1] = [shape.y0, shape.y1].sort((a, b) => a - b) as [number, number];
    const gx = q.x * STROKE_GRID;
    const gy = q.y * STROKE_GRID;
    if (gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1) return true;
  }
  return shapeHit({ ...shape, kind } as FrameShape, q, radius, PLAN_ASPECT);
}

export interface PlanView {
  /** Layers left out: not drawn, not hit. */
  hidden?: ReadonlySet<PlanLayer>;
  /** Layers drawn but not hit. */
  locked?: ReadonlySet<PlanLayer>;
}

const reachable = (item: PlanItem, view?: PlanView) =>
  !view?.hidden?.has(layerOf(item)) && !view?.locked?.has(layerOf(item));

/** The item drawn on top under `p` (relative to the drawing, 0 to 1): icons, shapes, strokes. */
export function planItemAt(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  p: Point,
  view?: PlanView,
  radius = 0.012,
): PlanItemRef | null {
  const v = { x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H };
  const icons = plan.icons ?? [];
  for (let i = icons.length - 1; i >= 0; i--) {
    const icon = icons[i] as PlanIcon;
    if (reachable(icon, view) && iconHit(icon, v)) return { kind: 'icons', id: icon.id };
  }
  const shapes = plan.shapes ?? [];
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i] as PlanShape;
    if (reachable(shape, view) && planShapeHit(shape, p, radius))
      return { kind: 'shapes', id: shape.id };
  }
  const strokes = plan.strokes ?? [];
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i] as PlanStroke;
    if (reachable(stroke, view) && strokeHit(stroke, p, radius))
      return { kind: 'strokes', id: stroke.id };
  }
  return null;
}

/** The item a reference points at, if it is still there. */
export function planItem(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  ref: PlanItemRef,
): PlanItem | undefined {
  const list = (plan[ref.kind] ?? []) as readonly PlanItem[];
  return list.find((item) => item.id === ref.id);
}

/** Box of an item in view units, turned items by their turned corners. */
export function itemBox(item: PlanItem): { x: number; y: number; w: number; h: number } {
  if ('x' in item) return iconBounds(item);
  const pts: Point[] = [];
  if ('points' in item) {
    for (let i = 0; i + 1 < item.points.length; i += 2)
      pts.push({ x: (item.points[i] as number) * kx, y: (item.points[i + 1] as number) * ky });
  } else {
    const a = { x: item.x0 * kx, y: item.y0 * ky };
    const b =
      item.kind === 'text'
        ? { x: a.x + item.width * 0.6 * (item.text?.length ?? 1), y: a.y - item.width }
        : { x: item.x1 * kx, y: item.y1 * ky };
    const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const p of corners) {
      const q = turn({ x: p.x - c.x, y: p.y - c.y }, item.rotation ?? 0);
      pts.push({ x: c.x + q.x, y: c.y + q.y });
    }
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
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
  items: readonly PlanItem[],
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
