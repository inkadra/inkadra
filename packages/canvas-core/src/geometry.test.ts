// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { boundsOf, intersects, screenToWorld, snap, worldToScreen, zoomAt } from './index.ts';

describe('viewport', () => {
  it('round-trips between screen and world', () => {
    const v = { x: 100, y: -40, zoom: 1.5 };
    const p = { x: 33, y: 71 };
    const back = worldToScreen(v, screenToWorld(v, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('keeps the anchor still when zooming', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(v, anchor);
    const after = screenToWorld(zoomAt(v, anchor, 2), anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 50).zoom).toBe(4);
  });
});

describe('rects', () => {
  it('detects overlap and bounds', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(intersects(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(intersects(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(boundsOf([a, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    expect(snap(30)).toBe(22);
  });
});
