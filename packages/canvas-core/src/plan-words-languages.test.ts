// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { PLAN_WORDS_EN, SHEET_WORDS_EN } from './plan-words.ts';
import { PLAN_WORDS_DE, SHEET_WORDS_DE } from './plan-words-de.ts';
import { PLAN_WORDS_ES, SHEET_WORDS_ES } from './plan-words-es.ts';
import { PLAN_WORDS_FR, SHEET_WORDS_FR } from './plan-words-fr.ts';
import { PLAN_WORDS_IT, SHEET_WORDS_IT } from './plan-words-it.ts';
import { PLAN_WORDS_PT, SHEET_WORDS_PT } from './plan-words-pt.ts';

const flat = (o: object, at = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' ? Object.entries(flat(v, `${at}${k}.`)) : [[`${at}${k}`, v]],
    ),
  );
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort().join();
// The plan's words and the sheet's: their top keys differ (`board`, then `film` and `export`).
const english = flat({ ...PLAN_WORDS_EN, ...SHEET_WORDS_EN });

describe.each([
  ['it', PLAN_WORDS_IT, SHEET_WORDS_IT],
  ['es', PLAN_WORDS_ES, SHEET_WORDS_ES],
  ['de', PLAN_WORDS_DE, SHEET_WORDS_DE],
  ['fr', PLAN_WORDS_FR, SHEET_WORDS_FR],
  ['pt', PLAN_WORDS_PT, SHEET_WORDS_PT],
] as const)('the set plan words in %s (decision 0116)', (_, plan, sheet) => {
  const own = flat({ ...plan, ...sheet });

  it('has every key English has and nothing more, plural forms included', () => {
    expect(Object.keys(own).sort()).toEqual(Object.keys(english).sort());
  });

  it('fills in the same placeholders as English, key by key', () => {
    const differ = Object.keys(english).filter(
      (key) => placeholders(own[key] ?? '') !== placeholders(english[key] ?? ''),
    );
    expect(differ).toEqual([]);
  });

  it('leaves no word empty', () => {
    expect(Object.keys(own).filter((key) => !own[key]?.trim())).toEqual([]);
  });
});

it('names a count with `_one` and `_other`, and `{{count}}` in both', () => {
  const plural = Object.keys(english).filter((key) => /_(one|other)$/.test(key));
  expect(plural.length).toBeGreaterThan(0);
  for (const key of plural) {
    expect(english[key.replace(/_(one|other)$/, '_one')]).toBeDefined();
    expect(english[key.replace(/_(one|other)$/, '_other')]).toBeDefined();
    expect(english[key]).toContain('{{count}}');
  }
});
