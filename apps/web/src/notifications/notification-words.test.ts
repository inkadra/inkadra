// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTIFICATION_WORDS_EN } from '@inkadra/shared';
import { NOTIFICATION_WORDS_DE } from '@inkadra/shared/notification-words/de';
import { NOTIFICATION_WORDS_ES } from '@inkadra/shared/notification-words/es';
import { NOTIFICATION_WORDS_FR } from '@inkadra/shared/notification-words/fr';
import { NOTIFICATION_WORDS_IT } from '@inkadra/shared/notification-words/it';
import { NOTIFICATION_WORDS_PT } from '@inkadra/shared/notification-words/pt';
import { expect, it } from 'vitest';
import { LOCALES } from '../i18n/locales.ts';

const languages = [
  ['en', NOTIFICATION_WORDS_EN],
  ['it', NOTIFICATION_WORDS_IT],
  ['es', NOTIFICATION_WORDS_ES],
  ['de', NOTIFICATION_WORDS_DE],
  ['fr', NOTIFICATION_WORDS_FR],
  ['pt', NOTIFICATION_WORDS_PT],
] as const;

it('has the notification words of every language the web ships', () => {
  expect(languages.map(([locale]) => locale).sort()).toEqual([...LOCALES].sort());
});

it.each(languages)(
  'says the same in %s as the notification words of packages/shared (decision 0116)',
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
    // A notification or an event the web names and the package does not would read differently
    // elsewhere.
    const sn = words.settingsUi.notifications;
    expect(Object.keys(web.notifications.type).sort()).toEqual(
      Object.keys(words.notifications.type).sort(),
    );
    expect(Object.keys(web.settingsUi.notifications.events).sort()).toEqual(
      Object.keys(sn.events).sort(),
    );
    expect(Object.keys(web.settingsUi.notifications.help).sort()).toEqual(
      Object.keys(sn.help).sort(),
    );
  },
);
