// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { SCHEDULE_WORDS_EN } from './schedule-words.ts';
import { SCHEDULE_WORDS_DE } from './schedule-words-de.ts';
import { SCHEDULE_WORDS_ES } from './schedule-words-es.ts';
import { SCHEDULE_WORDS_FR } from './schedule-words-fr.ts';
import { SCHEDULE_WORDS_IT } from './schedule-words-it.ts';
import { SCHEDULE_WORDS_PT } from './schedule-words-pt.ts';

const flat = (o: object, at = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' ? Object.entries(flat(v, `${at}${k}.`)) : [[`${at}${k}`, v]],
    ),
  );
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort().join();
const english = flat(SCHEDULE_WORDS_EN);

describe.each([
  ['it', SCHEDULE_WORDS_IT],
  ['es', SCHEDULE_WORDS_ES],
  ['de', SCHEDULE_WORDS_DE],
  ['fr', SCHEDULE_WORDS_FR],
  ['pt', SCHEDULE_WORDS_PT],
])('the schedule words in %s (decision 0116)', (_, words) => {
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
