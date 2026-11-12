// SPDX-License-Identifier: MPL-2.0
import { PLAN_WORDS_EN, type Words } from './plan-words.ts';

/**
 * For the package's tests: `PLAN_WORDS_EN` read as i18next reads it (`count` picks `_one` or
 * `_other`, `{{x}}` is filled in). A key the package does not carry throws, so a missing or
 * misspelt key fails the test that asks for it.
 */
export const english: Words = (key, values = {}) => {
  const find = (k: string) =>
    k
      .split('.')
      .reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], PLAN_WORDS_EN);
  const count = values.count;
  const text =
    typeof count === 'number' ? find(`${key}_${count === 1 ? 'one' : 'other'}`) : find(key);
  if (typeof text !== 'string') throw new Error(`No English for ${key}`);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
};
