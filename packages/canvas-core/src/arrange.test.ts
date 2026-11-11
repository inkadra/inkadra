// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  type ArrangeItem,
  claimSpot,
  freeSpot,
  freeSpots,
  gridAround,
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

describe('gridAround', () => {
  it('centres a grid of the given sizes on a point, keeping each size', () => {
    const sizes = [
      { w: 100, h: 50 },
      { w: 60, h: 80 },
      { w: 100, h: 40 },
    ];
    // Two columns (100 and 60 wide), two rows (80 and 40 tall), 10 apart: 170 by 130.
    expect(gridAround(sizes, { x: 0, y: 0 }, 10)).toEqual([
      { x: -85, y: -65 },
      { x: 25, y: -65 },
      { x: -85, y: 25 },
    ]);
    expect(gridAround([], { x: 0, y: 0 }, 10)).toEqual([]);
  });
});

describe('freeSpot', () => {
  const size = { w: 240, h: 240 };
  it('keeps the start when nothing is there', () => {
    expect(freeSpot({ x: 0, y: 0 }, size, [{ x: 600, y: 600, w: 100, h: 100 }])).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('measures the new card by its own height, not a fixed one', () => {
    // A card 200 below the start: a 240-tall card there would cover it.
    const taken = [{ x: 0, y: 200, w: 240, h: 300 }];
    const at = freeSpot({ x: 0, y: 0 }, size, taken);
    expect(taken.some((r) => intersectsRect(r, { ...at, ...size }))).toBe(false);
  });

  it('prefers a free spot on screen to a nearer one off it', () => {
    // The spot below the start is free but off screen; the one to its right is on screen.
    const taken = [{ x: 0, y: 0, w: 240, h: 240 }];
    const area = { x: -20, y: -20, w: 600, h: 300 };
    const at = freeSpot({ x: 0, y: 0 }, size, taken, area);
    expect(at.x + size.w).toBeLessThanOrEqual(area.x + area.w);
    expect(at.y + size.h).toBeLessThanOrEqual(area.y + area.h);
    expect(intersectsRect(taken[0]!, { ...at, ...size })).toBe(false);
  });

  it('moves a planned spot that a newer card took meanwhile, and only then', () => {
    const old = { id: 'old', x: 0, y: 0, w: 240, h: 240 };
    // Planned on top of a card that was already there (a drop the person aimed): it stays.
    expect(claimSpot({ x: 10, y: 10 }, size, [old], new Set(['old']))).toEqual({ x: 10, y: 10 });
    // Another upload, or a collaborator, put a card there since: it moves to a free spot.
    const newer = { id: 'newer', x: 400, y: 0, w: 240, h: 240 };
    const at = claimSpot({ x: 400, y: 0 }, size, [old, newer], new Set(['old']));
    expect([old, newer].some((r) => intersectsRect(r, { ...at, ...size }))).toBe(false);
    // Two batches planned on the same spots before either arrived never land on each other.
    const first = freeSpots({ x: 0, y: 400 }, [size, size], [old]);
    const second = freeSpots({ x: 0, y: 400 }, [size, size], [old]);
    const placed = first.map((p, i) => ({ id: `a${i}`, ...p, ...size }));
    for (const spot of second) {
      const claimed = claimSpot(spot, size, [old, ...placed], new Set(['old']));
      expect(placed.some((r) => intersectsRect(r, { ...claimed, ...size }))).toBe(false);
      placed.push({ id: `b${placed.length}`, ...claimed, ...size });
    }
  });

  it('places several cards clear of the board and of each other', () => {
    const taken = [{ x: 0, y: 0, w: 260, h: 400 }];
    const spots = freeSpots({ x: 0, y: 0 }, [size, size, size], taken);
    const rects = spots.map((p) => ({ ...p, ...size }));
    for (const [i, r] of rects.entries()) {
      expect(taken.some((t) => intersectsRect(t, r))).toBe(false);
      expect(rects.some((o, j) => j !== i && intersectsRect(o, r))).toBe(false);
    }
  });
});

const intersectsRect = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The search as first written, every spot against every card: the reference for the index. */
function referenceSpot(
  start: { x: number; y: number },
  size: { w: number; h: number },
  taken: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
  area?: { x: number; y: number; w: number; h: number },
) {
  const gap = 12;
  const step = 32;
  const free = (p: { x: number; y: number }) =>
    !taken.some((r) =>
      intersectsRect(
        { x: r.x - gap, y: r.y - gap, w: r.w + gap * 2, h: r.h + gap * 2 },
        { ...p, ...size },
      ),
    );
  const within = (p: { x: number; y: number }) =>
    !area ||
    (p.x >= area.x &&
      p.y >= area.y &&
      p.x + size.w <= area.x + area.w &&
      p.y + size.h <= area.y + area.h);
  const search = (inside: (p: { x: number; y: number }) => boolean) => {
    for (let i = 0; i < 12; i++) {
      const at = { x: start.x + i * step, y: start.y + i * step };
      if (inside(at) && free(at)) return at;
    }
    for (let ring = 1; ring <= 40; ring++) {
      let best: { x: number; y: number } | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = -ring; i <= ring; i++)
        for (const [dx, dy] of [
          [i, -ring],
          [i, ring],
          [-ring, i],
          [ring, i],
        ] as const) {
          const at = { x: start.x + dx * step, y: start.y + dy * step };
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance && inside(at) && free(at)) {
            best = at;
            bestDistance = distance;
          }
        }
      if (best) return best;
    }
    return undefined;
  };
  return (area && search(within)) ?? search(() => true) ?? start;
}

describe('freeSpot with its index', () => {
  // mulberry32: the same cases on every run.
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const huge = { x: -500_000, y: -500_000, w: 1_000_000, h: 1_000_000 };

  // 400 boards against the plain search: about 4.5 s on a CI runner, near the 5 s default.
  it('finds the same spot as the plain search, whatever the board', { timeout: 30_000 }, () => {
    const next = random(578);
    const pick = (min: number, max: number) => Math.round(min + next() * (max - min));
    for (let n = 0; n < 400; n++) {
      const cards = Array.from({ length: pick(0, 120) }, () => {
        const kind = next();
        // On a cell border once inflated, straddling cells, empty, or anywhere.
        if (kind < 0.2)
          return { x: pick(-8, 8) * 256 - 12, y: pick(-8, 8) * 256 - 12, w: 232, h: 488 };
        if (kind < 0.3) return { x: pick(-2000, 2000), y: pick(-2000, 2000), w: 0, h: 0 };
        if (kind < 0.4) return { x: pick(-8, 8) * 256 - 100, y: pick(-2000, 2000), w: 200, h: 300 };
        return { x: pick(-2000, 2000), y: pick(-2000, 2000), w: pick(0, 700), h: pick(0, 700) };
      });
      if (n % 25 === 0) cards.push(huge);
      if (n % 40 === 1)
        // A packed field around the start: the 40 rings run out.
        for (let x = -1800; x < 1800; x += 250)
          for (let y = -1800; y < 1800; y += 190) cards.push({ x, y, w: 240, h: 180 });
      const start = { x: pick(-1500, 1500), y: pick(-1500, 1500) };
      const card = { w: pick(0, 640), h: pick(0, 400) };
      const area =
        next() < 0.5
          ? {
              x: start.x - pick(0, 900),
              y: start.y - pick(0, 700),
              w: pick(0, 2000),
              h: pick(0, 1400),
            }
          : undefined;
      expect(freeSpot(start, card, cards, area)).toEqual(referenceSpot(start, card, cards, area));
    }
  });

  it('stays fast with a card a million units wide', () => {
    const others = Array.from({ length: 2000 }, (_, i) => ({
      x: (i % 50) * 300,
      y: Math.floor(i / 50) * 300,
      w: 240,
      h: 180,
    }));
    const begin = performance.now();
    const at = freeSpot({ x: 0, y: 0 }, { w: 240, h: 240 }, [huge, ...others], {
      x: -600,
      y: -400,
      w: 1200,
      h: 800,
    });
    const ms = performance.now() - begin;
    // Nothing is free under it: every ring is searched, against a few cells, not a million.
    expect(at).toEqual({ x: 0, y: 0 });
    expect(ms).toBeLessThan(250);
  });
});
