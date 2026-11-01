// SPDX-License-Identifier: MPL-2.0
/**
 * Tidying a selection (#320): packing cards into rows or a mosaic of columns with an even gap.
 * Pure geometry; the canvas decides which cards take part and writes the result.
 */
import { boundsOf, type Point, type Rect } from './geometry.ts';

export interface ArrangeItem extends Rect {
  /**
   * How the card's height follows a new width: `ratio` keeps the aspect of everything above
   * `fixed` (an image and its caption), `content` reflows like a note (its area is kept, as an
   * estimate until the card is measured again).
   */
  fit: 'ratio' | 'content';
  /** Height that does not scale with the width (an image's caption). */
  fixed?: number;
}

export interface TidyResult {
  /** New rect of each item, in the input order. */
  rects: Rect[];
  /** Indices of the items in each column (mosaic) or row (rows), top to bottom or left to right. */
  groups: number[][];
}

/** Gap sizes of the Arrange menu, in world units: the 8, 16 and 24 spacing tokens. */
export const TIDY_GAPS = { s: 8, m: 16, l: 24 } as const;
export type TidyGap = keyof typeof TIDY_GAPS;

const MIN_HEIGHT = 40;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** The height `item` takes at width `w`. */
export function heightAtWidth(item: ArrangeItem, w: number): number {
  if (item.w <= 0 || w <= 0) return item.h;
  if (item.fit === 'ratio') {
    const fixed = Math.min(item.fixed ?? 0, item.h);
    return fixed + ((item.h - fixed) * w) / item.w;
  }
  return Math.max(MIN_HEIGHT, (item.h * item.w) / w);
}

/** The width a ratio-locked `item` takes at height `h`; other cards keep their width. */
function widthAtHeight(item: ArrangeItem, h: number): number {
  const fixed = Math.min(item.fixed ?? 0, item.h);
  if (item.fit !== 'ratio' || item.h - fixed <= 0) return item.w;
  return (item.w * (h - fixed)) / (item.h - fixed);
}

/**
 * Indices in reading order: bands from top to bottom, left to right inside a band. A card joins
 * the band above when its top is above the middle of the band's first card.
 */
export function readingOrder(rects: Rect[]): number[] {
  const byTop = rects.map((r, i) => ({ r, i })).sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const out: number[] = [];
  let band: typeof byTop = [];
  let limit = Number.NEGATIVE_INFINITY;
  const flush = () => {
    out.push(...band.sort((a, b) => a.r.x - b.r.x).map(({ i }) => i));
    band = [];
  };
  for (const entry of byTop) {
    if (band.length > 0 && entry.r.y >= limit) flush();
    if (band.length === 0) limit = entry.r.y + entry.r.h / 2;
    band.push(entry);
  }
  flush();
  return out;
}

/** Columns of a mosaic of `n` cards: as many as rows, a little wider when they do not divide. */
export function mosaicColumns(n: number): number {
  return Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n))));
}

/**
 * Packs the items into a mosaic (masonry) of `columns` columns of the same width, the median
 * width of the items, starting at the top-left of their bounds (or `origin`). Each card goes,
 * in reading order, to the shortest column; images keep their aspect ratio.
 */
export function tidyMosaic(
  items: ArrangeItem[],
  gap: number,
  { columns = mosaicColumns(items.length), origin }: { columns?: number; origin?: Point } = {},
): TidyResult {
  const start = origin ?? boundsOf(items);
  if (!start || items.length === 0) return { rects: [], groups: [] };
  const n = Math.max(1, Math.min(columns, items.length));
  const w = Math.round(median(items.map((i) => i.w)));
  const heights = new Array<number>(n).fill(0);
  const groups: number[][] = Array.from({ length: n }, () => []);
  const rects: Rect[] = items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }));
  for (const index of readingOrder(items)) {
    const item = items[index];
    if (!item) continue;
    let column = 0;
    for (let c = 1; c < n; c++) if ((heights[c] ?? 0) < (heights[column] ?? 0)) column = c;
    const h = Math.round(heightAtWidth(item, w));
    rects[index] = {
      x: Math.round(start.x) + column * (w + gap),
      y: Math.round(start.y) + (heights[column] ?? 0),
      w,
      h,
    };
    heights[column] = (heights[column] ?? 0) + h + gap;
    groups[column]?.push(index);
  }
  return { rects, groups: groups.filter((g) => g.length > 0) };
}

/**
 * Packs the items into rows with an even gap: images are scaled to a common row height (the
 * median height of the items) keeping their aspect ratio, other cards keep their size. Rows wrap
 * at about the width that makes the block 4:3, starting at the top-left of the items' bounds.
 */
export function tidyRows(
  items: ArrangeItem[],
  gap: number,
  { origin }: { origin?: Point } = {},
): TidyResult {
  const start = origin ?? boundsOf(items);
  if (!start || items.length === 0) return { rects: [], groups: [] };
  const rowHeight = Math.round(median(items.map((i) => i.h)));
  const sized = items.map((i) =>
    i.fit === 'ratio'
      ? { w: Math.round(widthAtHeight(i, rowHeight)), h: rowHeight }
      : { w: Math.round(i.w), h: Math.round(i.h) },
  );
  const area = sized.reduce((sum, s) => sum + (s.w + gap) * (s.h + gap), 0);
  const limit = Math.max(...sized.map((s) => s.w), Math.sqrt((area * 4) / 3));
  const rects: Rect[] = items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }));
  const groups: number[][] = [];
  let row: number[] = [];
  let x = 0;
  let y = Math.round(start.y);
  let tallest = 0;
  for (const index of readingOrder(items)) {
    const s = sized[index];
    if (!s) continue;
    // A card starts a new row when less than half of it would fit in this one.
    if (row.length > 0 && x + s.w / 2 > limit) {
      groups.push(row);
      y += tallest + gap;
      row = [];
      x = 0;
      tallest = 0;
    }
    rects[index] = { x: Math.round(start.x) + x, y, w: s.w, h: s.h };
    row.push(index);
    x += s.w + gap;
    tallest = Math.max(tallest, s.h);
  }
  if (row.length > 0) groups.push(row);
  return { rects, groups };
}

/**
 * Tops of the cards of each column stacked with `gap` from `top`, once their real heights are
 * known (a note reflows after the mosaic changed its width). Indices outside the groups keep NaN.
 */
export function stackColumns(
  groups: number[][],
  heights: readonly number[],
  top: number,
  gap: number,
): number[] {
  const out = heights.map(() => Number.NaN);
  for (const group of groups) {
    let y = top;
    for (const index of group) {
      out[index] = y;
      y += Math.round(heights[index] ?? 0) + gap;
    }
  }
  return out;
}
