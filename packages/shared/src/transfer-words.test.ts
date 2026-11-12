// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { TRANSFER_WORDS_EN } from './transfer-words.ts';
import { TRANSFER_WORDS_DE } from './transfer-words-de.ts';
import { TRANSFER_WORDS_ES } from './transfer-words-es.ts';
import { TRANSFER_WORDS_FR } from './transfer-words-fr.ts';
import { TRANSFER_WORDS_IT } from './transfer-words-it.ts';
import { TRANSFER_WORDS_PT } from './transfer-words-pt.ts';
import { TRANSFER_FAILURES } from './transfers.ts';

const flat = (o: object, at = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' ? Object.entries(flat(v, `${at}${k}.`)) : [[`${at}${k}`, v]],
    ),
  );
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort().join();
const english = flat(TRANSFER_WORDS_EN);

describe.each([
  ['it', TRANSFER_WORDS_IT],
  ['es', TRANSFER_WORDS_ES],
  ['de', TRANSFER_WORDS_DE],
  ['fr', TRANSFER_WORDS_FR],
  ['pt', TRANSFER_WORDS_PT],
])('the transfer words in %s (decision 0116)', (_, words) => {
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

it('says why for every failure code a transfer can have, and for no other', () => {
  expect(Object.keys(TRANSFER_WORDS_EN.transfer.failure).sort()).toEqual(
    [...TRANSFER_FAILURES].sort(),
  );
});
