// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEGACY_KINDS,
  PLAN_CATEGORIES,
  PLAN_NOTE_TOOLS,
  PLAN_WORDS_EN,
} from '@inkadra/canvas-core';
import { PLAN_WORDS_DE } from '@inkadra/canvas-core/plan-words/de';
import { PLAN_WORDS_ES } from '@inkadra/canvas-core/plan-words/es';
import { PLAN_WORDS_FR } from '@inkadra/canvas-core/plan-words/fr';
import { PLAN_WORDS_IT } from '@inkadra/canvas-core/plan-words/it';
import { PLAN_WORDS_PT } from '@inkadra/canvas-core/plan-words/pt';
import { PLAN_ICON_KINDS } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../i18n/locales.ts';

type Plan = {
  icons: Record<string, string>;
  tileNames: Record<string, string>;
  synonyms: Record<string, string>;
  categories: Record<string, string>;
  groups: Record<string, string>;
};
const plan = (locale: string): Plan =>
  JSON.parse(readFileSync(join(__dirname, `../../i18n/${locale}.json`), 'utf8')).board.plan;

describe.each(LOCALES)('the set plan catalogue in %s (decision 0104)', (locale) => {
  const p = plan(locale);

  it('names every icon kind, every annotation tool, category and group', () => {
    const missing = [
      ...[...PLAN_ICON_KINDS, ...PLAN_NOTE_TOOLS].filter((k) => !p.icons[k]?.trim()),
      ...PLAN_CATEGORIES.filter((c) => !p.categories[c.id]?.trim()).map((c) => `category ${c.id}`),
      ...PLAN_CATEGORIES.flatMap((c) => c.groups)
        .filter((g) => !p.groups[g.id]?.trim())
        .map((g) => `group ${g.id}`),
    ];
    expect(missing).toEqual([]);
    expect(p.categories.notes?.trim()).toBeTruthy();
  });

  it('names no two tiles alike, in a category or across them (decision 0117)', () => {
    // Search lists the whole catalogue: "Escalera" twice is two tiles nobody tells apart.
    const seen = new Map<string, string>();
    const same = PLAN_CATEGORIES.flatMap((c) => c.kinds).flatMap((k) => {
      const name = (p.tileNames[k] ?? p.icons[k] ?? '').trim().toLocaleLowerCase(locale);
      const other = seen.get(name);
      seen.set(name, k);
      return other && other !== k ? [`${other} and ${k} are both "${name}"`] : [];
    });
    expect(same).toEqual([]);
  });

  it('gives every kind the library offers words to be found by', () => {
    const offered = PLAN_ICON_KINDS.filter((k) => !(k in LEGACY_KINDS));
    expect(offered.filter((k) => !p.synonyms[k]?.trim())).toEqual([]);
  });
});

it.each([
  ['en', PLAN_WORDS_EN],
  ['it', PLAN_WORDS_IT],
  ['es', PLAN_WORDS_ES],
  ['de', PLAN_WORDS_DE],
  ['fr', PLAN_WORDS_FR],
  ['pt', PLAN_WORDS_PT],
])('says the same in %s as the shared words of canvas-core (decision 0116)', (locale, words) => {
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
});
