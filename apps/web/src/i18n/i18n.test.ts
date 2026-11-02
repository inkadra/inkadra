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
