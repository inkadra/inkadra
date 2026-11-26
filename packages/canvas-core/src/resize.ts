// SPDX-License-Identifier: MPL-2.0
import type { ElementType } from '@inkadra/doc-schema';
import { MIN_WIDTH, TEXT_MIN_WIDTH } from './board.ts';
import type { Point, Rect } from './geometry.ts';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface ResizeOptions {
  /** Width / height of the scalable content (images); omitted for free resizing. */
  aspectRatio?: number;
  widthOnly?: boolean;
  /** Caption/border height outside the aspect-constrained content. */
  fixedHeight?: number;
  /** Narrowest width where the card's content still reads; default MIN_WIDTH. */
  minWidth?: number;
  /** Lowest height of a freely resized card; default MIN_HEIGHT. */
  minHeight?: number;
}

export const MIN_HEIGHT = 40;

/**
 * The smallest a resize leaves a card (#27), in world units: wide enough for its name to break
 * between words (pictures and colours keep 80), and a table tall enough for its header and a
 * row. Cards with a stored height whose content has a fixed size (files, maps, board cards,
 * locations, colours) also never get shorter than that content, which only the client that
 * draws them can measure.
 */
export function minCardSize(type: ElementType): { w: number; h: number } {
  return {
    w: type === 'image' || type === 'color' ? MIN_WIDTH : TEXT_MIN_WIDTH,
    h: type === 'table' ? 64 : MIN_HEIGHT,
  };
}

/** Resize in world coordinates, keeping the opposite corner stationary even at minimum size. */
export function resizeFromCorner(
  rect: Rect,
  corner: ResizeCorner,
  delta: Point,
  {
    aspectRatio,
    fixedHeight = 0,
    widthOnly = false,
    minWidth = MIN_WIDTH,
    minHeight = MIN_HEIGHT,
  }: ResizeOptions = {},
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
    w = Math.max(minWidth, 40 * aspectRatio, projected);
    h = w / aspectRatio + fixedHeight;
  } else {
    w = Math.max(minWidth, Math.round(desiredW));
    h = widthOnly ? rect.h : Math.max(minHeight, Math.round(desiredH));
  }
  return {
    x: west ? rect.x + rect.w - w : rect.x,
    y: north && !widthOnly ? rect.y + rect.h - h : rect.y,
    w,
    h,
  };
}
