// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_WORDS_EN, SHEET_WORDS_EN } from './plan-words.ts';
import { PLAN_WORDS_FR } from './plan-words-fr.ts';
import { PLAN_WORDS_IT } from './plan-words-it.ts';
import { PLAN_WORDS_PT } from './plan-words-pt.ts';
import { wordsFrom } from './words.ts';

const en = { ...PLAN_WORDS_EN, ...SHEET_WORDS_EN };

describe('wordsFrom (decision 0122)', () => {
  it('picks the plural form of the language and fills in the values', () => {
    const t = wordsFrom('en', [en]);
    expect(t('board.plan.positions', { count: 1 })).toBe('1 position');
    expect(t('board.plan.positions', { count: 0 })).toBe('0 positions');
    expect(t('board.plan.positions', { count: 3 })).toBe('3 positions');
    expect(t('board.plan.powerAt', { volts: 230 })).toBe('Power at 230 V');
  });

  it('says one at 0 in French and Portuguese, as i18next does', () => {
    const fr = wordsFrom('fr', [PLAN_WORDS_FR, en]);
    const pt = wordsFrom('pt', [PLAN_WORDS_PT, en]);
    expect(fr('board.plan.positions', { count: 0 })).toBe(
      PLAN_WORDS_FR.board.plan.positions_one.replace('{{count}}', '0'),
    );
    expect(pt('board.plan.positions', { count: 0 })).toBe(
      PLAN_WORDS_PT.board.plan.positions_one.replace('{{count}}', '0'),
    );
    // "many" (a million in French) has no form of its own: the catalogue's "other".
    expect(fr('board.plan.positions', { count: 1_000_000 })).toBe(
      PLAN_WORDS_FR.board.plan.positions_other.replace('{{count}}', '1000000'),
    );
  });

  it('falls back to the next catalogue, then to the default value or the key', () => {
    const t = wordsFrom('it', [{ board: { plan: { name: 'Pianta' } } }, en]);
    expect(t('board.plan.name')).toBe('Pianta');
    expect(t('board.plan.base')).toBe('Base');
    expect(t('film.scene.times.night')).toBe('NIGHT');
    expect(t('no.such.key', { defaultValue: 'Fallback' })).toBe('Fallback');
    expect(t('no.such.key')).toBe('no.such.key');
    expect(wordsFrom('it', [PLAN_WORDS_IT])('board.plan.name')).toBe(PLAN_WORDS_IT.board.plan.name);
  });

  it('escapes nothing and leaves a placeholder with no value', () => {
    const t = wordsFrom('en', [{ a: '<b>{{name}}</b> & {{other}}' }]);
    expect(t('a', { name: '"Rosa" & <co>' })).toBe('<b>"Rosa" & <co></b> & {{other}}');
  });
});

describe('wordsFrom on Hermes, without Intl.PluralRules', () => {
  const PluralRules = Intl.PluralRules;
  afterEach(() => {
    Object.assign(Intl, { PluralRules });
  });

  it('says one for 1 and other else, where the old `new Intl.PluralRules` threw', () => {
    Reflect.deleteProperty(Intl, 'PluralRules');
    expect(() => new Intl.PluralRules('en')).toThrow(TypeError);
    const t = wordsFrom('en', [en]);
    expect(t('board.plan.positions', { count: 1 })).toBe('1 position');
    expect(t('board.plan.positions', { count: 0 })).toBe('0 positions');
    expect(t('board.plan.positions', { count: 3 })).toBe('3 positions');
    expect(t('board.plan.name')).toBe(en.board.plan.name);
  });
});

describe('wordsFrom without Intl at all', () => {
  const intl = Intl;
  afterEach(() => {
    Object.assign(globalThis, { Intl: intl });
  });

  it('says one for 1 and other else', () => {
    Reflect.deleteProperty(globalThis, 'Intl');
    const t = wordsFrom('en', [en]);
    const said = [1, 0, 3].map((count) => t('board.plan.positions', { count }));
    Object.assign(globalThis, { Intl: intl });
    expect(said).toEqual(['1 position', '0 positions', '3 positions']);
  });
});
