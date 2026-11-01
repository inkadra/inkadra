// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { dropIndex } from './column.ts';
import { alignRects, distributeRects, snapMove, snapPoint, snapRect, snapResize } from './snap.ts';

describe('snapping', () => {
  it('snaps to the nearest edge on each axis and reports guides', () => {
    const other = { x: 100, y: 100, w: 100, h: 50 };
    const r = snapRect({ x: 103, y: 300, w: 80, h: 40 }, [other], 6);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', at: 100, from: 100, to: 340 }]);
  });

  it('leaves far rects alone', () => {
    const r = snapRect({ x: 0, y: 0, w: 10, h: 10 }, [{ x: 500, y: 500, w: 5, h: 5 }], 6);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('aligns and distributes', () => {
    const rects = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 5, w: 10, h: 20 },
      { x: 100, y: 3, w: 20, h: 10 },
    ];
    expect(alignRects(rects, 'top').map((p) => p.y)).toEqual([0, 0, 0]);
    expect(alignRects(rects, 'right').map((p) => p.x)).toEqual([110, 110, 100]);
    const spread = distributeRects([rects[0]!, { ...rects[1]!, x: 20 }, rects[2]!]);
    expect(spread.map((p) => p.x)).toEqual([0, 50, 100]);
  });

  it('finds the drop index in a column', () => {
    const kids = [
      { top: 0, height: 40 },
      { top: 48, height: 40 },
    ];
    expect(dropIndex(kids, 10)).toBe(0);
    expect(dropIndex(kids, 30)).toBe(1);
    expect(dropIndex(kids, 200)).toBe(2);
  });
});

describe('snap to grid', () => {
  const far = [{ x: 1000, y: 1000, w: 50, h: 50 }];

  it('puts the top-left corner of a moved rect on the 22-unit grid', () => {
    const r = snapMove({ x: 30, y: 50, w: 100, h: 60 }, far, 6, { grid: 22 });
    expect(r).toEqual({ dx: -8, dy: -6, guides: [] });
    // Negative coordinates round to the nearest step too.
    const n = snapMove({ x: -30, y: -12, w: 10, h: 10 }, [], 6, { grid: 22 });
    expect([-30 + n.dx, -12 + n.dy]).toEqual([-22, -22]);
  });

  it('leaves the position alone without a grid', () => {
    expect(snapMove({ x: 30, y: 50, w: 100, h: 60 }, far, 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('lets a guide within reach win over the grid, axis by axis', () => {
    // The left edge is 3 units from another card's: the guide takes x, the grid takes y.
    const other = { x: 103, y: 400, w: 80, h: 40 };
    const r = snapMove({ x: 100, y: 50, w: 80, h: 40 }, [other], 6, { grid: 22 });
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(44 - 50);
    expect(r.guides.map((g) => g.axis)).toEqual(['x']);
  });

  it('skips the guides when asked (Alt held) but still snaps to the grid', () => {
    const other = { x: 103, y: 400, w: 80, h: 40 };
    const r = snapMove({ x: 100, y: 50, w: 80, h: 40 }, [other], 6, { grid: 22, guides: false });
    expect(r).toEqual({ dx: 10, dy: -6, guides: [] });
  });

  it('snaps points', () => {
    expect(snapPoint({ x: 12, y: 32 }, 22)).toEqual({ x: 22, y: 22 });
  });

  it('snaps the dragged edges of a resize and keeps the opposite ones', () => {
    const se = snapResize({ x: 22, y: 44, w: 205, h: 97 }, 'se', 22);
    expect(se).toEqual({ x: 22, y: 44, w: 198, h: 88 });
    const nw = snapResize({ x: 15, y: 30, w: 205, h: 110 }, 'nw', 22);
    expect(nw).toEqual({ x: 22, y: 22, w: 198, h: 118 });
    // The right and bottom edges did not move.
    expect(nw.x + nw.w).toBe(220);
    expect(nw.y + nw.h).toBe(140);
  });

  it('never makes a card smaller than the minimum when snapping', () => {
    const r = snapResize({ x: 0, y: 0, w: 85, h: 41 }, 'se', 22);
    expect(r.w).toBeGreaterThanOrEqual(80);
    expect(r.h).toBeGreaterThanOrEqual(40);
    expect((r.x + r.w) % 22).toBe(0);
    expect((r.y + r.h) % 22).toBe(0);
  });

  it('snaps the free edge of an image and keeps its ratio', () => {
    const r = snapResize({ x: 0, y: 0, w: 205, h: 205 / 2 + 20 }, 'se', 22, {
      aspectRatio: 2,
      fixedHeight: 20,
    });
    expect(r.w).toBe(198);
    expect(r.h).toBe(99 + 20);
    const north = snapResize({ x: 13, y: 0, w: 207, h: 207 / 2 }, 'nw', 22, { aspectRatio: 2 });
    expect(north.x).toBe(22);
    expect(north.w).toBe(198);
    expect(north.y + north.h).toBeCloseTo(207 / 2);
  });

  it('snaps only the width of width-only cards', () => {
    expect(snapResize({ x: 0, y: 0, w: 230, h: 77 }, 'se', 22, { widthOnly: true })).toEqual({
      x: 0,
      y: 0,
      w: 220,
      h: 77,
    });
  });
});
