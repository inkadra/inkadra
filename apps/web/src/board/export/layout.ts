// SPDX-License-Identifier: AGPL-3.0-only
/** Page sizes, margins and grids of an export, in PDF points. Pure maths, unit tested. */

export type PaperSize = 'a4' | 'letter';
export type Orientation = 'portrait' | 'landscape';
export type FramesPerPage = 1 | 2 | 4 | 6;
export const FRAMES_PER_PAGE: readonly FramesPerPage[] = [1, 2, 4, 6];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAPER: Record<PaperSize, { w: number; h: number }> = {
  // 210 × 297 mm and 8.5 × 11 in.
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
};

export function pageSize(paper: PaperSize, orientation: Orientation) {
  const { w, h } = PAPER[paper];
  return orientation === 'portrait' ? { width: w, height: h } : { width: h, height: w };
}

export const MARGIN = 36;
export const HEADER = 30;
export const FOOTER = 24;

/** Area between the running header and footer of a page. */
export function contentBox(width: number, height: number): Box {
  return {
    x: MARGIN,
    y: MARGIN + HEADER,
    w: width - MARGIN * 2,
    h: height - MARGIN * 2 - HEADER - FOOTER,
  };
}

/** Columns and rows of a storyboard page: wide pages put more frames side by side. */
export function storyboardGrid(perPage: FramesPerPage, orientation: Orientation) {
  const landscape = orientation === 'landscape';
  switch (perPage) {
    case 1:
      return { cols: 1, rows: 1 };
    case 2:
      return landscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
    case 4:
      return { cols: 2, rows: 2 };
    case 6:
      return landscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
  }
}

export const GUTTER = 18;

/** Boxes of the cells of a grid inside `box`, row by row. */
export function gridCells(box: Box, cols: number, rows: number, gutter = GUTTER): Box[] {
  const w = (box.w - gutter * (cols - 1)) / cols;
  const h = (box.h - gutter * (rows - 1)) / rows;
  const cells: Box[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: box.x + c * (w + gutter), y: box.y + r * (h + gutter), w, h });
    }
  }
  return cells;
}

/** Items in consecutive pages of `perPage`; an empty list still makes one (empty) page. */
export function chunk<T>(items: readonly T[], perPage: number): T[][] {
  if (perPage < 1) throw new RangeError('perPage must be at least 1');
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}

/**
 * Splits rows of known heights into pages of at most `available` points. A row taller than a
 * page gets a page of its own (the caller clips it).
 */
export function paginateRows(heights: readonly number[], available: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (current.length > 0 && used + h > available) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += h;
  });
  if (current.length > 0 || pages.length === 0) pages.push(current);
  return pages;
}

/** Scale and offset that fit a region of the board, centred, inside a box. */
export function fitRegion(region: Box, into: Box, maxScale = 1.5) {
  const scale = Math.min(into.w / region.w, into.h / region.h, maxScale);
  return {
    scale,
    dx: into.x + (into.w - region.w * scale) / 2 - region.x * scale,
    dy: into.y + (into.h - region.h * scale) / 2 - region.y * scale,
  };
}

/**
 * Pixels per point of a PNG: the longer side of the page lands at `target` pixels, at most
 * 4 (288 dpi), and the canvas stays within what browsers draw (16384 px a side, 64 megapixels).
 */
export function pixelRatio(width: number, height: number, target = 4096): number {
  const byTarget = Math.min(4, target / Math.max(width, height));
  const bySide = 16384 / Math.max(width, height);
  const byArea = Math.sqrt(64_000_000 / (width * height));
  return Math.max(0.1, Math.min(byTarget, bySide, byArea));
}
