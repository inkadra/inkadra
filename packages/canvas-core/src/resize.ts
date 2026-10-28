// SPDX-License-Identifier: MPL-2.0
import { MIN_WIDTH } from './board.ts';
import type { Point, Rect } from './geometry.ts';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface ResizeOptions {
  /** Width / height of the scalable content (images); omitted for free resizing. */
  aspectRatio?: number;
  widthOnly?: boolean;
  /** Caption/border height outside the aspect-constrained content. */
  fixedHeight?: number;
}

/** Resize in world coordinates, keeping the opposite corner stationary even at minimum size. */
export function resizeFromCorner(
  rect: Rect,
  corner: ResizeCorner,
  delta: Point,
  { aspectRatio, fixedHeight = 0, widthOnly = false }: ResizeOptions = {},
): Rect {
  const west = corner.endsWith('w');
  const north = corner.startsWith('n');
  const desiredW = rect.w + (west ? -delta.x : delta.x);
  const desiredH = rect.h + (north ? -delta.y : delta.y);
  let w: number;
  let h: number;
  if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    // Project the pointer onto the constrained diagonal: either pointer axis can resize.
    const projected =
      (desiredW * aspectRatio ** 2 + (desiredH - fixedHeight) * aspectRatio) /
      (aspectRatio ** 2 + 1);
    w = Math.max(MIN_WIDTH, 40 * aspectRatio, projected);
    h = w / aspectRatio + fixedHeight;
  } else {
    w = Math.max(MIN_WIDTH, Math.round(desiredW));
    h = widthOnly ? rect.h : Math.max(40, Math.round(desiredH));
  }
  return {
    x: west ? rect.x + rect.w - w : rect.x,
    y: north && !widthOnly ? rect.y + rect.h - h : rect.y,
    w,
    h,
  };
}
