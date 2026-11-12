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
  planItemLayer,
  roots,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { currentElements, keyAtEnd } from './board.ts';
import { shapeHit, strokeHit } from './film.ts';
import type { Point } from './geometry.ts';
import {
  BEAM_KINDS,
  categoryOf,
  DEFAULT_METRES,
  GLOW_KINDS,
  GLYPH_FACING,
  glyphBox,
  glyphOf,
  groupOf,
  iconGlyph,
  isSized,
  kindTier,
  NOMINAL_SCALE,
  type PlanTier,
} from './plan-icons.ts';

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
/** Bounds of a symbol's `percent`, as in the schema. */
export const SYMBOL_PERCENT = { min: 10, max: 1000 } as const;
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

/** The layer an item goes to without one of its own: its family's, Notes for texts and measures. */
export function defaultLayer(item: PlanItem): PlanLayer {
  const { layer: _layer, ...rest } = item;
  return layerOf(rest as PlanItem);
}

/** The layer an item is on: its own, or its family's (icons) or Set (strokes and shapes). */
export function layerOf(item: PlanItem): PlanLayer {
  return planItemLayer(item as Parameters<typeof planItemLayer>[0]);
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
export function iconSize(
  icon: Pick<PlanIcon, 'kind' | 'size' | 'percent' | 'w' | 'h'> & Partial<Pick<PlanIcon, 'pose'>>,
): {
  w: number;
  h: number;
} {
  const box = glyphBox(iconGlyph(icon));
  if (isSized(icon.kind) && icon.w && icon.h) return { w: icon.w, h: icon.h };
  const symbol = icon.percent
    ? (icon.percent / 100) * SYMBOL_SIZES.M
    : SYMBOL_SIZES[icon.size ?? 'M'];
  const long = isSized(icon.kind) ? 64 : symbol;
  const k = long / Math.max(box.w, box.h);
  return { w: icon.w ?? box.w * k, h: icon.h ?? box.h * k };
}

/**
 * The size an icon of `kind` lands at (decision 0104): its real size in DEFAULT_METRES through
 * the plan's `scale`, or through NOMINAL_SCALE on a plan without one, so icons keep their
 * proportions to each other. Symbols get a `percent`, sized kinds a width and a depth.
 */
export function defaultIconSize(
  kind: PlanIcon['kind'],
  scale?: number,
): Pick<PlanIcon, 'percent'> | Pick<PlanIcon, 'w' | 'h'> {
  const k = scale ?? NOMINAL_SCALE;
  const metres = DEFAULT_METRES[kind];
  const [long, short] = typeof metres === 'number' ? [metres, metres] : metres;
  if (isSized(kind)) {
    const box = glyphBox(glyphOf(kind));
    const [w, h] = box.w >= box.h ? [long, short] : [short, long];
    const size = (m: number) => Math.round(Math.min(4000, Math.max(1, m * k)) * 10) / 10;
    return { w: size(w), h: size(h) };
  }
  const percent = Math.round(((long * k) / SYMBOL_SIZES.M) * 100);
  return { percent: Math.min(SYMBOL_PERCENT.max, Math.max(SYMBOL_PERCENT.min, percent)) };
}

/** A symbol's size in percent of medium: S and L of older plans read as 73 % and 136 %. */
export function symbolPercent(icon: Pick<PlanIcon, 'size' | 'percent'>): number {
  return icon.percent ?? Math.round((SYMBOL_SIZES[icon.size ?? 'M'] / SYMBOL_SIZES.M) * 100);
}

/** The symbol at `percent`, within the schema's bounds; `percent` replaces S, M or L. */
export function withPercent(icon: PlanIcon, percent: number): PlanIcon {
  const next = {
    ...icon,
    percent: Math.round(Math.min(SYMBOL_PERCENT.max, Math.max(SYMBOL_PERCENT.min, percent))),
  };
  delete (next as Partial<PlanIcon>).size;
  return next;
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
  const box = glyphBox(iconGlyph(icon));
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
  // A modifier of version 15 that is attached to a light lends it its light (decision 0104).
  const modifier = icon.kind === 'softbox' || icon.kind === 'para';
  const beam = BEAM_KINDS.has(icon.kind) && !(modifier && icon.on);
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

/** Where the end of an icon's cone is, on its axis at the base of the triangle; view units. */
export function coneEnd(icon: PlanIcon, sensor?: PlanSensor): Point | null {
  const cone = iconCone(icon, sensor);
  if (!cone) return null;
  const [, a, b] = cone.points;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * The glow of a light that shines all around (a lantern, a practical, a candle): a circle round
 * its centre, `reach` view units wide (DEFAULT_GLOW without one). Null for other icons.
 */
export function iconGlow(icon: PlanIcon): { centre: Point; radius: number } | null {
  if (!GLOW_KINDS.has(icon.kind)) return null;
  const size = iconSize(icon);
  return {
    centre: iconCentre(icon),
    radius: icon.reach ?? Math.max(DEFAULT_GLOW, Math.max(size.w, size.h) * 1.5),
  };
}
const DEFAULT_GLOW = 60;

/**
 * How warm a light's colour temperature is, from 0 (cool, 6500 K and above) to 1 (warm, 2000 K
 * and below), to tint its beam between the palette's blue and orange; null without a `kelvin`
 * (the beam keeps the icon's colour).
 */
export function beamWarmth(kelvin: number | undefined): number | null {
  if (kelvin === undefined) return null;
  return Math.min(1, Math.max(0, (6500 - kelvin) / 4500));
}

/** The icon with the end of its cone dragged to `p` (view units): only its length changes. */
export function withReachAt(icon: PlanIcon, p: Point, sensor?: PlanSensor): PlanIcon {
  const cone = iconCone(icon, sensor);
  if (!cone) return icon;
  const c = iconCentre(icon);
  const along = turn({ x: p.x - c.x, y: p.y - c.y }, -(icon.rotation ?? 0)).x;
  const start = Math.hypot(cone.points[0].x - c.x, cone.points[0].y - c.y);
  // The base of the triangle sits at cos(angle / 2) of its sides' length; a beam of 180° is flat.
  const side = along / Math.max(0.1, Math.cos((cone.angle * Math.PI) / 360));
  return { ...icon, reach: Math.round(Math.min(4000, Math.max(20, side - start))) };
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
 * depth; symbols grow in proportion around their middle; texts snap to the three font sizes in
 * `textSizes`.
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
    if (isSized(item.kind))
      return {
        ...item,
        w: Math.round(w * 10) / 10,
        h: Math.round(h * 10) / 10,
        x: clampGrid(centre.x / kx),
        y: clampGrid(centre.y / ky),
      };
    // Symbols keep their middle, so the corner stays under the pointer from there.
    const grown = Math.max(Math.abs(q.x) / (f.w / 2), Math.abs(q.y) / (f.h / 2));
    return withPercent(item, symbolPercent(item) * grown) as T;
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
  if ('x0' in item) {
    // A measure moved on its own no longer follows the icons it was attached to.
    const { from: _from, to: _to, ...rest } = item as PlanShape;
    return {
      ...(rest as T),
      x0: clampGrid(item.x0 + g.x),
      y0: clampGrid(item.y0 + g.y),
      x1: clampGrid(item.x1 + g.x),
      y1: clampGrid(item.y1 + g.y),
    } as T;
  }
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

/**
 * The groups of the Elements tab (decision 0114): the layers, and Grip and crew, which lists the
 * grip (cut, diffuse, stands, power, a modifier on no light) and the video, sound and crew
 * icons that are on their kind's layer. It is not a layer of the document: its items keep their
 * layer, and hiding it (`hidden` holding 'grip') is only of the person editing.
 */
export type PlanGroupName = PlanLayer | 'grip';
export const PLAN_GRIP = 'grip';

export function planGroupOf(item: PlanItem): PlanGroupName {
  // A modifier on a light is part of the light.
  if (!('x' in item) || item.layer || (item.on && groupOf(item.kind).id === 'modifiers'))
    return layerOf(item);
  const category = categoryOf(item.kind).id;
  return category === 'grip' || category === 'av' ? PLAN_GRIP : layerOf(item);
}

const isHidden = (item: PlanItem, hidden?: { has: (name: string) => boolean }) =>
  !!hidden && (hidden.has(layerOf(item)) || hidden.has(planGroupOf(item)));

export interface PlanView {
  /** Layers, and the Grip and crew group, left out: not drawn, not hit. */
  hidden?: ReadonlySet<string>;
  /** Layers drawn but not hit. */
  locked?: ReadonlySet<PlanLayer>;
}

const reachable = (item: PlanItem, view?: PlanView) =>
  !isHidden(item, view?.hidden) && !view?.locked?.has(layerOf(item));

/**
 * An item locked on its own (decision 0114): still picked by a click, so it can be unlocked,
 * but not moved, turned, resized, edited or deleted, and no base to attach to.
 */
export function itemLocked(item: { locked?: boolean | undefined } | null | undefined): boolean {
  return item?.locked === true;
}

/**
 * Whether a write may change these fields of a stored item (decision 0114): anything on a free
 * item; on a locked one only its lock, or where it stands when its base, written with it, takes
 * it along (an attached item always sits where its base says).
 */
export function lockAllows(
  stored: Record<string, unknown>,
  changed: readonly string[],
  written: { has: (id: string) => boolean },
): boolean {
  if (stored.locked !== true) return true;
  if (changed.every((k) => k === 'locked')) return true;
  return (
    typeof stored.on === 'string' &&
    written.has(stored.on) &&
    changed.every((k) => k === 'x' || k === 'y' || k === 'rotation')
  );
}

/**
 * The item drawn on top under `p` (relative to the drawing, 0 to 1), in the stacking order the
 * renderers draw (planStack): what is seen on top is picked first. Measures are drawn on top but
 * yield to the icons their ends sit on: a thin line must not hide the body under it.
 */
export function planItemAt(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  p: Point,
  view?: PlanView,
  radius = 0.012,
): PlanItemRef | null {
  const v = { x: p.x * PLAN_VIEW_W, y: p.y * PLAN_VIEW_H };
  const stack = planStack(plan);
  for (let i = stack.length - 1; i >= 0; i--) {
    const { ref, item } = stack[i] as PlanStackEntry;
    if (!reachable(item, view)) continue;
    const hit =
      ref.kind === 'icons'
        ? iconHit(item as PlanIcon, v)
        : ref.kind === 'shapes'
          ? planShapeHit(item as PlanShape, p, radius)
          : strokeHit(item as PlanStroke, p, radius);
    if (!hit) continue;
    // A measure yields only to the icons its ends sit on, where they are under `p`.
    const shape = item as PlanShape;
    if (ref.kind === 'shapes' && shape.kind === 'measure' && (shape.from || shape.to)) {
      const end = (plan.icons ?? []).find(
        (icon) =>
          (icon.id === shape.from || icon.id === shape.to) &&
          reachable(icon, view) &&
          iconHit(icon, v),
      );
      if (end) return { kind: 'icons', id: end.id };
    }
    return ref;
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

// Attachments and stacking -------------------------------------------------------

/**
 * The ids with every icon attached to them, directly or through another (a light on a stand with
 * its softbox): what moves, turns, is copied and deleted with them (decision 0104). An `on` that
 * points at nothing, or round in a loop, attaches to nothing.
 */
export function withAttached(icons: readonly PlanIcon[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const icon of icons)
      if (icon.on && !out.has(icon.id) && out.has(icon.on)) {
        out.add(icon.id);
        grew = true;
      }
  }
  return out;
}

/** The icon standing free: its `on` dropped. */
export function withoutOn(icon: PlanIcon): PlanIcon {
  const { on: _on, ...free } = icon;
  return free;
}

/** How deep an icon is attached: 0 free, 1 on a free base, 2 on an attached one… */
export function attachDepth(icon: PlanIcon, byId: ReadonlyMap<string, PlanIcon>): number {
  let depth = 0;
  let at: PlanIcon | undefined = icon;
  const seen = new Set<string>();
  while (at?.on && !seen.has(at.id) && depth < 16) {
    seen.add(at.id);
    at = byId.get(at.on);
    if (!at) break;
    depth++;
  }
  return depth;
}

/** The stacking tier of an item: its own `tier`, its kind's, Notes on top, other drawing at 0. */
export function itemTier(item: PlanItem): PlanTier | number {
  if ('x' in item) return item.tier ?? kindTier(item.kind);
  return layerOf(item) === 'notes' ? 5 : 0;
}

export interface PlanStackEntry {
  ref: PlanItemRef;
  item: PlanItem;
  tier: number;
}

/**
 * The items of a plan in drawing order (decision 0104): by tier (background and walls, furniture,
 * supports, lights and camera and grip, people, notes), an attached icon over its base, strokes
 * under shapes under icons, then their order in the plan. Items on `hidden` layers, or of the
 * hidden Grip and crew group, are left out.
 * Renderers draw beams and blocking moves between tier 1 and tier 2, labels last.
 */
export function planStack(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  hidden?: readonly string[],
): PlanStackEntry[] {
  const byId = new Map((plan.icons ?? []).map((i) => [i.id, i]));
  const rank = { strokes: 0, shapes: 1, icons: 2 } as const;
  const off = hidden && new Set(hidden);
  return (
    planItems(plan)
      .map((e, index) => ({
        ...e,
        tier: itemTier(e.item),
        depth: e.ref.kind === 'icons' ? attachDepth(e.item as PlanIcon, byId) : 0,
        index,
      }))
      .filter((e) => !isHidden(e.item, off))
      // An `on` whose base is gone reads as free: a modifier draws its own beam again.
      .map((e) =>
        e.ref.kind === 'icons' &&
        (e.item as PlanIcon).on &&
        !byId.has((e.item as PlanIcon).on ?? '')
          ? { ...e, item: withoutOn(e.item as PlanIcon) }
          : e,
      )
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          a.depth - b.depth ||
          rank[a.ref.kind] - rank[b.ref.kind] ||
          a.index - b.index,
      )
      .map(({ ref, item, tier }) => ({ ref, item, tier }))
  );
}

// Scale and measures --------------------------------------------------------------

/**
 * A measure with its ends on the icons they are attached to, where those icons stand now:
 * the measure follows them when they move. Ends of icons that are gone stay where they were.
 */
export function measureEnds(shape: PlanShape, icons: readonly PlanIcon[] = []): PlanShape {
  if (shape.kind !== 'measure' || (!shape.from && !shape.to)) return shape;
  const from = shape.from ? icons.find((i) => i.id === shape.from) : undefined;
  const to = shape.to ? icons.find((i) => i.id === shape.to) : undefined;
  return {
    ...shape,
    ...(from ? { x0: from.x, y0: from.y } : {}),
    ...(to ? { x1: to.x, y1: to.y } : {}),
  };
}

/** Length of a line between two grid points, in view units. */
export function gridLength(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot((x1 - x0) * kx, (y1 - y0) * ky);
}

/** The scale (view units per metre) that makes a line `length` view units long `metres` long. */
export function scaleFor(length: number, metres: number): number | null {
  return metres > 0 && length > 0 ? length / metres : null;
}

// Several items -------------------------------------------------------------------

export type PlanAlign = 'left' | 'centre' | 'top' | 'distribute';

const refOf = (kind: PlanItemKind, item: PlanItem): PlanItemRef => ({ kind, id: item.id });

/** Every item of a plan with the array it lives in, strokes first. */
export function planItems(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
): Array<{ ref: PlanItemRef; item: PlanItem }> {
  return (['strokes', 'shapes', 'icons'] as const).flatMap((kind) =>
    ((plan[kind] ?? []) as PlanItem[]).map((item) => ({ ref: refOf(kind, item), item })),
  );
}

/** The refs with the rest of their groups: a group is picked whole (one level, no nesting). */
export function withGroups(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  refs: readonly PlanItemRef[],
): PlanItemRef[] {
  const all = planItems(plan);
  const ids = new Set(refs.map((r) => r.id));
  const groups = new Set(
    all.filter((e) => ids.has(e.item.id) && e.item.group).map((e) => e.item.group),
  );
  return all
    .filter((e) => ids.has(e.item.id) || (e.item.group && groups.has(e.item.group)))
    .map((e) => e.ref);
}

/**
 * Items whose box touches `rect` (view units), the hidden and locked layers left out, and the
 * items locked on their own: a box or Select all never takes one along (decision 0114).
 */
export function itemsInRect(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  rect: { x: number; y: number; w: number; h: number },
  view?: PlanView,
): PlanItemRef[] {
  return planItems(plan)
    .filter(({ item }) => {
      if (!reachable(item, view) || itemLocked(item)) return false;
      const b = itemBox(item);
      return (
        b.x <= rect.x + rect.w &&
        b.x + b.w >= rect.x &&
        b.y <= rect.y + rect.h &&
        b.y + b.h >= rect.y
      );
    })
    .map((e) => e.ref);
}

/** The box around several items, in view units. */
export function itemsBox(items: readonly PlanItem[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const boxes = items.map(itemBox);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}

/**
 * Items lined up on the left edge, the middle or the top of their box, or spread evenly across
 * it (by their middles, first and last staying).
 */
export function alignItems<T extends PlanItem>(items: readonly T[], how: PlanAlign): T[] {
  if (items.length < 2) return [...items];
  const all = itemsBox(items);
  if (how === 'distribute') {
    const sorted = [...items].sort((a, b) => {
      const ba = itemBox(a);
      const bb = itemBox(b);
      return ba.x + ba.w / 2 - (bb.x + bb.w / 2);
    });
    const first = itemBox(sorted[0] as T);
    const last = itemBox(sorted.at(-1) as T);
    const from = first.x + first.w / 2;
    const gap = (last.x + last.w / 2 - from) / (sorted.length - 1);
    const moved = new Map(
      sorted.map((item, i) => {
        const b = itemBox(item);
        return [item.id, moveItem(item, { x: from + gap * i - (b.x + b.w / 2), y: 0 })];
      }),
    );
    return items.map((item) => moved.get(item.id) as T);
  }
  return items.map((item) => {
    const b = itemBox(item);
    if (how === 'left') return moveItem(item, { x: all.x - b.x, y: 0 });
    if (how === 'top') return moveItem(item, { x: 0, y: all.y - b.y });
    return moveItem(item, { x: all.x + all.w / 2 - (b.x + b.w / 2), y: 0 });
  });
}

/**
 * Groups the items under a new group id, or ungroups them when they already form one group.
 * Returns the items to write.
 */
export function toggleGroup<T extends PlanItem>(items: readonly T[]): T[] {
  const first = items[0]?.group;
  const grouped = !!first && items.every((i) => i.group === first);
  const id = newElementId();
  return items.map((item) => {
    const next = { ...item };
    if (grouped) delete next.group;
    else next.group = id;
    return next;
  });
}

// Layers and variants -------------------------------------------------------------

/** How many items each layer holds. */
export function layerCounts(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
): Record<PlanLayer, number> {
  const out: Record<PlanLayer, number> = { set: 0, lights: 0, camera: 0, actors: 0, notes: 0 };
  for (const { item } of planItems(plan)) out[layerOf(item)] += 1;
  return out;
}

const notSet = <T extends PlanItem>(items: readonly T[] | undefined) =>
  (items ?? []).filter((i) => layerOf(i) !== 'set');
const onlySet = <T extends PlanItem>(items: readonly T[] | undefined) =>
  (items ?? []).filter((i) => layerOf(i) === 'set');

/**
 * What a variant shows: the Set layer of its base (walls and furniture shared by all the
 * variants) under its own lights, cameras, actors and notes (decision 0062). An item of the
 * variant itself on Set (written by an older build, or a layer change racing a move to the base)
 * is shown too, so it is never invisible; moving it to Set again moves it into the base
 * (`transferPlanItems`, decision 0104).
 */
export function variantView<P extends Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>>(
  plan: P,
  base:
    | Pick<
        PlanElement,
        | 'strokes'
        | 'shapes'
        | 'icons'
        | 'scale'
        | 'grid'
        | 'rulers'
        | 'walls'
        | 'openings'
        | 'circuits'
        | 'voltage'
        | 'background'
      >
    | undefined,
): P {
  if (!base) return plan;
  // The Set is the base's, and so is its scale: walls measured once, metres in every variant.
  const shared = base as Partial<
    Pick<PlanElement, 'scale' | 'grid' | 'rulers' | 'circuits' | 'voltage'>
  >;
  const own = (plan as Partial<Pick<PlanElement, 'circuits'>>).circuits ?? [];
  const baseCircuits = shared.circuits ?? [];
  return {
    ...plan,
    scale: shared.scale,
    grid: shared.grid,
    rulers: shared.rulers,
    strokes: [...onlySet(base.strokes), ...(plan.strokes ?? [])],
    shapes: [...onlySet(base.shapes), ...(plan.shapes ?? [])],
    icons: [...onlySet(base.icons), ...(plan.icons ?? [])],
    // Walls and their openings are the Set: the base's (decision 0104).
    walls: base.walls,
    openings: base.openings,
    // So are the electrics of the location (decision 0117): the base's circuits and voltage,
    // then any circuit a setup was given by an earlier build, so none of its lights loses its own.
    circuits: [...baseCircuits, ...own.filter((c) => !baseCircuits.some((b) => b.id === c.id))],
    voltage: shared.voltage,
    // So is the picture under them (decision 0110).
    background: base.background,
  };
}

/** A plan and its variants, the base first, then the variants oldest first. */
export function variantFamily(
  elements: Iterable<Element>,
  plan: Pick<PlanElement, 'id' | 'variantOf'>,
): PlanElement[] {
  const baseId = plan.variantOf ?? plan.id;
  const plans = [...elements].filter((e): e is PlanElement => e.type === 'plan');
  const base = plans.find((p) => p.id === baseId);
  const variants = plans
    .filter((p) => p.variantOf === baseId)
    .sort((a, b) => a.createdAt - b.createdAt);
  return base ? [base, ...variants] : variants;
}

/**
 * A new variant card next to `source`: a copy of its lights, cameras, actors and notes, the
 * Set layer shared with `base` (the source itself when it is no variant). Returns its id.
 */
export function addVariant(
  doc: Y.Doc,
  source: PlanElement,
  name: string,
  opts: { userId: string | null; origin?: unknown },
): string {
  const baseId = source.variantOf ?? source.id;
  const id = newElementId();
  const z = keyAtEnd(currentElements(doc), source.parent);
  doc.transact(() => {
    const copy = new Y.Map<unknown>();
    const fields: Record<string, unknown> = {
      id,
      type: 'plan',
      x: Math.round(source.x + source.w + 40),
      y: source.y,
      w: source.w,
      z,
      parent: source.parent,
      createdBy: opts.userId,
      createdAt: Date.now(),
      variantOf: baseId,
      variant: name,
      ...(source.title ? { title: source.title } : {}),
      ...(source.h ? { h: source.h } : {}),
      ...(source.sensor ? { sensor: source.sensor } : {}),
      // What the card is to guests, to editing and to search, as for any copy.
      ...(source.guestHidden ? { guestHidden: true } : {}),
      ...(source.locked ? { locked: true } : {}),
      ...(source.tags?.length ? { tags: [...source.tags] } : {}),
    };
    for (const [k, v] of Object.entries(fields)) copy.set(k, v);
    // Copies of the icons; measures follow the copies, groups become new groups.
    const ids = new Map<string, string>();
    const groups = new Map<string, string>();
    const renew = <T extends PlanItem>(i: T): T => {
      const id = newElementId();
      ids.set(i.id, id);
      const out = { ...i, id };
      if (i.group) {
        if (!groups.has(i.group)) groups.set(i.group, newElementId());
        out.group = groups.get(i.group);
      }
      return out;
    };
    const icons = notSet(source.icons).map(renew);
    const strokes = notSet(source.strokes).map(renew);
    const shapes = notSet(source.shapes)
      .map(renew)
      .map((sh) => ({
        ...sh,
        ...(sh.from && ids.has(sh.from) ? { from: ids.get(sh.from) } : {}),
        ...(sh.to && ids.has(sh.to) ? { to: ids.get(sh.to) } : {}),
      }));
    copy.set('strokes', Y.Array.from(strokes));
    copy.set('shapes', Y.Array.from(shapes));
    copy.set('icons', Y.Array.from(icons.map((i) => new Y.Map<unknown>(Object.entries(i)))));
    // Circuits are the base's, shared by its setups (decision 0117): the setup's own list stays
    // empty, as the card's shape expects.
    copy.set('circuits', new Y.Array());
    roots(doc).elements.set(id, copy);
  }, opts.origin);
  return id;
}

// Writing to the document --------------------------------------------------------

/** The plan's list, created when missing; call inside the transaction that writes to it. */
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
  let id: string | null = null;
  // The list is created, when a plan lacks it, in the same undo step as the icon.
  doc.transact(() => {
    const icons = listOf(doc, planId, 'icons');
    if (!icons || icons.length >= MAX_PLAN_ICONS) return;
    id = newElementId();
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({ ...icon, id }))
      if (value !== undefined) map.set(key, value);
    icons.push([map]);
  }, origin);
  return id;
}

const same = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

const MOVES = new Set(['x', 'y', 'rotation']);

/**
 * The writes of `written` the locks allow (decision 0114), against the items as `stored`: a
 * locked item takes only its lock, or the moves of a base written and moving with it; and what
 * sits on a base whose write is refused stays with it, its moves refused too, so nothing walks
 * away from a locked base that a nudge, a turn or a drag computed as moving. Writers filter
 * with it before deriving anything else from the writes (where attachments settle).
 */
export function allowedWrites<T extends { id: string }>(
  stored: ReadonlyArray<{ id: string }>,
  written: readonly T[],
): T[] {
  const byId = new Map(stored.map((i) => [i.id, i as unknown as Record<string, unknown>]));
  const changed = new Map(
    written.map((n) => {
      const s = byId.get(n.id);
      const next = n as unknown as Record<string, unknown>;
      const keys = s ? new Set([...Object.keys(s), ...Object.keys(next)]) : new Set<string>();
      return [n.id, [...keys].filter((k) => s && !same(s[k], next[k]))];
    }),
  );
  const ids = new Set(written.map((n) => n.id));
  const refused = new Set(
    written.flatMap((n) => {
      const s = byId.get(n.id);
      return s && !lockAllows(s, changed.get(n.id) ?? [], ids) ? [n.id] : [];
    }),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of written) {
      const on = byId.get(n.id)?.on;
      const moves = changed.get(n.id) ?? [];
      if (refused.has(n.id) || typeof on !== 'string' || !refused.has(on)) continue;
      if (moves.length && moves.every((k) => MOVES.has(k))) {
        refused.add(n.id);
        grew = true;
      }
    }
  }
  return written.filter((n) => !refused.has(n.id));
}

/**
 * Writes new versions of items, matched by id, field by field: only the fields that differ from
 * `before` (the items as they were when the gesture started; omitted, as they are stored) are
 * written, so an edit of one field never undoes someone else's edit of another made meanwhile.
 * Items locked on their own, and what sits on them, change only as allowedWrites says.
 * Icons are Y.Maps and change in place; strokes and shapes are replaced where they are, their
 * stored version taking the changed fields.
 */
export function updatePlanItems(
  doc: Y.Doc,
  planId: string,
  items: readonly PlanItem[],
  origin?: unknown,
  before?: readonly PlanItem[],
): void {
  const baseline = new Map((before ?? []).map((item) => [item.id, item]));
  doc.transact(() => {
    const stored = (['strokes', 'shapes', 'icons'] as const).flatMap((kind) =>
      (listOf(doc, planId, kind)?.toArray() ?? []).map(
        (v) => (v instanceof Y.Map ? v.toJSON() : v) as PlanItem,
      ),
    );
    const byId = new Map(allowedWrites(stored, items).map((item) => [item.id, item]));
    for (const kind of ['strokes', 'shapes', 'icons'] as const) {
      const list = listOf(doc, planId, kind);
      if (!list) return;
      list.toArray().forEach((value, index) => {
        const next = byId.get(idOf(value) as string) as Record<string, unknown> | undefined;
        if (!next) return;
        const stored = (value instanceof Y.Map ? value.toJSON() : value) as Record<string, unknown>;
        const old = (baseline.get(next.id as string) ?? stored) as Record<string, unknown>;
        const keys = new Set([...Object.keys(old), ...Object.keys(next)]);
        const changed = [...keys].filter((k) => !same(old[k], next[k]));
        if (changed.length === 0) return;
        if (value instanceof Y.Map) {
          for (const k of changed)
            if (next[k] === undefined) value.delete(k);
            else value.set(k, next[k]);
        } else {
          const merged: Record<string, unknown> = { ...stored };
          for (const k of changed)
            if (next[k] === undefined) delete merged[k];
            else merged[k] = next[k];
          list.delete(index, 1);
          list.insert(index, [merged]);
        }
      });
    }
  }, origin);
}

/**
 * Moves items from one plan's lists to another's in one transaction, one undo step: from a
 * setup into its base when they go to the Set layer, which all the setups share (decision
 * 0104). Each item is moved as it is stored, with `patch(item)` written over it (a field set to
 * undefined is removed), and keeps its id, so measures and attachments that point at it still
 * find it in the setup's view. An item the target has no room for, or locked on its own
 * (decision 0114), stays where it was. Returns the ids moved.
 */
export function transferPlanItems(
  doc: Y.Doc,
  fromId: string,
  toId: string,
  ids: Iterable<string>,
  patch: (item: PlanItem) => Partial<PlanItem>,
  origin?: unknown,
): string[] {
  const moved: string[] = [];
  const wanted = new Set(ids);
  doc.transact(() => {
    for (const kind of ['strokes', 'shapes', 'icons'] as const) {
      const from = listOf(doc, fromId, kind);
      const to = listOf(doc, toId, kind);
      if (!from || !to) return;
      // In the plan's order, so a base still comes before what is attached to it.
      const going = from
        .toArray()
        .map((value, index) => ({ index, value }))
        .filter(({ value }) => wanted.has(idOf(value) as string))
        // Read before the delete: a removed Y.Map no longer reads.
        .map(({ index, value }) => ({
          index,
          stored: (value instanceof Y.Map ? value.toJSON() : value) as PlanItem,
        }))
        // An item locked on its own stays where it is (decision 0114).
        .filter(({ stored }) => !itemLocked(stored))
        .slice(0, Math.max(0, LIMITS[kind] - to.length));
      for (const { index } of [...going].reverse()) from.delete(index, 1);
      for (const { stored } of going) {
        const next: Record<string, unknown> = { ...stored, ...patch(stored) };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        if (kind === 'icons') to.push([new Y.Map<unknown>(Object.entries(next))]);
        else to.push([next]);
        moved.push(stored.id);
      }
    }
  }, origin);
  return moved;
}

/**
 * Removes items, and the icons attached to removed icons. Measures attached to a removed icon
 * keep that end where the icon stood and stop following it. Items locked on their own stay
 * (decision 0114), with what is on them; one attached to a removed base stays where it is.
 */
export function removePlanItems(
  doc: Y.Doc,
  planId: string,
  ids: Iterable<string>,
  origin?: unknown,
): void {
  doc.transact(() => {
    const icons = listOf(doc, planId, 'icons');
    const locked = new Set(
      (['strokes', 'shapes', 'icons'] as const).flatMap((kind) =>
        (listOf(doc, planId, kind)?.toArray() ?? []).flatMap((m) => {
          const item = (m instanceof Y.Map ? m.toJSON() : m) as PlanItem;
          return itemLocked(item) ? [item.id] : [];
        }),
      ),
    );
    // What is attached to a removed icon goes with it (decision 0104), but for locked items.
    const doomed = withAttached(
      (icons?.toArray() ?? []).map((m) =>
        m instanceof Y.Map ? (m.toJSON() as PlanIcon) : (m as PlanIcon),
      ),
      [...ids].filter((id) => !locked.has(id)),
    );
    for (const id of locked) doomed.delete(id);
    const shapes = listOf(doc, planId, 'shapes');
    const gone = (icons?.toArray() ?? [])
      .map((m) => (m instanceof Y.Map ? (m.toJSON() as PlanIcon) : (m as PlanIcon)))
      .filter((i) => doomed.has(i.id));
    if (shapes && gone.length) {
      shapes.toArray().forEach((value, index) => {
        const shape = value as PlanShape;
        if (shape.kind !== 'measure' || doomed.has(shape.id)) return;
        const from = gone.some((i) => i.id === shape.from);
        const to = gone.some((i) => i.id === shape.to);
        if (!from && !to) return;
        const fixed = { ...measureEnds(shape, gone) };
        if (from) delete fixed.from;
        if (to) delete fixed.to;
        shapes.delete(index, 1);
        shapes.insert(index, [fixed]);
      });
    }
    for (const kind of ['strokes', 'shapes', 'icons'] as const) {
      const list = listOf(doc, planId, kind);
      if (!list) return;
      for (let i = list.length - 1; i >= 0; i--)
        if (doomed.has(idOf(list.get(i)) as string)) list.delete(i, 1);
    }
  }, origin);
}

/**
 * Copies items next to the originals, `offset` view units away. Returns the copies. Groups
 * among them become new groups of the copies; an attached measure is copied where it is drawn,
 * detached, so it does not land on the original. Icons attached to a copied icon are copied
 * with it and attached to its copy, unless `attached` is false; a copy whose base was not
 * copied stands free.
 */
export function duplicatePlanItems(
  doc: Y.Doc,
  plan: PlanElement,
  refs: readonly PlanItemRef[],
  offset: Point,
  origin?: unknown,
  opts: {
    /** The plan the copies go on: the plan itself unless another reuses its set. */
    target?: string;
    /** False copies only `refs`: what is attached to them from elsewhere stays behind. */
    attached?: boolean;
  } = {},
): PlanItemRef[] {
  const targetId = opts.target ?? plan.id;
  const out: PlanItemRef[] = [];
  const groups = new Map<string, string>();
  const regroup = (g: string | undefined) => {
    if (!g) return undefined;
    if (!groups.has(g)) groups.set(g, newElementId());
    return groups.get(g);
  };
  const icons = plan.icons ?? [];
  const picked = refs.filter((r) => r.kind === 'icons').map((r) => r.id);
  const iconIds = opts.attached === false ? new Set(picked) : withAttached(icons, picked);
  const all = [
    ...refs.filter((r) => r.kind !== 'icons'),
    // In the plan's order, so a base is copied before what is attached to it.
    ...icons.filter((i) => iconIds.has(i.id)).map((i) => ({ kind: 'icons' as const, id: i.id })),
  ];
  const fresh = new Map(all.map((r) => [r.id, newElementId()]));
  doc.transact(() => {
    for (const ref of all) {
      const found = planItem(plan, ref);
      const list = listOf(doc, targetId, ref.kind);
      if (!found || !list || list.length >= LIMITS[ref.kind]) continue;
      const item =
        'x0' in found && found.kind === 'measure' ? measureEnds(found, plan.icons) : found;
      const copy = { ...moveItem(item, offset), id: fresh.get(ref.id) as string } as PlanItem;
      const group = regroup(item.group);
      if (group) copy.group = group;
      if ('x' in copy && copy.on) {
        const base = iconIds.has(copy.on) ? fresh.get(copy.on) : undefined;
        if (base) copy.on = base;
        else delete copy.on;
      }
      if (ref.kind === 'icons') {
        const map = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(copy))
          if (value !== undefined) map.set(key, value);
        list.push([map]);
      } else list.push([copy]);
      out.push({ kind: ref.kind, id: copy.id });
    }
  }, origin);
  return out;
}
