import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import i18n from './index.ts';
import itMessages from './it.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

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
  it.each([
    ['Italian', itMessages],
    ['English', en],
  ])('%s counts have a singular and a plural form', (_name, messages) => {
    const all = Object.fromEntries(
      keys(messages).map((key) => [key, key.split('.').reduce<any>((o, k) => o[k], messages)]),
    ) as Record<string, string>;
    const alone = Object.keys(all).filter(
      (key) =>
        /\{\{count\}\}/.test(all[key] ?? '') &&
        !/_(one|other)$/.test(key) &&
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
