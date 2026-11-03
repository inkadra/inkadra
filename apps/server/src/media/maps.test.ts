import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  project,
  renderMap,
  routeLine,
  TILE,
  tilesOf,
  tileType,
  viewAround,
  viewOf,
} from './maps.ts';

describe('static maps', () => {
  it('types a tile by its bytes, and refuses what is not a PNG, JPEG or WebP', () => {
    expect(tileType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))).toBe('image/png');
    expect(tileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(tileType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(tileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(tileType(Buffer.alloc(0))).toBeNull();
  });

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

  /** A tile server: `answer` gets z, x and y, and returns a colour, or null for a 404. */
  async function withTiles(
    answer: (z: number, x: number, y: number) => string | null,
    run: (tileUrl: string, asked: number[]) => Promise<void>,
  ) {
    const asked: number[] = [];
    const server = createServer(async (req, res) => {
      const [z, x, y] = (req.url ?? '').split('/').slice(1).map(Number) as [number, number, number];
      asked.push(z);
      const background = answer(z, x, y);
      if (!background) return res.writeHead(404).end();
      const create = { width: TILE, height: TILE, channels: 3 as const, background };
      const tile = await sharp({ create }).png().toBuffer();
      res.writeHead(200, { 'content-type': 'image/png' }).end(tile);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/{z}/{x}/{y}`, asked);
    } finally {
      server.close();
    }
  }

  it('renders the same ground at twice the pixels, from tiles one zoom closer', async () => {
    const view = viewAround(46.32, 9.4, 15);
    // The tile of the place, at the closer zoom, and where the view says it should land.
    const place = project(46.32, 9.4, 16);
    const [tx, ty] = [Math.floor(place.x / TILE), Math.floor(place.y / TILE)];
    await withTiles(
      (_z, x, y) => (x === tx && y === ty ? '#ff0000' : '#ffffff'),
      async (tileUrl, asked) => {
        const png = await renderMap({ tileUrl, userAgent: 'test' }, view);
        expect(new Set(asked)).toEqual(new Set([16]));
        expect(asked.length).toBeLessThanOrEqual(54);
        const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
        expect([info.width, info.height]).toEqual([PICTURE_WIDTH, PICTURE_HEIGHT]);
        const red = (px: number, py: number) =>
          data[(py * info.width + px) * info.channels + 1] === 0;
        const [left, top] = [
          Math.round(tx * TILE - view.left * 2),
          Math.round(ty * TILE - view.top * 2),
        ];
        expect(red(left, top)).toBe(true);
        expect(red(left + TILE - 1, top + TILE - 1)).toBe(true);
        expect(red(left - 2, top)).toBe(false);
        expect(red(left, top - 2)).toBe(false);
      },
    );
  }, 30_000);

  it('enlarges the tiles of the view where the closer zoom does not exist', async () => {
    const maxZoom = 15;
    await withTiles(
      (z) => (z > maxZoom ? null : '#c8dcc8'),
      async (tileUrl, asked) => {
        const png = await renderMap({ tileUrl, userAgent: 'test' }, viewAround(46.32, 9.4, 15));
        expect(asked).toContain(15);
        expect(await sharp(png).metadata()).toMatchObject({
          width: PICTURE_WIDTH,
          height: PICTURE_HEIGHT,
        });
      },
    );
  }, 30_000);

  it('asks for no tile past the closest zoom', async () => {
    await withTiles(
      () => '#c8dcc8',
      async (tileUrl, asked) => {
        await renderMap({ tileUrl, userAgent: 'test' }, viewAround(46.32, 9.4, 19));
        expect(new Set(asked)).toEqual(new Set([19]));
      },
    );
  }, 30_000);
});
