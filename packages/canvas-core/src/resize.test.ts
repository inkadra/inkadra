// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { type ResizeCorner, resizeFromCorner } from './resize.ts';

const rect = { x: 100, y: 200, w: 240, h: 180 };
const corners: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

function opposite(r: typeof rect, corner: ResizeCorner) {
  return {
    x: corner.endsWith('w') ? r.x + r.w : r.x,
    y: corner.startsWith('n') ? r.y + r.h : r.y,
  };
}

describe('corner resize', () => {
  for (const corner of corners) {
    it(`resizes both axes from ${corner} and keeps the opposite corner fixed`, () => {
      const delta = {
        x: corner.endsWith('w') ? -60 : 60,
        y: corner.startsWith('n') ? -30 : 30,
      };
      const next = resizeFromCorner(rect, corner, delta);
      expect(next.w).toBe(300);
      expect(next.h).toBe(210);
      expect(opposite(next, corner)).toEqual(opposite(rect, corner));
    });

    it(`clamps ${corner} at minimum size without flipping or moving the anchor`, () => {
      const next = resizeFromCorner(rect, corner, {
        x: corner.endsWith('w') ? 1000 : -1000,
        y: corner.startsWith('n') ? 1000 : -1000,
      });
      expect(next.w).toBe(80);
      expect(next.h).toBe(40);
      expect(opposite(next, corner)).toEqual(opposite(rect, corner));
    });

    it(`preserves image ratio and caption height when dragging ${corner}`, () => {
      const image = { ...rect, h: 210 };
      const next = resizeFromCorner(
        image,
        corner,
        {
          x: corner.endsWith('w') ? -80 : 80,
          y: corner.startsWith('n') ? -60 : 60,
        },
        { aspectRatio: 4 / 3, fixedHeight: 30 },
      );
      expect(next.w).toBeCloseTo(320);
      expect(next.h).toBeCloseTo(270);
      expect(next.w / (next.h - 30)).toBeCloseTo(4 / 3);
      expect(opposite(next, corner)).toEqual(opposite(image, corner));
    });
  }

  it('responds to either pointer axis for constrained images', () => {
    const options = { aspectRatio: 4 / 3 };
    expect(resizeFromCorner(rect, 'se', { x: 60, y: 0 }, options).w).toBeGreaterThan(rect.w);
    expect(resizeFromCorner(rect, 'se', { x: 0, y: 60 }, options).h).toBeGreaterThan(rect.h);
  });

  it('preserves ratio and minimum content height even past the anchor', () => {
    const next = resizeFromCorner(
      rect,
      'nw',
      { x: 1000, y: 1000 },
      { aspectRatio: 4, fixedHeight: 20 },
    );
    expect(next.w).toBe(160);
    expect(next.h).toBe(60);
    expect(opposite(next, 'nw')).toEqual(opposite(rect, 'nw'));
  });

  it('does not accumulate drift across repeated pointer moves', () => {
    const options = { aspectRatio: 1.5, fixedHeight: 20 };
    const start = { ...rect, h: 180 };
    const next = resizeFromCorner(start, 'nw', { x: -37.25, y: 18.75 }, options);
    expect(next.x + next.w).toBeCloseTo(start.x + start.w);
    expect(next.y + next.h).toBeCloseTo(start.y + start.h);
    expect(resizeFromCorner(start, 'nw', { x: 0, y: 0 }, options)).toEqual(start);
  });
});

it.each(['nw', 'ne', 'sw', 'se'] as const)(
  'keeps a width-only card top fixed from %s',
  (corner) => {
    const rect = { x: 20, y: 30, w: 320, h: 180 };
    const next = resizeFromCorner(rect, corner, { x: 50, y: -200 }, { widthOnly: true });
    expect(next.y).toBe(30);
    expect(next.h).toBe(180);
    expect(next.w).toBe(corner.endsWith('w') ? 270 : 370);
    expect(next.x + next.w).toBe(corner.endsWith('w') ? 340 : 390);
  },
);
