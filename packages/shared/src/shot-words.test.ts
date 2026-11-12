// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { SHOT_WORDS_EN } from './shot-words.ts';
import { SHOT_WORDS_DE } from './shot-words-de.ts';
import { SHOT_WORDS_ES } from './shot-words-es.ts';
import { SHOT_WORDS_FR } from './shot-words-fr.ts';
import { SHOT_WORDS_IT } from './shot-words-it.ts';
import { SHOT_WORDS_PT } from './shot-words-pt.ts';

const flat = (o: object, at = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' ? Object.entries(flat(v, `${at}${k}.`)) : [[`${at}${k}`, v]],
    ),
  );
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort().join();
const english = flat(SHOT_WORDS_EN);

describe.each([
  ['it', SHOT_WORDS_IT],
  ['es', SHOT_WORDS_ES],
  ['de', SHOT_WORDS_DE],
  ['fr', SHOT_WORDS_FR],
  ['pt', SHOT_WORDS_PT],
])('the shot words in %s (decision 0116)', (_, words) => {
  const own = flat(words);

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
