// SPDX-License-Identifier: MPL-2.0
import { PLAN_ASPECT } from '@inkadra/doc-schema';
import type { Point, Rect, Viewport } from './geometry.ts';
import type { PlanElement } from './plan.ts';
import { itemBox, PLAN_VIEW_H, PLAN_VIEW_W, planItems } from './plan.ts';
import { backgroundBox } from './plan-start.ts';
import { wallBounds } from './plan-walls.ts';

/**
 * The view of a plan's drawing surface (decision 0117): a surface without edges that fills the
 * area between the panels, panned and zoomed; the plan's old 3:2 extent is the unit its
 * coordinates count in, and 100 % fits it to the area. A view is the board's
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
/** Steps of the zoom buttons, in percent of the whole drawing fitted to its area. */
export const PLAN_ZOOM_STEPS = [25, 50, 75, 100, 150, 200, 300, 400, 600, 800];
const MIN_PERCENT = 25;
const MAX_PERCENT = 800;
/** Fit never comes closer than this, so one small icon does not fill the screen. */
const FIT_MAX_PERCENT = 250;
/** Px of the drawing's extent that always stay in view, so the plan cannot be lost. */
const KEEP = 64;

/** The zoom at which the drawing's whole extent fits the area: 100 %. */
export function planBaseZoom(area: PlanArea): number {
  return Math.max(
    0.01,
    Math.min((area.w - 2 * MARGIN) / PLAN_VIEW_W, (area.h - 2 * MARGIN) / PLAN_VIEW_H),
  );
}

/** The zoom as the percent shown in the zoom control. */
export function planZoomPercent(v: Viewport, area: PlanArea): number {
  return Math.round((v.zoom / planBaseZoom(area)) * 100);
}

const clampZoom = (zoom: number, area: PlanArea) => {
  const base = planBaseZoom(area);
  return Math.min((base * MAX_PERCENT) / 100, Math.max((base * MIN_PERCENT) / 100, zoom));
};

/** The view moved back so that at least KEEP px of the drawing's extent stay in the area. */
export function boundPlanView(v: Viewport, area: PlanArea): Viewport {
  const keepX = Math.min(KEEP, area.w / 2) / v.zoom;
  const keepY = Math.min(KEEP, area.h / 2) / v.zoom;
  return {
    zoom: v.zoom,
    x: Math.min(PLAN_VIEW_W - keepX, Math.max(keepX - area.w / v.zoom, v.x)),
    y: Math.min(PLAN_VIEW_H - keepY, Math.max(keepY - area.h / v.zoom, v.y)),
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

/** One step of the zoom buttons (or keys) in or out, round the middle of the area. */
export function stepPlanZoom(v: Viewport, area: PlanArea, dir: 1 | -1): Viewport {
  const now = (v.zoom / planBaseZoom(area)) * 100;
  const next =
    dir > 0
      ? (PLAN_ZOOM_STEPS.find((s) => s > now + 0.5) ?? MAX_PERCENT)
      : ([...PLAN_ZOOM_STEPS].reverse().find((s) => s < now - 0.5) ?? MIN_PERCENT);
  return zoomPlanAround(v, area, (planBaseZoom(area) * next) / 100, {
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
): Viewport {
  const b = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
  const free = {
    w: Math.max(1, area.w - insets.left - insets.right - 2 * MARGIN),
    h: Math.max(1, area.h - insets.top - insets.bottom - 2 * MARGIN),
  };
  const zoom = clampZoom(
    Math.min(free.w / b.w, free.h / b.h, (planBaseZoom(area) * FIT_MAX_PERCENT) / 100),
    area,
  );
  const cx = insets.left + (area.w - insets.left - insets.right) / 2;
  const cy = insets.top + (area.h - insets.top - insets.bottom) / 2;
  return boundPlanView({ zoom, x: b.x + b.w / 2 - cx / zoom, y: b.y + b.h / 2 - cy / zoom }, area);
}

/**
 * What Fit frames: the box of everything on the plan (items, walls and, unless `background` is
 * false, the background picture), in view units; null on an empty plan.
 */
export function planContentBox(
  plan: Partial<Pick<PlanElement, 'strokes' | 'shapes' | 'icons' | 'walls' | 'background'>>,
  background = true,
): Rect | null {
  const items = planItems({ strokes: plan.strokes, shapes: plan.shapes, icons: plan.icons });
  const boxes: Rect[] = items.map((e) => itemBox(e.item));
  for (const wall of plan.walls ?? []) boxes.push(wallBounds(wall));
  if (background && plan.background && !plan.background.hidden)
    boxes.push(backgroundBox(plan.background));
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}

/** Margin round a plan's content when it is framed, view units, plus a share of its size. */
const FRAME_MARGIN = 28;
const FRAME_SHARE = 0.06;
/** A frame is never narrower than this (view units, about 4.5 m at the nominal scale). */
const FRAME_MIN_W = 400;

/**
 * Where a plan is shown on its card, its slides, sheets and exports (decision 0117): what is
 * drawn on it, with a margin for labels, widened to the plan's 3:2 shape and never narrower than
 * FRAME_MIN_W; the whole extent for an empty plan. View units.
 */
export function planFrame(
  plan: Partial<Pick<PlanElement, 'strokes' | 'shapes' | 'icons' | 'walls' | 'background'>>,
  background = true,
): Rect {
  const box = planContentBox(plan, background);
  if (!box) return { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
  const m = FRAME_MARGIN + FRAME_SHARE * Math.max(box.w, box.h * PLAN_ASPECT);
  let w = Math.max(FRAME_MIN_W, box.w + 2 * m);
  let h = box.h + 2 * m;
  if (w / h > PLAN_ASPECT) h = w / PLAN_ASPECT;
  else w = h * PLAN_ASPECT;
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
}
