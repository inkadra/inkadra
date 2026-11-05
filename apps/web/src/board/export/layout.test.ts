import { describe, expect, it } from 'vitest';
import {
  chunk,
  contentBox,
  fitRegion,
  gridCells,
  PNG_TOTAL_PIXELS,
  pageSize,
  paginateRows,
  pixelRatio,
  pngScales,
  slideCell,
  storyboardCells,
  storyboardGrid,
} from './layout.ts';

describe('page sizes', () => {
  it('turns A4 and Letter for landscape', () => {
    expect(pageSize('a4', 'portrait')).toEqual({ width: 595.28, height: 841.89 });
    expect(pageSize('a4', 'landscape')).toEqual({ width: 841.89, height: 595.28 });
    expect(pageSize('letter', 'landscape')).toEqual({ width: 792, height: 612 });
  });

  it('makes the 16:9 page a landscape slide whatever the orientation', () => {
    expect(pageSize('slide', 'landscape')).toEqual({ width: 960, height: 540 });
    expect(pageSize('slide', 'portrait')).toEqual({ width: 960, height: 540 });
  });

  it('keeps the content inside the margins, header and footer', () => {
    const box = contentBox(600, 800);
    expect(box.x).toBe(36);
    expect(box.x + box.w).toBe(564);
    expect(box.y).toBeGreaterThan(36);
    expect(box.y + box.h).toBeLessThan(800 - 36);
  });
});

describe('storyboard grid', () => {
  it('fits 1, 2, 4 and 6 frames per page for each orientation', () => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      for (const n of [1, 2, 4, 6] as const) {
        const { cols, rows } = storyboardGrid(n, orientation);
        expect(cols * rows).toBe(n);
      }
    }
    expect(storyboardGrid(6, 'landscape')).toEqual({ cols: 3, rows: 2 });
    expect(storyboardGrid(6, 'portrait')).toEqual({ cols: 2, rows: 3 });
    expect(storyboardGrid(2, 'portrait')).toEqual({ cols: 1, rows: 2 });
  });

  it('lays cells out row by row with gutters, filling the box', () => {
    const cells = gridCells({ x: 0, y: 0, w: 218, h: 100 }, 2, 2, 18);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 100, h: 41 });
    expect(cells[1]?.x).toBe(118);
    expect(cells[3]).toEqual({ x: 118, y: 59, w: 100, h: 41 });
  });
});

describe('storyboard cells', () => {
  const box = { x: 0, y: 0, w: 770, h: 470 };

  it('keeps the full column width when the height allows it', () => {
    const cells = storyboardCells(box, 2, 1, 16 / 9, 80, 18);
    expect(cells[0]?.w).toBeCloseTo(376);
    expect(cells[0]?.x).toBe(0);
    expect((cells[1]?.x ?? 0) + (cells[1]?.w ?? 0)).toBeCloseTo(770);
  });

  it('narrows every column to fit the height and centres the grid', () => {
    const cells = storyboardCells(box, 2, 2, 16 / 9, 80, 18);
    const w = cells[0]?.w ?? 0;
    // Each row holds the picture and the text room: (470 - 18) / 2 = 226 = w / aspect + 80.
    expect(w / (16 / 9) + 80).toBeCloseTo(226);
    expect(new Set(cells.map((c) => c.w)).size).toBe(1);
    expect((cells[1]?.x ?? 0) - (cells[0]?.x ?? 0) - w).toBeCloseTo(18);
    expect(cells[0]?.x).toBeCloseTo(770 - ((cells[1]?.x ?? 0) + w));
    expect((cells[3]?.y ?? 0) + (cells[3]?.h ?? 0)).toBeLessThanOrEqual(470.001);
  });
});

describe('pagination', () => {
  it('chunks items, with one empty page when there are none', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 4)).toEqual([[]]);
    expect(chunk([1, 2, 3, 4], 4)).toEqual([[1, 2, 3, 4]]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });

  it('breaks rows before the one that would overflow', () => {
    expect(paginateRows([40, 40, 40, 40], 100)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(paginateRows([60, 30, 10, 50], 100)).toEqual([[0, 1, 2], [3]]);
  });

  it('gives a row taller than a page a page of its own', () => {
    expect(paginateRows([20, 300, 20], 100)).toEqual([[0], [1], [2]]);
    expect(paginateRows([], 100)).toEqual([[]]);
  });
});

describe('fitting', () => {
  it('centres a region and never enlarges past the cap', () => {
    const fit = fitRegion({ x: 100, y: 100, w: 200, h: 100 }, { x: 0, y: 0, w: 400, h: 400 }, 1.5);
    expect(fit.scale).toBe(1.5);
    // The region's centre (200, 150) lands on the box centre (200, 200).
    expect(200 * fit.scale + fit.dx).toBeCloseTo(200);
    expect(150 * fit.scale + fit.dy).toBeCloseTo(200);
    expect(fitRegion({ x: 0, y: 0, w: 2000, h: 500 }, { x: 0, y: 0, w: 500, h: 500 }).scale).toBe(
      0.25,
    );
  });

  it('caps the PNG resolution by side, area and density', () => {
    expect(pixelRatio(2000, 1000)).toBeCloseTo(4096 / 2000);
    expect(pixelRatio(842, 595)).toBe(4);
    expect(pixelRatio(100, 100)).toBe(4);
    expect(pixelRatio(20000, 400) * 20000).toBeLessThanOrEqual(16384);
    const r = pixelRatio(3000, 3000, 100000);
    expect(3000 * r * 3000 * r).toBeLessThanOrEqual(64_000_001);
  });

  it('keeps every page of a long PNG export readable and shrinks only past the pixel budget', () => {
    // QA R2-05: 55 stacked A4 pages came out 107 px wide. One image per page stays near 200 dpi.
    const a4 = { width: 842, height: 595 };
    const long = pngScales(Array.from({ length: 55 }, () => a4));
    expect(long.reduced).toBe(false);
    expect(Math.round(a4.width * (long.scales[0] as number))).toBeGreaterThanOrEqual(2000);
    expect(Math.round(a4.height * (long.scales[0] as number))).toBeGreaterThanOrEqual(1200);
    // A single page keeps the high resolution.
    expect(pngScales([a4]).scales).toEqual([4]);
    const huge = pngScales(Array.from({ length: 300 }, () => a4));
    expect(huge.reduced).toBe(true);
    const pixels = huge.scales.reduce((sum, s) => sum + a4.width * a4.height * s * s, 0);
    expect(pixels).toBeLessThanOrEqual(PNG_TOTAL_PIXELS * 1.001);
  });
});

describe('slide cell', () => {
  // The content box of a 16:9 page.
  const box = contentBox(960, 540);

  it('centres the picture and its caption with a gap from the header', () => {
    const cell = slideCell(box, 16 / 9, () => 60);
    // As tall as the room left by the caption and the two gaps of 18.
    expect(cell.w / (16 / 9) + 60).toBeCloseTo(box.h - 36);
    expect(cell.y - box.y).toBeCloseTo(18);
    expect(box.y + box.h - (cell.y + cell.h)).toBeCloseTo(18);
    expect(cell.x - box.x).toBeCloseTo(box.x + box.w - (cell.x + cell.w));
  });

  it('keeps room for a caption that grows as the picture narrows', () => {
    // One more line of 15 for every 100 points the picture loses from the full width.
    const caption = (w: number) => 60 + 15 * Math.ceil((box.w - w) / 100);
    const cell = slideCell(box, 16 / 9, caption);
    expect(cell.h - cell.w / (16 / 9)).toBeGreaterThanOrEqual(caption(cell.w) - 0.001);
    expect(cell.y).toBeGreaterThanOrEqual(box.y + 18 - 0.001);
    expect(cell.y + cell.h).toBeLessThanOrEqual(box.y + box.h - 18 + 0.001);
  });

  it('cuts a very long caption at half the room rather than shrink the picture away', () => {
    const cell = slideCell(box, 16 / 9, () => 10_000);
    expect(cell.w / (16 / 9)).toBeCloseTo((box.h - 36) / 2);
    expect(cell.h).toBeCloseTo(box.h - 36);
  });
});
