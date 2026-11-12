// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEDULE_WORDS_EN } from '@inkadra/shared';
import { SCHEDULE_WORDS_DE } from '@inkadra/shared/schedule-words/de';
import { SCHEDULE_WORDS_ES } from '@inkadra/shared/schedule-words/es';
import { SCHEDULE_WORDS_FR } from '@inkadra/shared/schedule-words/fr';
import { SCHEDULE_WORDS_IT } from '@inkadra/shared/schedule-words/it';
import { SCHEDULE_WORDS_PT } from '@inkadra/shared/schedule-words/pt';
import { expect, it } from 'vitest';
import { LOCALES } from '../../i18n/locales.ts';

const languages = [
  ['en', SCHEDULE_WORDS_EN],
  ['it', SCHEDULE_WORDS_IT],
  ['es', SCHEDULE_WORDS_ES],
  ['de', SCHEDULE_WORDS_DE],
  ['fr', SCHEDULE_WORDS_FR],
  ['pt', SCHEDULE_WORDS_PT],
] as const;

it('has the schedule words of every language the web ships', () => {
  expect(languages.map(([locale]) => locale).sort()).toEqual([...LOCALES].sort());
});

it.each(languages)(
  'says the same in %s as the schedule words of packages/shared (decision 0116)',
  (locale, words) => {
    // The package is what another client loads; the web's catalogue must not drift from it.
    const web = JSON.parse(readFileSync(join(__dirname, `../../i18n/${locale}.json`), 'utf8'));
    const leaves = (o: object, at: string[] = []): Array<[string[], string]> =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? leaves(v, [...at, k]) : [[[...at, k], v as string]],
      );
    const differ = leaves(words).filter(
      ([path, text]) => path.reduce<any>((o, k) => o?.[k], web) !== text,
    );
    expect(differ).toEqual([]);
  },
);
