// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { dropIndex } from './column.ts';
import { alignRects, distributeRects, snapRect } from './snap.ts';

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
