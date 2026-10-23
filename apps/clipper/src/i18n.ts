// SPDX-License-Identifier: MPL-2.0

/** Text from _locales (Italian is the default locale). Falls back to the key when missing. */
export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
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
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0] ?? 'it';
}
