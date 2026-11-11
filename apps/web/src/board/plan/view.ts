// SPDX-License-Identifier: AGPL-3.0-only
import {
  backgroundBox,
  itemBox,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type Point,
  planItems,
  type Rect,
  type Viewport,
  wallBounds,
} from '@inkadra/canvas-core';

/**
 * The view of a plan's drawing surface (decision 0115): the plan's 3:2 extent drawn inside a
 * surface that fills the area between the panels, panned and zoomed. A view is the board's
 * `Viewport`: screen px = (view units - x, y) × zoom, zoom being px per view unit.
 */

/** An area of the screen, in px, and what covers its edges (bars floating over it). */
export interface Area {
  w: number;
  h: number;
}
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Space kept round what is fitted, px. */
const MARGIN = 24;
/** Steps of the zoom buttons, in percent of the whole drawing fitted to its area. */
export const ZOOM_STEPS = [25, 50, 75, 100, 150, 200, 300, 400, 600, 800];
const MIN_PERCENT = 25;
const MAX_PERCENT = 800;
/** Fit never comes closer than this, so one small icon does not fill the screen. */
const FIT_MAX_PERCENT = 250;
/** Px of the drawing's extent that always stay in view, so the plan cannot be lost. */
const KEEP = 64;

/** The zoom at which the drawing's whole extent fits the area: 100 %. */
export function baseZoom(area: Area): number {
  return Math.max(
    0.01,
    Math.min((area.w - 2 * MARGIN) / PLAN_VIEW_W, (area.h - 2 * MARGIN) / PLAN_VIEW_H),
  );
}

/** The zoom as the percent shown in the zoom control. */
export function zoomPercent(v: Viewport, area: Area): number {
  return Math.round((v.zoom / baseZoom(area)) * 100);
}

const clampZoom = (zoom: number, area: Area) => {
  const base = baseZoom(area);
  return Math.min((base * MAX_PERCENT) / 100, Math.max((base * MIN_PERCENT) / 100, zoom));
};

/** The view moved back so that at least KEEP px of the drawing's extent stay in the area. */
export function boundView(v: Viewport, area: Area): Viewport {
  const keepX = Math.min(KEEP, area.w / 2) / v.zoom;
  const keepY = Math.min(KEEP, area.h / 2) / v.zoom;
  return {
    zoom: v.zoom,
    x: Math.min(PLAN_VIEW_W - keepX, Math.max(keepX - area.w / v.zoom, v.x)),
    y: Math.min(PLAN_VIEW_H - keepY, Math.max(keepY - area.h / v.zoom, v.y)),
  };
}

/** Zoomed to `zoom` keeping the point under `anchor` (px in the area) still, bounded. */
export function zoomAround(v: Viewport, area: Area, zoom: number, anchor: Point): Viewport {
  const next = clampZoom(zoom, area);
  const world = { x: anchor.x / v.zoom + v.x, y: anchor.y / v.zoom + v.y };
  return boundView(
    { zoom: next, x: world.x - anchor.x / next, y: world.y - anchor.y / next },
    area,
  );
}

/** One step of the zoom buttons (or keys) in or out, round the middle of the area. */
export function stepZoom(v: Viewport, area: Area, dir: 1 | -1): Viewport {
  const now = (v.zoom / baseZoom(area)) * 100;
  const next =
    dir > 0
      ? (ZOOM_STEPS.find((s) => s > now + 0.5) ?? MAX_PERCENT)
      : ([...ZOOM_STEPS].reverse().find((s) => s < now - 0.5) ?? MIN_PERCENT);
  return zoomAround(v, area, (baseZoom(area) * next) / 100, { x: area.w / 2, y: area.h / 2 });
}

/** The view panned by (dx, dy) px, bounded. */
export function panBy(v: Viewport, area: Area, dx: number, dy: number): Viewport {
  return boundView({ ...v, x: v.x - dx / v.zoom, y: v.y - dy / v.zoom }, area);
}

/**
 * Two fingers from where they started (`from`, with the view `v` of that moment) to where they
 * are now (`to`), px in the area: the view follows their middle and zooms by their spread, as the
 * board's pinch does (canvas-core `pinchViewport`), within the plan's own limits.
 */
export function pinchView(
  v: Viewport,
  area: Area,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
): Viewport {
  const start = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const now = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const zoom = clampZoom(start > 0 ? (v.zoom * now) / start : v.zoom, area);
  const a = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const world = { x: a.x / v.zoom + v.x, y: a.y / v.zoom + v.y };
  const mid = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  return boundView({ zoom, x: world.x - mid.x / zoom, y: world.y - mid.y / zoom }, area);
}

/**
 * The view that frames `box` (view units) in the middle of what `insets` leave of the area,
 * no closer than FIT_MAX_PERCENT; the whole drawing without a box.
 */
export function fitView(box: Rect | null, area: Area, insets: Insets = NO_INSETS): Viewport {
  const b = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
  const free = {
    w: Math.max(1, area.w - insets.left - insets.right - 2 * MARGIN),
    h: Math.max(1, area.h - insets.top - insets.bottom - 2 * MARGIN),
  };
  const zoom = clampZoom(
    Math.min(free.w / b.w, free.h / b.h, (baseZoom(area) * FIT_MAX_PERCENT) / 100),
    area,
  );
  const cx = insets.left + (area.w - insets.left - insets.right) / 2;
  const cy = insets.top + (area.h - insets.top - insets.bottom) / 2;
  return boundView({ zoom, x: b.x + b.w / 2 - cx / zoom, y: b.y + b.h / 2 - cy / zoom }, area);
}

/**
 * What Fit frames: the box of everything on the plan (items, walls, the background picture),
 * in view units; null on an empty plan.
 */
export function planContentBox(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'> &
    Partial<Pick<PlanElement, 'walls' | 'background'>>,
): Rect | null {
  const boxes: Rect[] = planItems(plan).map((e) => itemBox(e.item));
  for (const wall of plan.walls ?? []) boxes.push(wallBounds(wall));
  if (plan.background && !plan.background.hidden) boxes.push(backgroundBox(plan.background));
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
