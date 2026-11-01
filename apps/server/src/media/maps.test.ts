import { describe, expect, it } from 'vitest';
import { MAP_HEIGHT, MAP_WIDTH, project, routeLine, tilesOf, viewAround, viewOf } from './maps.ts';

describe('static maps', () => {
  it('projects with Web Mercator', () => {
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    const p = project(85.05, -180, 1);
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo(0, 0);
  });

  it('lists the tiles of a view, wrapping around the date line', () => {
    const tiles = tilesOf(viewAround(0, 179.9, 3));
    expect(tiles.length).toBeGreaterThanOrEqual(15);
    expect(new Set(tiles.map((t) => t.x))).toContain(0);
    expect(tiles.every((t) => t.y >= 0 && t.y < 8)).toBe(true);
    // Each tile lands at a multiple of its size in the mosaic.
    expect(tiles.every((t) => t.dx % 256 === 0 && t.dy % 256 === 0)).toBe(true);
  });

  it('fits a route with room around it and draws it in fractions of the picture', () => {
    const route = [
      { lat: 46.3, lon: 9.4 },
      { lat: 46.35, lon: 9.5 },
      { lat: 46.4, lon: 9.6 },
    ];
    const view = viewOf(route);
    const line = routeLine([route], view);
    expect(line).toHaveLength(6);
    const xs = line.filter((_, i) => i % 2 === 0);
    const ys = line.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThan(0.05);
    expect(Math.max(...xs)).toBeLessThan(0.95);
    // North is up: the last point is the highest.
    expect(ys[2]).toBeLessThan(ys[0]!);
    // One zoom closer would not fit.
    const closer = { ...view, zoom: view.zoom + 1 };
    const a = project(46.3, 9.4, closer.zoom);
    const b = project(46.4, 9.6, closer.zoom);
    expect(Math.abs(b.x - a.x) > MAP_WIDTH - 144 || Math.abs(b.y - a.y) > MAP_HEIGHT - 144).toBe(
      true,
    );
  });

  it('fits and draws a route of 200,000 points without overflowing the stack', () => {
    const huge = Array.from({ length: 200_000 }, (_, i) => ({
      lat: 46 + (i % 1000) * 0.0001,
      lon: 9 + i * 0.000001,
    }));
    const view = viewOf(huge);
    expect(view.zoom).toBeGreaterThan(5);
    expect(routeLine([huge], view).length).toBeLessThanOrEqual(1024);
  });

  it('drops points under a pixel apart and thins a long route to 512 points', () => {
    const dense = Array.from({ length: 5000 }, (_, i) => ({ lat: 46 + i * 0.0001, lon: 9 }));
    expect(routeLine([dense], viewOf(dense)).length).toBeLessThan(1000);
    const zigzag = Array.from({ length: 5000 }, (_, i) => ({
      lat: 46 + i * 0.0001,
      lon: 9 + (i % 2) * 0.05,
    }));
    expect(routeLine([zigzag], viewOf(zigzag))).toHaveLength(1024);
  });
});
