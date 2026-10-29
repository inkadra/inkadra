/** Supported interface languages; kept apart from index.ts so importing it starts nothing. */
export const LOCALES = ['it', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
