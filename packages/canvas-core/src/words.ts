// SPDX-License-Identifier: MPL-2.0
import type { Words } from './plan-words.ts';

/**
 * Words read from catalogues as the apps' i18next reads theirs, for a client or the server that
 * prints the set plan's sheet without i18next (decision 0122). `catalogues` are searched in order,
 * one per language (the asked one, then its fallbacks, English last), as i18next's `fallbackLng`:
 *
 * - `count` picks the form `Intl.PluralRules(language)` names (`_one`, `_few`, `_many`…), then
 *   `_other`; `_zero` first when the count is 0. French and Portuguese say "0 position", as i18next.
 * - `{{name}}` is filled in with the value as text, nothing escaped (the apps' `escapeValue:
 *   false`); a value not given leaves the placeholder, as i18next does.
 * - A key no catalogue has gives `defaultValue`, else the key itself.
 */
export function wordsFrom(language: string, catalogues: readonly object[]): Words {
  const plural = new Intl.PluralRules(language);
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
            `${key}_${plural.select(count)}`,
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
