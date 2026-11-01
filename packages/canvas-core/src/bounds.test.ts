// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  boundViewport,
  clampViewport,
  gestureArea,
  minZoomFor,
  panArea,
  rubberBand,
} from './bounds.ts';

const W = 1000;
const H = 600;
const content = { x: 0, y: 0, w: 2000, h: 1000 };

describe('panArea', () => {
  it('adds half a viewport on each side of the content', () => {
    expect(panArea(content, W, H)).toEqual({ x: -500, y: -300, w: 3000, h: 1600 });
  });

  it('gives an empty board a centred area of two viewports', () => {
    expect(panArea(null, W, H)).toEqual({ x: -500, y: -300, w: 2000, h: 1200 });
  });

  it('grows with what is on screen, so a view outside never jumps', () => {
    const area = panArea(content, W, H);
    expect(gestureArea(area, { x: 4000, y: 0, w: 1000, h: 600 })).toEqual({
      x: -500,
      y: -300,
      w: 5500,
      h: 1600,
    });
  });
});

describe('clampViewport', () => {
  const area = panArea(content, W, H);

  it('keeps the view inside the area', () => {
    expect(clampViewport({ x: 9999, y: -9999, zoom: 1 }, area, W, H)).toEqual({
      x: 1500,
      y: -300,
      zoom: 1,
    });
    expect(clampViewport({ x: 100, y: 100, zoom: 1 }, area, W, H)).toEqual({
      x: 100,
      y: 100,
      zoom: 1,
    });
  });

  it('stops zooming out when the whole area fits', () => {
    const min = minZoomFor(area, W, H);
    expect(min).toBeCloseTo(1000 / 3000);
    expect(clampViewport({ x: 0, y: 0, zoom: 0.1 }, area, W, H).zoom).toBeCloseTo(min);
  });

  it('lets a small area sit anywhere inside the view at the farthest zoom', () => {
    const v = clampViewport({ x: -500, y: -1000, zoom: 1 / 3 }, area, W, H);
    // Taller than needed: the area is held whole, top or bottom.
    expect(v.y).toBeGreaterThanOrEqual(-300 + 1600 - H * 3);
    expect(v.y).toBeLessThanOrEqual(-300);
  });
});

describe('rubberBand', () => {
  it('gives way less and less, and never reaches the dimension', () => {
    expect(rubberBand(0, 1000)).toBe(0);
    const small = rubberBand(100, 1000);
    const big = rubberBand(2000, 1000);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(100);
    expect(big).toBeLessThan(1000);
    expect(rubberBand(-100, 1000)).toBeCloseTo(-small);
  });
});

describe('boundViewport', () => {
  const area = panArea(content, W, H);

  it('pulls past the edge with resistance when elastic, and stops when not', () => {
    const raw = { x: 1500 + 200, y: 0, zoom: 1 };
    const elastic = boundViewport(raw, area, W, H, true);
    expect(elastic.viewport.x).toBeGreaterThan(1500);
    expect(elastic.viewport.x).toBeLessThan(1700);
    expect(elastic.overshoot.x).toBeCloseTo(elastic.viewport.x - 1500);
    expect(elastic.overshoot.y).toBe(0);
    const stiff = boundViewport(raw, area, W, H, false);
    expect(stiff.viewport).toEqual({ x: 1500, y: 0, zoom: 1 });
    expect(stiff.overshoot).toEqual({ x: 0, y: 0 });
  });

  it('leaves a view inside the area alone', () => {
    const raw = { x: 10, y: 20, zoom: 1.5 };
    expect(boundViewport(raw, area, W, H, true)).toEqual({
      viewport: raw,
      overshoot: { x: 0, y: 0 },
    });
  });
});
