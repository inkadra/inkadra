// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  intersects,
  MAX_ZOOM,
  MIN_ZOOM,
  pinchViewport,
  screenToWorld,
  snap,
  worldToScreen,
  zoomAt,
} from './index.ts';

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

describe('two-finger gesture', () => {
  const v = { x: 100, y: -40, zoom: 1.5 };
  const a = { x: 100, y: 200 };
  const b = { x: 300, y: 200 };

  it('pans with the midpoint when the distance stays the same', () => {
    const next = pinchViewport(
      v,
      [a, b],
      [
        { x: 130, y: 150 },
        { x: 330, y: 150 },
      ],
    );
    expect(next.zoom).toBeCloseTo(1.5);
    expect(next.x).toBeCloseTo(100 - 30 / 1.5);
    expect(next.y).toBeCloseTo(-40 + 50 / 1.5);
  });

  it('zooms by the distance ratio around the midpoint', () => {
    const next = pinchViewport(
      v,
      [a, b],
      [
        { x: 50, y: 200 },
        { x: 350, y: 200 },
      ],
    );
    expect(next.zoom).toBeCloseTo(2.25);
    const mid = { x: 200, y: 200 };
    expect(screenToWorld(next, mid).x).toBeCloseTo(screenToWorld(v, mid).x);
    expect(screenToWorld(next, mid).y).toBeCloseTo(screenToWorld(v, mid).y);
  });

  it('keeps the world point of the first midpoint under the moved midpoint', () => {
    const to = [
      { x: 20, y: 400 },
      { x: 180, y: 520 },
    ] as const;
    const next = pinchViewport(v, [a, b], to);
    expect(next.zoom).toBeCloseTo(1.5 * (200 / 200));
    const world = screenToWorld(next, { x: 100, y: 460 });
    expect(world.x).toBeCloseTo(screenToWorld(v, { x: 200, y: 200 }).x);
    expect(world.y).toBeCloseTo(screenToWorld(v, { x: 200, y: 200 }).y);
  });

  it('uses the same zoom limits as the wheel', () => {
    const far = pinchViewport(
      v,
      [a, b],
      [
        { x: 199, y: 200 },
        { x: 201, y: 200 },
      ],
    );
    expect(far.zoom).toBe(MIN_ZOOM);
    const near = pinchViewport(
      v,
      [a, b],
      [
        { x: -2000, y: 200 },
        { x: 2400, y: 200 },
      ],
    );
    expect(near.zoom).toBe(MAX_ZOOM);
    // Clamped, the midpoint still holds its world point.
    const mid = screenToWorld(near, { x: 200, y: 200 });
    expect(mid.x).toBeCloseTo(screenToWorld(v, { x: 200, y: 200 }).x);
  });

  it('zooms out as far as it goes when the fingers meet', () => {
    const mid = { x: 200, y: 200 };
    const next = pinchViewport(v, [a, b], [mid, mid]);
    expect(next.zoom).toBe(MIN_ZOOM);
    expect(screenToWorld(next, mid).x).toBeCloseTo(screenToWorld(v, mid).x);
    expect(screenToWorld(next, mid).y).toBeCloseTo(screenToWorld(v, mid).y);
  });

  it('only pans when the fingers start on the same spot', () => {
    const next = pinchViewport(
      v,
      [a, a],
      [
        { x: 110, y: 200 },
        { x: 150, y: 200 },
      ],
    );
    expect(next.zoom).toBe(1.5);
    expect(next.x).toBeCloseTo(100 - 30 / 1.5);
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
