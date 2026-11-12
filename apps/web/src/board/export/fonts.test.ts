// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadFonts } from './fonts.ts';
import type { FontWeight } from './pages.ts';
import { fileFetch } from './plan-sheet-node.fixture.ts';

/**
 * The widths the web measures the plan sheet's texts with, which `@inkadra/print`'s
 * `measureFrom` must give from the same Inter files (its `measure.test.ts` reads this fixture).
 * Recorded from `main` with `WRITE_PLAN_FIXTURES=1` before the measure moved to the package.
 */

const FIXTURE = `${import.meta.dirname}/../../../../../packages/print/src/measure.fixture.json`;
const GOLDEN = `${import.meta.dirname}/golden`;

interface Sample {
  text: string;
  size: number;
  weight: FontWeight;
}

/** Every text the sheet's goldens draw, its missing glyphs alone, and a few as headings. */
function samples(): Sample[] {
  const seen = new Map<string, Sample>();
  const add = (s: Sample) => seen.set(JSON.stringify([s.text, s.size, s.weight]), s);
  for (const name of readdirSync(GOLDEN).filter((n) => /^plan-sheet-.*[a-z]\.txt$/.test(n))) {
    for (const line of readFileSync(`${GOLDEN}/${name}`, 'utf8').split('\n')) {
      const missing = /^missing glyphs: (.*)$/.exec(line)?.[1];
      if (missing)
        for (const ch of missing.split(' '))
          for (const weight of [400, 500, 600, 700] as const) add({ text: ch, size: 10, weight });
      if (!line.includes('"kind":"text"')) continue;
      const { text, size, weight } = JSON.parse(line) as Sample;
      add({ text, size, weight });
    }
  }
  for (const text of ['Setup 1 · Base', 'Свет', '']) add({ text, size: 18, weight: 'heading' });
  return [...seen.values()];
}

beforeAll(() => {
  vi.stubGlobal('fetch', fileFetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe("the web's measure", () => {
  it("gives the widths of the print package's measure fixture", async () => {
    const { measure } = await loadFonts();
    const widths = samples().map((s) => ({ ...s, width: measure(s.text, s.size, s.weight) }));
    expect(widths.length).toBeGreaterThan(50);
    const text = `${JSON.stringify(widths, null, 1)}\n`;
    if (process.env.WRITE_PLAN_FIXTURES) writeFileSync(FIXTURE, text);
    expect(text).toBe(readFileSync(FIXTURE, 'utf8'));
  });
});
