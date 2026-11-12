// SPDX-License-Identifier: MPL-2.0
import { PLAN_ASPECT, type PlanIcon, type PlanShape } from '@inkadra/doc-schema';
import type { Point, Rect, Viewport } from './geometry.ts';
import {
  blockingCurve,
  blockingPositions,
  iconBounds,
  iconCone,
  iconGlow,
  itemBox,
  labelAnchor,
  PLAN_REACH_UNITS,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type PlanItem,
  planStack,
} from './plan.ts';
import { iconLabel, iconSubLabel, PLAN_LABEL_SIZE, PLAN_SUB_LABEL_SIZE } from './plan-labels.ts';
import { backgroundBox } from './plan-start.ts';
import { planRoomDims, wallBounds } from './plan-walls.ts';

/**
 * The view of a plan's drawing surface (decision 0118): a surface without edges that fills the
 * area between the panels, panned and zoomed; the plan's old 3:2 extent is the unit its
 * coordinates count in. The zoom control reads 100 % on the plan fitted (Fit, the view it opens
 * with; decision 0119), as the mockup does. A view is the board's
 * `Viewport`: screen px = (view units - x, y) × zoom, zoom being px per view unit.
 */

/** An area of the screen, in px, and what covers its edges (bars floating over it). */
export interface PlanArea {
  w: number;
  h: number;
}
export interface PlanInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
const NO_INSETS: PlanInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Space kept round what is fitted, px. */
const MARGIN = 24;
/** Steps of the zoom buttons, in percent of the plan fitted (`home`, decision 0119). */
export const PLAN_ZOOM_STEPS = [25, 50, 75, 100, 150, 200, 300, 400, 600, 800];
const MIN_PERCENT = 25;
const MAX_PERCENT = 800;
/** Fit never comes closer than this, so one small icon does not fill the screen. */
const FIT_MAX_PERCENT = 250;
/** Px of the plan's reach that always stay in view. */
const KEEP = 64;
/** Where anything can be placed (decision 0118): the extent and PLAN_REACH round it. */
const REACH = {
  x: -PLAN_REACH_UNITS * PLAN_VIEW_W,
  y: -PLAN_REACH_UNITS * PLAN_VIEW_H,
  w: (1 + 2 * PLAN_REACH_UNITS) * PLAN_VIEW_W,
  h: (1 + 2 * PLAN_REACH_UNITS) * PLAN_VIEW_H,
};

/**
 * The zoom at which the drawing's whole extent fits the area: the unit of the zoom's limits
 * (25 to 800 % of it), and 100 % when nothing is drawn.
 */
export function planBaseZoom(area: PlanArea): number {
  return Math.max(
    0.01,
    Math.min((area.w - 2 * MARGIN) / PLAN_VIEW_W, (area.h - 2 * MARGIN) / PLAN_VIEW_H),
  );
}

/**
 * The zoom as the percent shown in the zoom control: of `home`, the zoom of the plan fitted
 * (`fitPlanView(...).zoom`, decision 0119), else of the extent fitted.
 */
export function planZoomPercent(v: Viewport, area: PlanArea, home = planBaseZoom(area)): number {
  return Math.round((v.zoom / home) * 100);
}

/** Whether the zoom can go further in (1) or out (-1) within its limits. */
export function canZoomPlan(v: Viewport, area: PlanArea, dir: 1 | -1): boolean {
  const next = clampZoom(v.zoom * (dir > 0 ? 1.01 : 0.99), area);
  return dir > 0 ? next > v.zoom : next < v.zoom;
}

const clampZoom = (zoom: number, area: PlanArea) => {
  const base = planBaseZoom(area);
  return Math.min((base * MAX_PERCENT) / 100, Math.max((base * MIN_PERCENT) / 100, zoom));
};

/**
 * The view moved back so that at least KEEP px of the plan's reach stay in the area: anything
 * that can be placed can be panned to, and the view never drifts where nothing can be.
 */
export function boundPlanView(v: Viewport, area: PlanArea): Viewport {
  const keepX = Math.min(KEEP, area.w / 2) / v.zoom;
  const keepY = Math.min(KEEP, area.h / 2) / v.zoom;
  return {
    zoom: v.zoom,
    x: Math.min(REACH.x + REACH.w - keepX, Math.max(REACH.x + keepX - area.w / v.zoom, v.x)),
    y: Math.min(REACH.y + REACH.h - keepY, Math.max(REACH.y + keepY - area.h / v.zoom, v.y)),
  };
}

/** Zoomed to `zoom` keeping the point under `anchor` (px in the area) still, bounded. */
export function zoomPlanAround(v: Viewport, area: PlanArea, zoom: number, anchor: Point): Viewport {
  const next = clampZoom(zoom, area);
  const world = { x: anchor.x / v.zoom + v.x, y: anchor.y / v.zoom + v.y };
  return boundPlanView(
    { zoom: next, x: world.x - anchor.x / next, y: world.y - anchor.y / next },
    area,
  );
}

/**
 * One step of the zoom buttons (or keys) in or out, round the middle of the area: to the next
 * of PLAN_ZOOM_STEPS in percent of `home` (the plan fitted), within the zoom's limits.
 */
export function stepPlanZoom(
  v: Viewport,
  area: PlanArea,
  dir: 1 | -1,
  home = planBaseZoom(area),
): Viewport {
  const now = (v.zoom / home) * 100;
  const next =
    dir > 0
      ? (PLAN_ZOOM_STEPS.find((s) => s > now + 0.5) ?? MAX_PERCENT)
      : ([...PLAN_ZOOM_STEPS].reverse().find((s) => s < now - 0.5) ?? MIN_PERCENT);
  return zoomPlanAround(v, area, (home * next) / 100, {
    x: area.w / 2,
    y: area.h / 2,
  });
}

/** The view panned by (dx, dy) px, bounded. */
export function panPlanBy(v: Viewport, area: PlanArea, dx: number, dy: number): Viewport {
  return boundPlanView({ ...v, x: v.x - dx / v.zoom, y: v.y - dy / v.zoom }, area);
}

/**
 * Two fingers from where they started (`from`, with the view `v` of that moment) to where they
 * are now (`to`), px in the area: the view follows their middle and zooms by their spread, as the
 * board's pinch does (canvas-core `pinchViewport`), within the plan's own limits.
 */
export function pinchPlanView(
  v: Viewport,
  area: PlanArea,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
): Viewport {
  const start = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const now = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const zoom = clampZoom(start > 0 ? (v.zoom * now) / start : v.zoom, area);
  const a = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const world = { x: a.x / v.zoom + v.x, y: a.y / v.zoom + v.y };
  const mid = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  return boundPlanView({ zoom, x: world.x - mid.x / zoom, y: world.y - mid.y / zoom }, area);
}

/**
 * The view that frames `box` (view units) in the middle of what `insets` leave of the area,
 * no closer than FIT_MAX_PERCENT; the whole drawing without a box.
 */
export function fitPlanView(
  box: Rect | null,
  area: PlanArea,
  insets: PlanInsets = NO_INSETS,
  /** Fills the width from the top and lets the height run over, as a phone shows a room. */
  byWidth = false,
): Viewport {
  const b = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
  const free = {
    w: Math.max(1, area.w - insets.left - insets.right - 2 * MARGIN),
    h: Math.max(1, area.h - insets.top - insets.bottom - 2 * MARGIN),
  };
  const zoom = clampZoom(
    Math.min(
      free.w / b.w,
      byWidth ? Number.POSITIVE_INFINITY : free.h / b.h,
      (planBaseZoom(area) * FIT_MAX_PERCENT) / 100,
    ),
    area,
  );
  const cx = insets.left + (area.w - insets.left - insets.right) / 2;
  const cy = insets.top + (area.h - insets.top - insets.bottom) / 2;
  // By width, the plan starts at the top, so a sheet opening below never covers it.
  const y = byWidth ? b.y - (insets.top + MARGIN) / zoom : b.y + b.h / 2 - cy / zoom;
  return boundPlanView({ zoom, x: b.x + b.w / 2 - cx / zoom, y }, area);
}

type Framed = Partial<
  Pick<
    PlanElement,
    'strokes' | 'shapes' | 'icons' | 'walls' | 'background' | 'hiddenLayers' | 'sensor' | 'scale'
  >
>;

const union = (boxes: readonly Rect[]): Rect | null => {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
};
const around = (points: readonly Point[], pad = 0): Rect =>
  union(points.map((p) => ({ x: p.x - pad, y: p.y - pad, w: 2 * pad, h: 2 * pad }))) as Rect;

/** Room sizes' text, view units round their line (decision 0119). */
const ROOM_DIM_TEXT = 18;

/** Radius of a blocking position's number and how far it sits from the position. */
const STEP_REACH = 24 + 11;
/** A measure's chip, about "12,34 m" wide, view units. */
const MEASURE_CHIP = { w: 96, h: 30 };

/**
 * Everything drawn for an item (decision 0118), view units: an icon's body, its label and a
 * light's second line, its beam, cone or glow, its earlier positions with their numbers and the
 * ways between them; a measure's chip; the box of the rest. Hit testing keeps `itemBox`.
 */
export function itemDrawnBox(item: PlanItem, sensor?: PlanElement['sensor']): Rect {
  if (!('kind' in item) || !('x' in item)) {
    const box = itemBox(item);
    const shape = item as PlanShape;
    if ('x0' in item && shape.kind === 'measure') {
      const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      return union([
        box,
        {
          x: c.x - MEASURE_CHIP.w / 2,
          y: c.y - MEASURE_CHIP.h / 2,
          w: MEASURE_CHIP.w,
          h: MEASURE_CHIP.h,
        },
      ]) as Rect;
    }
    return box;
  }
  const icon = item as PlanIcon;
  const boxes: Rect[] = [iconBounds(icon)];
  const label = iconLabel(icon);
  if (label) {
    const at = labelAnchor(icon);
    // Text about 0.6 of its size wide per letter; the halo adds a few units round it.
    const w = label.length * PLAN_LABEL_SIZE * 0.62 + 8;
    const sub = iconSubLabel(icon);
    const subW = sub.length * PLAN_SUB_LABEL_SIZE * 0.62 + 8;
    const bottom = at.y + (sub ? PLAN_LABEL_SIZE + 2 + PLAN_SUB_LABEL_SIZE * 0.35 : 0) + 4;
    boxes.push({
      x: at.x - Math.max(w, subW) / 2,
      y: at.y - PLAN_LABEL_SIZE - 2,
      w: Math.max(w, subW),
      h: bottom - (at.y - PLAN_LABEL_SIZE - 2),
    });
  }
  const cone = iconCone(icon, sensor);
  if (cone) boxes.push(around(cone.points));
  const glow = cone ? null : iconGlow(icon);
  if (glow) boxes.push(around([glow.centre], glow.radius));
  const at = blockingPositions(icon);
  if (at.length > 1) {
    const size = iconBounds(icon);
    const half = Math.max(size.w, size.h) / 2;
    boxes.push(around(at, Math.max(half, STEP_REACH)));
    for (let i = 0; i + 1 < at.length; i++)
      boxes.push(
        around([blockingCurve(at[i] as Point, at[i + 1] as Point, icon.steps?.[i]?.bend).control]),
      );
  }
  return union(boxes) as Rect;
}

/**
 * What Fit frames and outputs show (decision 0118): the box of everything drawn on the plan
 * (`itemDrawnBox` of the items drawn, walls and, unless `background` is false, the background
 * picture), leaving out the plan's hidden layers and the caller's `hidden` ones (a person's own,
 * or a group as Grip and crew); view units, null when nothing is drawn.
 */
export function planContentBox(
  plan: Framed,
  background = true,
  hidden: readonly string[] = [],
): Rect | null {
  const off = [...(plan.hiddenLayers ?? []), ...hidden];
  const stack = planStack(
    { strokes: plan.strokes ?? [], shapes: plan.shapes ?? [], icons: plan.icons ?? [] },
    off,
  );
  const boxes: Rect[] = stack.map((e) => itemDrawnBox(e.item, plan.sensor));
  if (!off.includes('set')) {
    for (const wall of plan.walls ?? []) boxes.push(wallBounds(wall));
    if (background && plan.background && !plan.background.hidden)
      boxes.push(backgroundBox(plan.background));
    for (const d of planRoomDims(plan, hidden)) boxes.push(around([d.a, d.b], ROOM_DIM_TEXT));
  }
  return union(boxes);
}

/**
 * The box of the plan's closed rooms (walls on the Set, shown), view units; null without one. A
 * phone fits it by width, as the mockup shows a room filling the screen (decision 0119).
 */
export function planRoomBox(
  plan: Partial<Pick<PlanElement, 'walls' | 'hiddenLayers'>>,
  hidden: readonly string[] = [],
): Rect | null {
  if (plan.hiddenLayers?.includes('set') || hidden.includes('set')) return null;
  return union((plan.walls ?? []).filter((w) => w.closed).map(wallBounds));
}

/** Margin round what is drawn when it is framed, view units, plus a share of its size. */
const FRAME_MARGIN = 16;
const FRAME_SHARE = 0.06;
/** A frame is never narrower than this (view units, about 4.5 m at the nominal scale). */
const FRAME_MIN_W = 400;

/**
 * Where a plan is shown on its card, its slides, sheets and exports (decision 0118): what is
 * drawn on it, with a margin for labels, widened to the plan's 3:2 shape and never narrower than
 * FRAME_MIN_W; the whole extent for an empty plan. View units.
 */
export function planFrame(plan: Framed, background = true, hidden: readonly string[] = []): Rect {
  const box = planContentBox(plan, background, hidden);
  if (!box) return { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
  const m = FRAME_MARGIN + FRAME_SHARE * Math.max(box.w, box.h * PLAN_ASPECT);
  let w = Math.max(FRAME_MIN_W, box.w + 2 * m);
  let h = box.h + 2 * m;
  if (w / h > PLAN_ASPECT) h = w / PLAN_ASPECT;
  else w = h * PLAN_ASPECT;
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
}
