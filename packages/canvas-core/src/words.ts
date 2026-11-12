// SPDX-License-Identifier: MPL-2.0
import type { Words } from './plan-words.ts';

/**
 * Words read from catalogues as the apps' i18next reads theirs, for a client or the server that
 * prints the set plan's sheet without i18next (decision 0122). `catalogues` are searched in order,
 * one per language (the asked one, then its fallbacks, English last), as i18next's `fallbackLng`:
 *
 * - `count` picks the form `Intl.PluralRules(language)` names (`_one`, `_few`, `_many`…), then
 *   `_other`; `_zero` first when the count is 0. French and Portuguese say "0 position", as i18next.
 *   Where `Intl.PluralRules` is missing (Hermes, React Native), `one` for 1 and `other` else.
 * - `{{name}}` is filled in with the value as text, nothing escaped (the apps' `escapeValue:
 *   false`); a value not given leaves the placeholder, as i18next does.
 * - A key no catalogue has gives `defaultValue`, else the key itself.
 */
export function wordsFrom(language: string, catalogues: readonly object[]): Words {
  // Made on the first count, once: Hermes has no `Intl.PluralRules`.
  let plural: ((count: number) => string) | undefined;
  const pluralForm = (count: number) => {
    if (!plural) {
      // shortcut: English's rule for every language without Intl.PluralRules (Hermes), so a
      // language with few/many forms says "other" there; upgrade with a plural rules polyfill.
      const rules =
        typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function'
          ? new Intl.PluralRules(language)
          : undefined;
      plural = rules ? (n) => rules.select(n) : (n) => (n === 1 ? 'one' : 'other');
    }
    return plural(count);
  };
  const read = (catalogue: object, key: string) => {
    const text = key
      .split('.')
      .reduce<unknown>(
        (o, part) =>
          o && typeof o === 'object' ? (o as Record<string, unknown>)[part] : undefined,
        catalogue,
      );
    return typeof text === 'string' ? text : undefined;
  };
  return (key, values = {}) => {
    const count = values.count;
    const keys =
      typeof count === 'number'
        ? [
            ...(count === 0 ? [`${key}_zero`] : []),
            `${key}_${pluralForm(count)}`,
            `${key}_other`,
            key,
          ]
        : [key];
    let text: string | undefined;
    for (const catalogue of catalogues) {
      for (const k of keys) {
        text = read(catalogue, k);
        if (text !== undefined) break;
      }
      if (text !== undefined) break;
    }
    if (text === undefined)
      return typeof values.defaultValue === 'string' ? values.defaultValue : key;
    return text.replace(/\{\{-?\s*(\w+)\s*\}\}/g, (match, name: string) =>
      values[name] === undefined ? match : String(values[name]),
    );
  };
}
