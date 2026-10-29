import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import it from './it.json';
import { LOCALES, type Locale } from './locales.ts';

export { LOCALES, type Locale };

function detect(): Locale {
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages;
  for (const tag of preferred) {
    const base = tag.slice(0, 2) as Locale;
    if (LOCALES.includes(base)) return base;
  }
  return 'it';
}

void i18n.use(initReactI18next).init({
  resources: { it: { translation: it }, en: { translation: en } },
  lng: detect(),
  fallbackLng: 'it',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Guarded so modules importing i18n also load in Node test runs.
if (typeof document !== 'undefined') {
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
  document.documentElement.lang = i18n.language;
}

export default i18n;
