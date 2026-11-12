// SPDX-License-Identifier: MPL-2.0
import { PLAN_WORDS_EN, type Words } from './plan-words.ts';

/**
 * For the package's tests: a catalogue read as i18next reads it (`count` picks `_one` or
 * `_other`, `{{x}}` is filled in, `defaultValue` stands in for a key it lacks). Any other key it
 * does not carry throws, so a missing or misspelt key fails the test that asks for it.
 */
export const wordsOf =
  (catalogue: object): Words =>
  (key, values = {}) => {
    const find = (k: string) =>
      k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], catalogue);
    const count = values.count;
    const text =
      typeof count === 'number' ? find(`${key}_${count === 1 ? 'one' : 'other'}`) : find(key);
    if (typeof text !== 'string') {
      if (typeof values.defaultValue === 'string') return values.defaultValue;
      throw new Error(`No words for ${key}`);
    }
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
  };

/** `PLAN_WORDS_EN` read as i18next reads it. */
export const english: Words = wordsOf(PLAN_WORDS_EN);
