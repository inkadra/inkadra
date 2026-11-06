import type { BackendModule, ReadCallback } from 'i18next';

type Messages = { [key: string]: string | Messages };

/** Long enough for a slow connection; past it the app carries on in English. */
const LOAD_TIMEOUT_MS = 10_000;

/**
 * Spanish, French, Portuguese and Italian have a CLDR `many` form (1 000 000), which i18next looks
 * for and does not find, so such a count would come out in English. It reads as `_other` unless
 * the catalogue writes its own.
 */
export function withManyForms(messages: Messages): Messages {
  const filled: Messages = {};
  for (const [key, value] of Object.entries(messages)) {
    filled[key] = typeof value === 'string' ? value : withManyForms(value);
    const stem = key.endsWith('_other') ? key.slice(0, -'_other'.length) : null;
    if (stem && typeof value === 'string' && !(`${stem}_many` in messages))
      filled[`${stem}_many`] = value;
  }
  return filled;
}

/**
 * Loads a language's catalogue when it is needed. A failure or a stalled download is reported as a
 * failed load: i18next then answers from the fallback language instead of waiting.
 * shortcut: i18next does not retry a failed language until the next page load, which is enough for
 * a catalogue that is also in the service worker's precache.
 */
export function localeBackend(
  loaders: Record<string, () => Promise<{ default: object }>>,
  timeoutMs = LOAD_TIMEOUT_MS,
): BackendModule {
  return {
    type: 'backend',
    init() {},
    read(language: string, _namespace: string, callback: ReadCallback) {
      const load = loaders[language];
      if (!load) {
        callback(new Error(`No catalogue for ${language}`), false);
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out loading ${language}`)), timeoutMs);
      });
      void Promise.race([load(), stalled])
        .then(
          (module) => callback(null, withManyForms(module.default as Messages)),
          (error: Error) => callback(error, false),
        )
        .finally(() => clearTimeout(timer));
    },
  };
}
