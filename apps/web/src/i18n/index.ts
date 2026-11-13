import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { localeBackend } from './backend.ts';
import en from './en.json';
import { LOCALES, type Locale } from './locales.ts';

// Keep the existing dynamic-key translator contract when forwarding optional options.
// i18next 27 makes interpolation checks strict by default.
declare module 'i18next' {
  interface CustomTypeOptions {
    strictInterpolationChecks: false;
    returnEmptyString: true;
  }
}

export { LOCALES, type Locale };

/** The first language of the browser that the app speaks; English otherwise. */
export function detect(
  preferred: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): Locale {
  for (const tag of preferred) {
    const base = tag.slice(0, 2) as Locale;
    if (LOCALES.includes(base)) return base;
  }
  return 'en';
}

/** English is in the main bundle, as the fallback; each other language is its own chunk. */
const LOADERS: Record<Exclude<Locale, 'en'>, () => Promise<{ default: object }>> = {
  it: () => import('./it.json'),
  es: () => import('./es.json'),
  de: () => import('./de.json'),
  fr: () => import('./fr.json'),
  pt: () => import('./pt.json'),
};

/** Settled once the first language is loaded, or has failed and English stands in for it. */
export const i18nReady = i18n
  .use(localeBackend(LOADERS))
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    lng: detect(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
    // Empty grammatical particles (board.added.feminine) deliberately render nothing.
    returnEmptyString: true,
    // main.tsx waits for i18nReady, and nothing around the app could show a suspended language.
    react: { useSuspense: false },
  });

// Guarded so modules importing i18n also load in Node test runs.
if (typeof document !== 'undefined') {
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
  document.documentElement.lang = i18n.language;
}

export default i18n;
