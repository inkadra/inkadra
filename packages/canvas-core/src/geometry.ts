// SPDX-License-Identifier: MPL-2.0
/** Rendering-independent canvas math, shared by the web canvas and the mobile app. */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Screen = (world - offset) * zoom. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Spacing of the background dots, in world units. */
export const GRID = 22;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(v: Viewport, p: Point): Point {
  return { x: p.x / v.zoom + v.x, y: p.y / v.zoom + v.y };
}

export function worldToScreen(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom };
}

/** Zooms keeping the world point under `anchor` (screen coordinates) still. */
export function zoomAt(v: Viewport, anchor: Point, zoom: number): Viewport {
  const next = clampZoom(zoom);
  const world = screenToWorld(v, anchor);
  return { zoom: next, x: world.x - anchor.x / next, y: world.y - anchor.y / next };
}

/**
 * Viewport during a two-finger gesture, from where the fingers started (`from`, with the view
 * `v` of that moment) to where they are now (`to`), in screen coordinates. The view pans with
 * the midpoint and zooms by the change in distance, so the world point under the first midpoint
 * stays under the current one.
 */
export function pinchViewport(
  v: Viewport,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
): Viewport {
  const start = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const now = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const zoom = clampZoom(start > 0 && now > 0 ? (v.zoom * now) / start : v.zoom);
  const world = screenToWorld(v, {
    x: (from[0].x + from[1].x) / 2,
    y: (from[0].y + from[1].y) / 2,
  });
  const mid = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  return { zoom, x: world.x - mid.x / zoom, y: world.y - mid.y / zoom };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function snap(value: number, step = GRID): number {
  return Math.round(value / step) * step;
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Rectangle spanned by two corners, in any order (marquee selection). */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** True when `inner` lies completely inside `outer`. */
export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

/** The part of the world visible through a viewport of the given screen size. */
export function visibleWorld(v: Viewport, width: number, height: number): Rect {
  return { x: v.x, y: v.y, w: width / v.zoom, h: height / v.zoom };
}

/** Viewport that shows `r` centred in a screen of the given size, leaving `padding` pixels. */
export function fitRect(
  r: Rect,
  width: number,
  height: number,
  padding = 48,
  maxZoom = 1,
): Viewport {
  const zoom = clampZoom(
    Math.min(
      maxZoom,
      (width - padding * 2) / Math.max(r.w, 1),
      (height - padding * 2) / Math.max(r.h, 1),
    ),
  );
  return {
    zoom,
    x: r.x + r.w / 2 - width / 2 / zoom,
    y: r.y + r.h / 2 - height / 2 / zoom,
  };
}

/** Viewport centred on a world point, keeping the zoom. */
export function centerOn(v: Viewport, p: Point, width: number, height: number): Viewport {
  return { zoom: v.zoom, x: p.x - width / 2 / v.zoom, y: p.y - height / 2 / v.zoom };
}

/** Zoom steps used by the zoom menu and the + / − keys. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? MIN_ZOOM;
}
