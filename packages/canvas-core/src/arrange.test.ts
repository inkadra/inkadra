// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  type ArrangeItem,
  heightAtWidth,
  mosaicColumns,
  readingOrder,
  stackColumns,
  TIDY_GAPS,
  tidyMosaic,
  tidyRows,
} from './arrange.ts';
import { alignRects, distributeRects } from './snap.ts';

const image = (x: number, y: number, w: number, h: number, fixed = 0): ArrangeItem => ({
  x,
  y,
  w,
  h,
  fit: 'ratio',
  fixed,
});

describe('align and distribute', () => {
  const rects = [
    { x: 10, y: 0, w: 40, h: 20 },
    { x: 100, y: 30, w: 20, h: 40 },
    { x: 60, y: 90, w: 30, h: 10 },
  ];

  it('aligns every edge and centre to the bounds of the group', () => {
    expect(alignRects(rects, 'left').map((p) => p.x)).toEqual([10, 10, 10]);
    expect(alignRects(rects, 'right').map((p) => p.x)).toEqual([80, 100, 90]);
    expect(alignRects(rects, 'center').map((p) => p.x)).toEqual([45, 55, 50]);
    expect(alignRects(rects, 'bottom').map((p) => p.y)).toEqual([80, 60, 90]);
    expect(alignRects(rects, 'middle').map((p) => p.y)).toEqual([40, 30, 45]);
  });

  it('distributes on the axis asked for, with equal gaps', () => {
    const across = distributeRects(rects, 'x');
    // Sorted by x: 10..50, 60..90, 100..120 → the gaps are both 10.
    expect(across.map((p) => p.x)).toEqual([10, 100, 60]);
    const down = distributeRects(rects, 'y');
    // Sorted by y: 0..20, 30..70, 90..100: 30 units of room left, so two gaps of 15.
    expect(down.map((p) => p.y)).toEqual([0, 35, 90]);
    expect(down.map((p) => p.x)).toEqual([10, 100, 60]);
  });
});

describe('tidy up', () => {
  it('reads cards in bands, left to right', () => {
    const order = readingOrder([
      { x: 300, y: 10, w: 100, h: 100 },
      { x: 0, y: 30, w: 100, h: 100 },
      { x: 150, y: 400, w: 100, h: 100 },
      { x: 0, y: 380, w: 100, h: 100 },
    ]);
    expect(order).toEqual([1, 0, 3, 2]);
  });

  it('scales images by their ratio and notes by their area', () => {
    expect(heightAtWidth(image(0, 0, 200, 100), 100)).toBe(50);
    // A 30-unit caption does not scale.
    expect(heightAtWidth(image(0, 0, 200, 130, 30), 100)).toBe(80);
    expect(heightAtWidth({ x: 0, y: 0, w: 100, h: 200, fit: 'content' }, 200)).toBe(100);
  });

  it('picks about as many columns as rows', () => {
    expect([1, 2, 4, 5, 9, 10].map(mosaicColumns)).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it('packs a mosaic of equal columns with an even gap', () => {
    const gap = TIDY_GAPS.m;
    const items = [
      image(13, 7, 200, 100),
      image(400, 20, 200, 300),
      image(30, 300, 100, 100),
      image(260, 310, 300, 150),
    ];
    const { rects, groups } = tidyMosaic(items, gap);
    expect(rects.every((r) => r.w === 200)).toBe(true);
    // Starts at the top-left of the selection.
    expect(rects[0]).toEqual({ x: 13, y: 7, w: 200, h: 100 });
    expect(rects[1]).toEqual({ x: 13 + 200 + gap, y: 7, w: 200, h: 300 });
    // Each next card goes under the shortest column: the square under the first, the wide one
    // under the tall one.
    expect(rects[2]).toEqual({ x: 13, y: 7 + 100 + gap, w: 200, h: 200 });
    expect(rects[3]).toEqual({ x: 13 + 200 + gap, y: 7 + 300 + gap, w: 200, h: 100 });
    expect(groups).toEqual([
      [0, 2],
      [1, 3],
    ]);
    // Every image kept its aspect ratio.
    items.forEach((item, i) => {
      const r = rects[i]!;
      expect(r.w / r.h).toBeCloseTo(item.w / item.h);
    });
  });

  it('packs a mosaic of N columns when asked, from a given corner', () => {
    const items = [image(0, 0, 100, 100), image(0, 0, 100, 100), image(0, 0, 100, 100)];
    const { rects } = tidyMosaic(items, 8, { columns: 3, origin: { x: 44, y: 66 } });
    expect(rects.map((r) => [r.x, r.y])).toEqual([
      [44, 66],
      [152, 66],
      [260, 66],
    ]);
  });

  it('packs rows of matching height with an even gap', () => {
    const gap = TIDY_GAPS.s;
    const items = [
      image(0, 0, 200, 100),
      image(300, 0, 100, 100),
      image(0, 200, 150, 200),
      { x: 300, y: 200, w: 120, h: 80, fit: 'content' as const },
    ];
    const { rects, groups } = tidyRows(items, gap);
    // The median height is 100: images are scaled to it, the note keeps its size.
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(rects[1]).toEqual({ x: 200 + gap, y: 0, w: 100, h: 100 });
    expect(rects[2]?.h).toBe(100);
    expect(rects[2]?.w).toBe(75);
    expect(rects[3]).toMatchObject({ w: 120, h: 80 });
    // Neighbours in a row are one gap apart; rows are one gap under the tallest card above.
    for (const row of groups) {
      for (let i = 1; i < row.length; i++) {
        const a = rects[row[i - 1]!]!;
        const b = rects[row[i]!]!;
        expect(b.x - (a.x + a.w)).toBe(gap);
        expect(b.y).toBe(a.y);
      }
    }
    expect(groups.length).toBeGreaterThan(1);
    const second = rects[groups[1]![0]!]!;
    expect(second.y).toBe(100 + gap);
  });

  it('restacks the columns once real heights are known', () => {
    expect(stackColumns([[0, 2], [1]], [100, 40, 60], 10, 8)).toEqual([10, 10, 118]);
  });

  it('does nothing without cards', () => {
    expect(tidyMosaic([], 8)).toEqual({ rects: [], groups: [] });
    expect(tidyRows([], 8)).toEqual({ rects: [], groups: [] });
  });
});
