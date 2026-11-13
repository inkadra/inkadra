import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Words } from '@inkadra/shared';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localeBackend, withManyForms } from './backend.ts';
import en from './en.json';
import i18n, { detect, i18nReady, LOCALES } from './index.ts';
import itMessages from './it.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

/** Read from disk, as a catalogue is a chunk of its own in the app. */
const catalogue = (locale: string): object =>
  JSON.parse(readFileSync(join(__dirname, `${locale}.json`), 'utf8'));

const flat = (messages: object) =>
  Object.fromEntries(
    keys(messages).map((key) => [key, key.split('.').reduce<any>((o, k) => o[k], messages)]),
  ) as Record<string, string>;

/** Not text: the kinds of element that take a feminine word, empty where no word changes. */
const MAY_BE_EMPTY = ['board.added.feminine'];

describe.each(LOCALES.filter((locale) => locale !== 'it'))('the %s catalogue', (locale) => {
  const reference = flat(itMessages);
  const messages = flat(catalogue(locale));
  // `_many` is optional: withManyForms fills it from `_other`.
  const own = Object.keys(messages).filter(
    (key) => !(key.endsWith('_many') && messages[key.replace(/_many$/, '_other')]),
  );

  it('has every Italian key and nothing more', () => {
    expect(own.sort()).toEqual(Object.keys(reference).sort());
  });

  it('keeps the placeholders, nested keys and markup of each text', () => {
    const tokens = (text = '') =>
      (text.match(/\{\{[^}]+\}\}|\$t\([^)]*\)|<\/?\w[^>]*>/g) ?? []).sort();
    const differ = Object.keys(reference).filter(
      (key) => tokens(messages[key]).join() !== tokens(reference[key]).join(),
    );
    expect(differ).toEqual([]);
  });

  it('leaves no text empty', () => {
    const empty = Object.keys(messages).filter(
      (key) => !messages[key]?.trim() && !MAY_BE_EMPTY.includes(key),
    );
    expect(empty).toEqual([]);
  });
});

describe('choosing a language', () => {
  it('takes the first browser language the app speaks, by its base, English otherwise', () => {
    expect(detect(['pt-BR', 'en'])).toBe('pt');
    expect(detect(['de-AT'])).toBe('de');
    expect(detect(['ja-JP', 'fr-CA', 'it'])).toBe('fr');
    expect(detect(['ja-JP'])).toBe('en');
    expect(detect([])).toBe('en');
  });
});

describe('loading a language on demand', () => {
  afterEach(() => vi.useRealTimers());

  const app = async (loaders: Parameters<typeof localeBackend>[0], lng = 'en') => {
    const instance = i18next.createInstance();
    await instance.use(localeBackend(loaders)).init({
      resources: { en: { translation: { hello: 'Hello', only: 'English only' } } },
      partialBundledLanguages: true,
      lng,
      fallbackLng: 'en',
    });
    return instance;
  };

  it('loads the catalogue when the language is chosen, and only then', async () => {
    const es = vi.fn(async () => ({ default: { hello: 'Hola' } }));
    const instance = await app({ es });
    expect(es).not.toHaveBeenCalled();
    expect(instance.t('hello')).toBe('Hello');
    await instance.changeLanguage('es');
    expect(es).toHaveBeenCalledOnce();
    expect(instance.t('hello')).toBe('Hola');
    expect(instance.t('only')).toBe('English only');
  });

  it('starts in a language that has to be loaded', async () => {
    const instance = await app({ es: async () => ({ default: { hello: 'Hola' } }) }, 'es');
    expect(instance.t('hello')).toBe('Hola');
  });

  it('keeps working in English when the chunk fails', async () => {
    const instance = await app({
      es: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    });
    await instance.changeLanguage('es');
    expect(instance.t('hello')).toBe('Hello');
  });

  it('keeps working in English when the language has no catalogue', async () => {
    const instance = await app({});
    await instance.changeLanguage('xx');
    expect(instance.t('hello')).toBe('Hello');
  });

  it('does not wait for a chunk that never arrives', async () => {
    vi.useFakeTimers();
    const instance = await app({ es: () => new Promise(() => {}) });
    const changing = instance.changeLanguage('es');
    await vi.advanceTimersByTimeAsync(10_000);
    await changing;
    expect(instance.t('hello')).toBe('Hello');
  });

  it.each(LOCALES.filter((locale) => locale !== 'en'))('finds the %s chunk', async (locale) => {
    await i18n.loadLanguages(locale);
    expect(i18n.hasResourceBundle(locale, 'translation')).toBe(true);
  });

  it('reads a count of a million in the language, not in English', async () => {
    expect(withManyForms({ a: { b_one: 'x', b_other: 'y' } })).toEqual({
      a: { b_one: 'x', b_other: 'y', b_many: 'y' },
    });
    expect(withManyForms({ b_other: 'y', b_many: 'de y' })).toEqual({
      b_other: 'y',
      b_many: 'de y',
    });
    const instance = await app(
      { es: async () => ({ default: { n_one: '{{count}} cosa', n_other: '{{count}} cosas' } }) },
      'es',
    );
    expect(instance.t('n', { count: 1_000_000 })).toBe('1000000 cosas');
  });

  it('shows a count of 0 where French reads 0 as singular', async () => {
    await i18n.loadLanguages('fr');
    const zero = i18n.getFixedT('fr')('backups.filesListed', { count: 0, size: '0 B' });
    expect(zero).toBe('répertorie 0 fichier (0 B)');
  });
});

describe('translations', () => {
  it('English has every Italian key and nothing more', () => {
    expect(keys(en).sort()).toEqual(keys(itMessages).sort());
  });

  it('every literal t("…") key used in the sources exists', () => {
    const have = new Set(keys(itMessages));
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? sources(join(dir, e.name))
          : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const missing: string[] = [];
    for (const file of sources(join(__dirname, '..'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/(?<![\w.])t\(\s*'(\w+(?:\.\w+)+)'/g)) {
        const key = m[1] as string;
        if (!have.has(key) && !have.has(`${key}_one`) && !have.has(`${key}_other`))
          missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // R2-04: "1 commenti", "1 poligoni". A count needs a `_one` and an `_other` form in both
  // languages; these show a count that is never 1 or reads the same in the singular.
  const INVARIABLE = [
    'tags.max',
    'settingsUi.account.allSessions',
    'viewer.pageOne',
    'comments.reactionChip',
    'office.page',
    'office.sheetOf',
  ];
  it.each(LOCALES)('%s counts have a singular and a plural form', (locale) => {
    const all = flat(catalogue(locale));
    const alone = Object.keys(all).filter(
      (key) =>
        /\{\{count\}\}/.test(all[key] ?? '') &&
        !/_(one|other|many)$/.test(key) &&
        !INVARIABLE.includes(key) &&
        !(all[`${key}_one`] && all[`${key}_other`]),
    );
    expect(alone).toEqual([]);
    const half = Object.keys(all).filter(
      (key) => key.endsWith('_one') && !all[key.replace(/_one$/, '_other')],
    );
    expect(half).toEqual([]);
  });

  it('pluralises the import summary and file details', async () => {
    await i18n.changeLanguage('it');
    expect(i18n.t('transfer.summary', { boards: 1, files: 1, comments: 1 })).toBe(
      '1 board · 1 file · 1 commento',
    );
    expect(i18n.t('transfer.summary', { boards: 3, files: 9, comments: 2 })).toBe(
      '3 board · 9 file · 2 commenti',
    );
    expect(i18n.t('board.file.polygons', { count: 1 })).toBe('1 poligono');
    expect(i18n.t('board.file.polygons', { count: 12 })).toBe('12 poligoni');
    expect(i18n.t('board.file.glyphs', { count: 1 })).toBe('1 glifo');
    expect(i18n.t('film.list.selectedCount', { count: 1 })).toBe('1 selezionata');
    expect(i18n.t('film.list.selectedCount', { count: 4 })).toBe('4 selezionate');
    await i18n.changeLanguage('en');
    expect(i18n.t('transfer.summary', { boards: 1, files: 1, comments: 1 })).toBe(
      '1 board · 1 file · 1 comment',
    );
    expect(i18n.t('board.file.polygons', { count: 1 })).toBe('1 polygon');
    expect(i18n.t('admin.membersCount', { count: 1 })).toBe('1 account');
    await i18n.changeLanguage('it');
  });

  it('pluralises onboarding summary in English and Italian', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('onboarding.summary', { boards: 1, invitations: 1 })).toBe(
      '1 board and 1 invitation will be created',
    );
    expect(i18n.t('onboarding.summary', { boards: 2, invitations: 2 })).toBe(
      '2 boards and 2 invitations will be created',
    );
    await i18n.changeLanguage('it');
    expect(i18n.t('onboarding.summary', { boards: 1, invitations: 1 })).toBe(
      'Verranno creati 1 board e 1 invito',
    );
    expect(i18n.t('onboarding.summary', { boards: 2, invitations: 2 })).toBe(
      'Verranno creati 2 board e 2 inviti',
    );
  });
});

it('keeps optional translator options and intentionally empty particles', async () => {
  await i18nReady;
  const words: Words = i18n.getFixedT('en');
  const options: Record<string, unknown> | undefined = undefined;
  expect(words('board.added.feminine', options)).toBe('');
  expect(words('board.added.feminine', { lng: 'en' })).toBe('');
});
