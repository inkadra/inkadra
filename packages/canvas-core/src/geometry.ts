// SPDX-License-Identifier: MPL-2.0
/**
 * Rendering-independent canvas math, shared by the web canvas and the mobile app.
 * The web canvas thread grows this package in wave 1.
 */

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
