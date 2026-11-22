// SPDX-License-Identifier: MPL-2.0

import { formatBytes } from '@inkadra/shared/bytes';
import { errorMessageKey, serializeError } from './errors.ts';

export function errorText(err: unknown): string {
  const error = serializeError(err);
  if (error.kind === 'too_large' && error.uploadMaxBytes && error.uploadMaxBytes > 0)
    return t('error_too_large_limit', formatBytes(error.uploadMaxBytes));
  return t(errorMessageKey(error.kind));
}

/** Text from _locales (English is the default locale). Falls back to the key when missing. */
export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * chrome.i18n has no plurals: a count uses `<key>_one` and `<key>_other`, with the count as $1
 * and `rest` as $2…, chosen by the browser language's plural rules.
 */
export function plural(key: string, count: number, rest: string[] = []): string {
  const form = new Intl.PluralRules(chrome.i18n.getUILanguage()).select(count);
  return t(`${key}_${form === 'one' ? 'one' : 'other'}`, [String(count), ...rest]);
}

/** Fills `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` and `data-i18n-aria-label`. */
export function localize(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]'))
    el.textContent = t(el.dataset.i18n ?? '');
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]'))
    el.placeholder = t(el.dataset.i18nPlaceholder ?? '');
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]'))
    el.title = t(el.dataset.i18nTitle ?? '');
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]'))
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel ?? ''));
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0] ?? 'en';
}
