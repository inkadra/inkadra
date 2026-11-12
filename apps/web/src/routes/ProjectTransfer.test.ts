// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRANSFER_WORDS_EN } from '@inkadra/shared';
import { TRANSFER_WORDS_DE } from '@inkadra/shared/transfer-words/de';
import { TRANSFER_WORDS_ES } from '@inkadra/shared/transfer-words/es';
import { TRANSFER_WORDS_FR } from '@inkadra/shared/transfer-words/fr';
import { TRANSFER_WORDS_IT } from '@inkadra/shared/transfer-words/it';
import { TRANSFER_WORDS_PT } from '@inkadra/shared/transfer-words/pt';
import { expect, it } from 'vitest';
import { LOCALES } from '../i18n/locales.ts';

const languages = [
  ['en', TRANSFER_WORDS_EN],
  ['it', TRANSFER_WORDS_IT],
  ['es', TRANSFER_WORDS_ES],
  ['de', TRANSFER_WORDS_DE],
  ['fr', TRANSFER_WORDS_FR],
  ['pt', TRANSFER_WORDS_PT],
] as const;

it('has the transfer words of every language the web ships', () => {
  expect(languages.map(([locale]) => locale).sort()).toEqual([...LOCALES].sort());
});

it.each(languages)(
  'says the same in %s as the transfer words of packages/shared (decision 0116)',
  (locale, words) => {
    // The package is what another client loads; the web's catalogue must not drift from it.
    const web = JSON.parse(readFileSync(join(__dirname, `../i18n/${locale}.json`), 'utf8'));
    const leaves = (o: object, at: string[] = []): Array<[string[], string]> =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? leaves(v, [...at, k]) : [[[...at, k], v as string]],
      );
    const differ = leaves(words).filter(
      ([path, text]) => path.reduce<any>((o, k) => o?.[k], web) !== text,
    );
    expect(differ).toEqual([]);
    // A failure the web explains and the package does not would read differently elsewhere.
    expect(Object.keys(web.transfer.failure).sort()).toEqual(
      Object.keys(words.transfer.failure).sort(),
    );
  },
);
