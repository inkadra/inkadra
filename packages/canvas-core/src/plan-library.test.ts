// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon } from '@inkadra/doc-schema';
import { describe, expect, it, vi } from 'vitest';
import { PLAN_CATEGORIES } from './plan-icons.ts';
import { projectKit } from './plan-kit.ts';
import {
  foldSearch,
  knownLibraryItems,
  LIBRARY_CATEGORIES,
  placeOf,
  projectKitDetail,
  searchLibrary,
  tileName,
} from './plan-library.ts';
import { english, wordsOf } from './plan-words.fixture.ts';
import { PLAN_WORDS_EN, type Words } from './plan-words.ts';
import { PLAN_WORDS_DE } from './plan-words-de.ts';
import { PLAN_WORDS_ES } from './plan-words-es.ts';
import { PLAN_WORDS_FR } from './plan-words-fr.ts';
import { PLAN_WORDS_IT } from './plan-words-it.ts';
import { PLAN_WORDS_PT } from './plan-words-pt.ts';

const NAMES: Record<string, string> = {
  'board.plan.icons.softbox': 'Softbox',
  'board.plan.icons.softlight': 'Soft light',
  'board.plan.synonyms.lantern': 'china ball, soft ball',
  'board.plan.icons.lantern': 'Lantern',
  'board.plan.icons.cob': 'LED COB',
  'board.plan.icons.grid': 'Grid',
  'board.plan.stands.cstand': 'C-stand',
  'board.plan.groups.soft': 'Soft and LED',
};
const t = ((key: string, o?: { defaultValue?: string; names?: string }) =>
  key === 'board.plan.lib.alsoCalled'
    ? `also ${o?.names}`
    : (NAMES[key] ?? o?.defaultValue ?? key.split('.').at(-1))) as unknown as Words;

describe('searchLibrary', () => {
  it('finds names first, then other names, ignoring case and accents', () => {
    const hits = searchLibrary(t, 'SÖFT');
    // Names that start with it first, the shorter first, as the mockup's Softbox then Soft light.
    expect(hits.slice(0, 2).map((h) => h.item)).toEqual(['softbox', 'softlight']);
    expect(hits[0]?.detail).toBe('modifiers');
    const lantern = hits.find((h) => h.item === 'lantern');
    expect(lantern?.by).toBe('synonym');
    expect(lantern?.detail).toBe('also china ball, soft ball');
  });
  it('finds by category and returns nothing for an empty query', () => {
    expect(searchLibrary(t, 'notes').map((h) => h.item)).toEqual([
      'arrow',
      'text',
      'measure',
      'zone',
    ]);
    expect(searchLibrary(t, '  ')).toEqual([]);
  });
  it('matches a group only by its whole name, not by one of its words', () => {
    expect(searchLibrary(t, 'soft').map((h) => h.item)).not.toContain('cob');
    expect(searchLibrary(t, 'soft and led').map((h) => h.item)).toContain('cob');
  });
});

const italian = wordsOf(PLAN_WORDS_IT);
const items = (hits: ReturnType<typeof searchLibrary>) => hits.map((h) => [h.item, h.by]);

describe('searchLibrary with the shared words', () => {
  it('puts names that start with the query first, the shorter first', () => {
    const hits = searchLibrary(english, 'soft');
    expect(items(hits.slice(0, 2))).toEqual([
      ['softbox', 'prefix'],
      ['softlight', 'prefix'],
    ]);
    expect(hits[0]?.detail).toBe(placeOf(english, 'softbox', 'grip'));
    // Then synonyms, after every name.
    const ranks = hits.map((h) => ['prefix', 'name', 'synonym', 'category'].indexOf(h.by));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('finds a kind by another name, and says which', () => {
    const [hit] = searchLibrary(english, 'kino');
    expect(hit).toEqual({
      item: 'kino',
      name: 'Tube bank',
      detail: 'Also called: kino, kinoflo, bank',
      by: 'synonym',
    });
  });

  it('finds a whole category by its name, in the order of the catalogue', () => {
    expect(searchLibrary(english, 'Annotations').map((h) => h.item)).toEqual([
      'arrow',
      'text',
      'measure',
      'zone',
    ]);
    const lights = searchLibrary(english, 'lights').filter((h) => h.by === 'category');
    const kinds = LIBRARY_CATEGORIES.find((c) => c.id === 'lights')?.items ?? [];
    expect(lights.map((h) => h.item)).toEqual(
      kinds.filter((k) => lights.some((h) => h.item === k)),
    );
    expect(lights.length).toBeGreaterThan(10);
  });

  it('ignores case and accents in the query and in the words', () => {
    expect(searchLibrary(english, '  SÔFT ')).toEqual(searchLibrary(english, 'soft'));
    expect(foldSearch('Éclairage Diffusé')).toBe('eclairage diffuse');
  });

  it('finds nothing for an empty query or one that matches nothing', () => {
    expect(searchLibrary(english, '')).toEqual([]);
    expect(searchLibrary(english, '   ')).toEqual([]);
    expect(searchLibrary(english, 'xyzzy')).toEqual([]);
  });

  it('searches in the language of its words', () => {
    // "kino" is a synonym in both, explained in each language.
    expect(searchLibrary(italian, 'kino')[0]).toEqual({
      item: 'kino',
      name: 'Banco di tubi',
      detail: 'Detto anche: kino, kinoflo, banco',
      by: 'synonym',
    });
    // Every light by the category's name in each language, with other kinds the words hold
    // ("Headlights", "mixer luci"); the English name finds no category in Italian.
    const kinds = LIBRARY_CATEGORIES.find((c) => c.id === 'lights')?.items ?? [];
    for (const [words, query] of [
      [italian, 'luci'],
      [english, 'lights'],
    ] as const) {
      const found = searchLibrary(words, query).map((h) => h.item);
      expect(kinds.filter((k) => !found.includes(k))).toEqual([]);
    }
    expect(searchLibrary(italian, 'lights').filter((h) => h.by === 'category')).toEqual([]);
  });
});

describe('foldSearch', () => {
  it('folds the same on every device, whatever its locale', () => {
    // A Turkish device: the locale's lower case writes "I" as a dotless "ı".
    const own = String.prototype.toLocaleLowerCase;
    String.prototype.toLocaleLowerCase = function (this: string) {
      return own.call(this, 'tr');
    };
    try {
      expect(foldSearch('GRID')).toBe('grid');
      expect(searchLibrary(english, 'GRID').map((h) => h.item)).toContain('grid');
    } finally {
      String.prototype.toLocaleLowerCase = own;
    }
  });

  it('drops from every word of the catalogues what `\\p{Diacritic}` dropped', () => {
    const before = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
    const differ: string[] = [];
    let count = 0;
    for (const words of [
      PLAN_WORDS_EN,
      PLAN_WORDS_IT,
      PLAN_WORDS_ES,
      PLAN_WORDS_DE,
      PLAN_WORDS_FR,
      PLAN_WORDS_PT,
    ]) {
      const { icons, synonyms, tileNames, groups, categories } = words.board.plan;
      for (const text of [icons, synonyms, tileNames, groups, categories].flatMap((o) =>
        Object.values(o),
      )) {
        count++;
        if (foldSearch(text) !== before(text)) differ.push(text);
      }
    }
    expect(count).toBeGreaterThan(2000);
    expect(differ).toEqual([]);
  });
});

describe('the words the library asks for', () => {
  it.each([
    ['en', english],
    ['it', italian],
    ['es', wordsOf(PLAN_WORDS_ES)],
    ['de', wordsOf(PLAN_WORDS_DE)],
    ['fr', wordsOf(PLAN_WORDS_FR)],
    ['pt', wordsOf(PLAN_WORDS_PT)],
  ])('are all in %s', (_, words) => {
    // A key the words lack throws: every name, group, category and tile of the library.
    for (const c of LIBRARY_CATEGORIES)
      for (const item of c.items) {
        expect(tileName(words, item)).toBeTruthy();
        expect(placeOf(words, item, c.id)).toBeTruthy();
        expect(searchLibrary(words, words(`board.plan.icons.${item}`))[0]).toBeDefined();
      }
    for (const c of PLAN_CATEGORIES)
      expect(searchLibrary(words, words(`board.plan.categories.${c.id}`)).length).toBeGreaterThan(
        0,
      );
    expect(words('board.plan.lib.alsoCalled', { names: 'x' })).toContain('x');
  });

  it('writes the short name on a tile where the catalogue has one', () => {
    expect(tileName(english, 'kino')).toBe(english('board.plan.tileNames.kino'));
    expect(tileName(english, 'fresnel')).toBe('Fresnel');
  });
});

it('keeps the items of a stored list this build knows, in order', () => {
  expect(knownLibraryItems(['softbox', 'hologram', 'arrow', 'fresnel'])).toEqual([
    'softbox',
    'arrow',
    'fresnel',
  ]);
});

const icon = (id: string, kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: id.padEnd(13, 'A'),
  kind,
  color: '#EDD963',
  x: 100,
  y: 100,
  ...extra,
});

describe('projectKit', () => {
  it('keeps each configured light and camera once, with modifiers and lenses', () => {
    const key = icon('key', 'cob', { label: 'Key', watts: 300, stand: 'cstand' });
    const plans = [
      { icons: [key, icon('grid', 'grid', { on: key.id }), icon('bare', 'fresnel')] },
      {
        icons: [
          { ...key, id: 'key2AAAAAAAAA', x: 900 },
          icon('grid2', 'grid', { on: 'key2AAAAAAAAA' }),
          icon('cam', 'camera', { label: 'A cam', lens: 50 }),
        ],
      },
      { icons: [icon('cam2', 'camera', { label: 'A cam', lens: 32 }), icon('cam3', 'camera')] },
    ];
    const kit = projectKit(plans);
    expect(kit).toHaveLength(2);
    expect(kit[0]?.modifiers).toEqual(['grid']);
    expect(kit[0]?.icon).toMatchObject({ kind: 'cob', label: 'Key', watts: 300 });
    expect(kit[1]?.lenses).toEqual([32, 50]);
    expect(projectKitDetail(kit[0] as never, t, 'S35', 'en')).toBe(
      'LED COB 300 W · Grid · C-stand',
    );
    expect(projectKitDetail(kit[1] as never, t, 'S35', 'en')).toBe('S35 · 32, 50 mm');
  });

  it('writes the watts of a light in the app language, not the browser one', () => {
    // An English browser: numbers without a locale come out in English.
    const own = Number.prototype.toLocaleString;
    const spy = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
      this: number,
      locale,
      options,
    ) {
      return own.call(this, locale ?? 'en-US', options);
    });
    try {
      const [entry] = projectKit([{ icons: [icon('key', 'cob', { label: 'Key', watts: 1200 })] }]);
      expect(projectKitDetail(entry as never, t, 'S35', 'it')).toBe('LED COB 1,2K');
    } finally {
      spy.mockRestore();
    }
  });
});
