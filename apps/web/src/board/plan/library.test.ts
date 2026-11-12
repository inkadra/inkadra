// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_WORDS_IT } from '@inkadra/canvas-core/plan-words/it';
import i18next from 'i18next';
import { expect, it } from 'vitest';
import { searchLibrary } from './library.ts';

/** `t` in Italian over one catalogue, set up as the app sets up its own. */
async function italianWith(catalogue: object) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'it',
    resources: { it: { translation: catalogue } },
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return i18n.t;
}

it('finds the same in Italian with the web catalogue as with the shared words (decision 0116)', async () => {
  // The mobile app searches with the package's words: its results must be the web's.
  const web = await italianWith(
    JSON.parse(readFileSync(join(__dirname, '../../i18n/it.json'), 'utf8')),
  );
  const shared = await italianWith(PLAN_WORDS_IT);
  for (const query of ['kino', 'morbida', 'luce', 'Luci', 'faro', 'Annotazioni', 'sedia', 'xyz'])
    expect(searchLibrary(shared, query), query).toEqual(searchLibrary(web, query));
  expect(searchLibrary(web, 'kino')[0]?.detail).toBe('Detto anche: kino, kinoflo, banco');
});
