// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { fontCoverage, measureFrom } from './measure.ts';
import type { FontWeight } from './ops.ts';

const require = createRequire(import.meta.url);

/** Inter as the web loads it, read from `@expo-google-fonts/inter` on disk (test-only). */
function inter(): Record<FontWeight, Uint8Array> {
  const file = (name: string) =>
    readFileSync(require.resolve(`@expo-google-fonts/inter/${name}/Inter_${name}.ttf`));
  const semibold = file('600SemiBold');
  return {
    400: file('400Regular'),
    500: file('500Medium'),
    600: semibold,
    700: file('700Bold'),
    heading: semibold,
  };
}

interface Width {
  text: string;
  size: number;
  weight: FontWeight;
  width: number;
}

/** The web's widths of the plan sheet's texts (the web's `fonts.test.ts` records them). */
const fixture = readFileSync(`${import.meta.dirname}/measure.fixture.txt`, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Width);

describe('measureFrom', () => {
  it("gives the web's widths of the plan sheet's texts", () => {
    const measure = measureFrom(inter());
    expect(fixture.length).toBeGreaterThan(50);
    for (const { text, size, weight, width } of fixture)
      expect({ text, weight, width: measure(text, size, weight) }).toEqual({ text, weight, width });
  });
});

describe('fontCoverage', () => {
  it('covers Latin, Latin Extended, Cyrillic and white space in Inter, not CJK', () => {
    const covers = fontCoverage(inter()[400]);
    expect(['a', 'É', '·', 'ł', 'ś', 'С', 'в', ' ', '\n'].every(covers)).toBe(true);
    expect(covers('中')).toBe(false);
  });
});
