// SPDX-License-Identifier: MPL-2.0
import { MIN_WIDTH } from './board.ts';
import { type Point, type Rect, snap } from './geometry.ts';
import type { ResizeCorner, ResizeOptions } from './resize.ts';

/** A guide drawn while dragging: a vertical (x) or horizontal (y) line in world units. */
export interface Guide {
  axis: 'x' | 'y';
  /** Position on the axis: x for a vertical line, y for a horizontal one. */
  at: number;
  from: number;
  to: number;
}

export interface SnapResult {
  /** Correction to add to the dragged position. */
  dx: number;
  dy: number;
  guides: Guide[];
}

const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

/**
 * Aligns the edges and centre of `moving` with those of `others` when they are closer than
 * `threshold` (world units; pass screen pixels divided by the zoom). Each axis snaps on its own.
 */
export function snapRect(moving: Rect, others: Rect[], threshold: number): SnapResult {
  let bestX: { diff: number; at: number } | null = null;
  let bestY: { diff: number; at: number } | null = null;
  const mx = xs(moving);
  const my = ys(moving);
  for (const o of others) {
    for (const ox of xs(o)) {
      for (const v of mx) {
        const diff = ox - v;
        if (Math.abs(diff) <= threshold && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) {
          bestX = { diff, at: ox };
        }
      }
    }
    for (const oy of ys(o)) {
      for (const v of my) {
        const diff = oy - v;
        if (Math.abs(diff) <= threshold && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) {
          bestY = { diff, at: oy };
        }
      }
    }
  }

  const dx = bestX?.diff ?? 0;
  const dy = bestY?.diff ?? 0;
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  const eps = 0.5;
  if (bestX) {
    const at = bestX.at;
    const touching = others.filter((o) => xs(o).some((v) => Math.abs(v - at) < eps));
    const all = [snapped, ...touching];
    guides.push({
      axis: 'x',
      at,
      from: Math.min(...all.map((r) => r.y)),
      to: Math.max(...all.map((r) => r.y + r.h)),
    });
  }
  if (bestY) {
    const at = bestY.at;
    const touching = others.filter((o) => ys(o).some((v) => Math.abs(v - at) < eps));
    const all = [snapped, ...touching];
    guides.push({
      axis: 'y',
      at,
      from: Math.min(...all.map((r) => r.x)),
      to: Math.max(...all.map((r) => r.x + r.w)),
    });
  }
  return { dx, dy, guides };
}

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** New positions that align every rect to the bounds of the group. Keys follow the input order. */
export function alignRects(rects: Rect[], how: Alignment): Array<{ x: number; y: number }> {
  if (rects.length === 0) return [];
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return rects.map((r) => {
    switch (how) {
      case 'left':
        return { x: minX, y: r.y };
      case 'center':
        return { x: (minX + maxX) / 2 - r.w / 2, y: r.y };
      case 'right':
        return { x: maxX - r.w, y: r.y };
      case 'top':
        return { x: r.x, y: minY };
      case 'middle':
        return { x: r.x, y: (minY + maxY) / 2 - r.h / 2 };
      default:
        return { x: r.x, y: maxY - r.h };
    }
  });
}

/**
 * Spreads rects so the gaps between them are equal along `axis` (x: horizontally), or along the
 * axis they span the most when it is omitted.
 */
export function distributeRects(rects: Rect[], axis?: 'x' | 'y'): Array<{ x: number; y: number }> {
  if (rects.length < 3) return rects.map((r) => ({ x: r.x, y: r.y }));
  const spanX = Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x));
  const spanY = Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y));
  const horizontal = axis ? axis === 'x' : spanX >= spanY;
  const order = rects
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (horizontal ? a.r.x - b.r.x : a.r.y - b.r.y));
  const first = order[0]?.r;
  const last = order.at(-1)?.r;
  if (!first || !last) return [];
  const total = order.reduce((s, { r }) => s + (horizontal ? r.w : r.h), 0);
  const span = horizontal ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (order.length - 1);
  const out: Array<{ x: number; y: number }> = rects.map((r) => ({ x: r.x, y: r.y }));
  let cursor = horizontal ? first.x : first.y;
  for (const { r, i } of order) {
    out[i] = horizontal ? { x: cursor, y: r.y } : { x: r.x, y: cursor };
    cursor += (horizontal ? r.w : r.h) + gap;
  }
  return out;
}

/**
 * Where a dragged rect lands: aligned to the other cards when an edge or centre is within
 * `threshold`, and, on each axis no guide took, with its top-left corner on the world grid when
 * `grid` is set. A guide within reach always wins over the grid. `guides: false` skips the
 * guides (Alt held).
 */
export function snapMove(
  moving: Rect,
  others: Rect[],
  threshold: number,
  { grid = null, guides = true }: { grid?: number | null; guides?: boolean } = {},
): SnapResult {
  const s = guides ? snapRect(moving, others, threshold) : { dx: 0, dy: 0, guides: [] };
  if (!grid) return s;
  const byX = s.guides.some((g) => g.axis === 'x');
  const byY = s.guides.some((g) => g.axis === 'y');
  return {
    dx: byX ? s.dx : snap(moving.x, grid) - moving.x,
    dy: byY ? s.dy : snap(moving.y, grid) - moving.y,
    guides: s.guides,
  };
}

/** A point on the world grid (a new card's corner, an arrow's free end). */
export function snapPoint(p: Point, grid: number): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

const MIN_HEIGHT = 40;

/**
 * Puts the edges a resize drags on the world grid; the opposite edges stay where they are.
 * Ratio-locked cards (images) snap the dragged side edge and keep their ratio; cards that only
 * change width (links) snap that edge alone. Never smaller than the minimum size.
 */
export function snapResize(
  rect: Rect,
  corner: ResizeCorner,
  grid: number,
  { aspectRatio, fixedHeight = 0, widthOnly = false }: ResizeOptions = {},
): Rect {
  const west = corner.endsWith('w');
  const north = corner.startsWith('n');
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  let x = rect.x;
  let w = rect.w;
  if (west) {
    x = snap(rect.x, grid);
    while (right - x < MIN_WIDTH) x -= grid;
    w = right - x;
  } else {
    let r = snap(right, grid);
    while (r - rect.x < MIN_WIDTH) r += grid;
    w = r - rect.x;
  }
  let y = rect.y;
  let h = rect.h;
  if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    h = w / aspectRatio + fixedHeight;
    if (north) y = bottom - h;
  } else if (!widthOnly) {
    if (north) {
      y = snap(rect.y, grid);
      while (bottom - y < MIN_HEIGHT) y -= grid;
      h = bottom - y;
    } else {
      let b = snap(bottom, grid);
      while (b - rect.y < MIN_HEIGHT) b += grid;
      h = b - rect.y;
    }
  }
  return { x, y, w, h };
}
