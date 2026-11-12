// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { fontCoverage, measureFrom } from './measure.ts';
import type { FontWeight } from './ops.ts';

const require = createRequire(import.meta.url);

/** Inter as the web loads it, read from `@fontsource/inter` on disk (a test-only dependency). */
function inter(): Record<FontWeight, Uint8Array> {
  const file = (w: number) =>
    readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));
  const semibold = file(600);
  return { 400: file(400), 500: file(500), 600: semibold, 700: file(700), heading: semibold };
}

/** The web's widths of the plan sheet's texts (the web's `fonts.test.ts` records them). */
const fixture = readFileSync(`${import.meta.dirname}/measure.fixture.txt`, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as { text: string; size: number; weight: FontWeight; width: number });

describe('measureFrom', () => {
  it("gives the web's widths of the plan sheet's texts", () => {
    const measure = measureFrom(inter());
    expect(fixture.length).toBeGreaterThan(50);
    for (const { text, size, weight, width } of fixture)
      expect({ text, weight, width: measure(text, size, weight) }).toEqual({ text, weight, width });
  });
});

describe('fontCoverage', () => {
  it('covers Latin and white space, not Cyrillic, in Inter latin', () => {
    const covers = fontCoverage(inter()[400]);
    expect(['a', 'É', '·', ' ', '\n'].every(covers)).toBe(true);
    expect(covers('С')).toBe(false);
    expect(covers('ł')).toBe(false);
  });
});
