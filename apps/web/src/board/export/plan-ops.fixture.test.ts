import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CardContext, type Palette, planOps } from './board-render.ts';
import type { Op } from './pages.ts';
import { PLAN } from '../plan/plan-sample.fixture.ts';

/**
 * The export's drawing of a sample plan, kept as a fixture (decision 0116): the operations were
 * written from `main` before the plan's geometry moved to canvas-core, and must stay the same.
 * Numbers are rounded to 1e-6 points, so a change in the order of floating-point steps passes
 * and any drawn difference fails. Rewrite with `vitest -u` only for a change meant to be seen.
 */

/** Every colour of the page a hex code of its own, so that the mixes show in the fixture. */
const colors = new Proxy({} as Palette, {
  get: (_, key) => {
    let h = 7;
    for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `#${(h & 0xffffff).toString(16).padStart(6, '0')}`;
  },
});
const ctx = {
  measure: (text: string, size: number) => text.length * size * 0.55,
  colors,
  noteBlocks: () => [],
  image: () => null,
  fileName: () => '',
  boardTitle: () => '',
} as unknown as CardContext;

const round = (v: unknown): unknown =>
  typeof v === 'number'
    ? Math.round(v * 1e6) / 1e6 + 0
    : Array.isArray(v)
      ? v.map(round)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
        : v;

/** One line per operation, a clip's operations after it, indented. */
function lines(ops: readonly Op[], depth = 0): string[] {
  return ops.flatMap((op) => {
    if (op.kind !== 'clip') return [`${' '.repeat(depth)}${JSON.stringify(round(op))}`];
    const { ops: inside, ...clip } = op;
    return [`${' '.repeat(depth)}${JSON.stringify(round(clip))}`, ...lines(inside, depth + 1)];
  });
}

/** Numbers in English whatever the machine's language, so the fixture reads alike everywhere. */
const ownLocale = Number.prototype.toLocaleString;
beforeAll(() => {
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locale?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return ownLocale.call(this, locale ?? 'en', options);
  });
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe('a set plan in exports', () => {
  it('draws the sample plan as it did before the geometry moved to canvas-core', async () => {
    const ops = planOps(PLAN, { x: 20, y: 30, w: 600, h: 400 }, ctx);
    await expect(`${lines(ops).join('\n')}\n`).toMatchFileSnapshot('./__fixtures__/plan-ops.txt');
  });

  it('draws a legend glyph, without beams and labels, as before', async () => {
    const ops = planOps(PLAN, { x: 0, y: 0, w: 120, h: 80 }, ctx, false, false);
    await expect(`${lines(ops).join('\n')}\n`).toMatchFileSnapshot(
      './__fixtures__/plan-ops-small.txt',
    );
  });
});
