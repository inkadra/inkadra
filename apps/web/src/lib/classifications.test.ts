// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOT_WORDS_EN } from '@inkadra/shared';
import { SHOT_WORDS_DE } from '@inkadra/shared/shot-words/de';
import { SHOT_WORDS_ES } from '@inkadra/shared/shot-words/es';
import { SHOT_WORDS_FR } from '@inkadra/shared/shot-words/fr';
import { SHOT_WORDS_IT } from '@inkadra/shared/shot-words/it';
import { SHOT_WORDS_PT } from '@inkadra/shared/shot-words/pt';
import { expect, it } from 'vitest';
import { LOCALES } from '../i18n/locales.ts';

const languages = [
  ['en', SHOT_WORDS_EN],
  ['it', SHOT_WORDS_IT],
  ['es', SHOT_WORDS_ES],
  ['de', SHOT_WORDS_DE],
  ['fr', SHOT_WORDS_FR],
  ['pt', SHOT_WORDS_PT],
] as const;

it('has the shot words of every language the web ships', () => {
  expect(languages.map(([locale]) => locale).sort()).toEqual([...LOCALES].sort());
});

it.each(languages)(
  'says the same in %s as the shot words of packages/shared (decision 0116)',
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
    // A shot value the web names and the package does not would read differently elsewhere.
    expect(
      Object.keys(web.film.shot).length +
        Object.keys(web.film.angle).length +
        Object.keys(web.film.movement).length,
    ).toBe(leaves(words).length);
  },
);
