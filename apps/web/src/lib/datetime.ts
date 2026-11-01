import type { UserPreferences } from '@inkadra/shared';
import { getPreferences } from './preferences.ts';

type Formats = Pick<UserPreferences, 'dateFormat' | 'timeFormat'>;

/**
 * "From the browser" (#302): the browser's own variant of the interface language when they
 * share it (en-GB writes 14/11/2026), the interface language otherwise.
 */
function autoLocale(language: string): string {
  const browser = typeof navigator === 'undefined' ? '' : navigator.language;
  // A language that already names its region (en-GB) is kept as it is.
  if (language.includes('-')) return language;
  return browser && browser.split('-')[0] === language ? browser : language;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A date as the chosen numeric pattern: 14/11/2026, 11/14/2026 or 2026-11-14. */
function numericDate(date: Date, format: Exclude<Formats['dateFormat'], 'auto'>, utc: boolean) {
  const y = utc ? date.getUTCFullYear() : date.getFullYear();
  const m = pad((utc ? date.getUTCMonth() : date.getMonth()) + 1);
  const d = pad(utc ? date.getUTCDate() : date.getDate());
  return format === 'dmy'
    ? `${d}/${m}/${y}`
    : format === 'mdy'
      ? `${m}/${d}/${y}`
      : `${y}-${m}-${d}`;
}

/**
 * Every date and time shown to the person goes through here, with their date and time format
 * (#302). A chosen numeric date replaces the short and medium styles; long dates written in
 * words (with the weekday or the month name in full) keep the language's own form.
 */
export function formatDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions,
  formats: Formats = getPreferences(),
  // The interface language, which i18n/index.ts keeps on the page (no import: tests mock it).
  language: string = (typeof document !== 'undefined' && document.documentElement.lang) || 'it',
): string {
  const date = value instanceof Date ? value : new Date(value);
  const hasTime = options.timeStyle !== undefined || options.hour !== undefined;
  const hour12 =
    !hasTime || formats.timeFormat === 'auto' ? {} : { hour12: formats.timeFormat === '12h' };
  const numeric =
    formats.dateFormat !== 'auto' &&
    (options.dateStyle === 'short' ||
      options.dateStyle === 'medium' ||
      (options.dateStyle === undefined &&
        options.day !== undefined &&
        options.month !== undefined &&
        options.month !== 'long' &&
        options.weekday === undefined));
  const locale = autoLocale(language);
  if (!numeric || formats.dateFormat === 'auto')
    return new Intl.DateTimeFormat(locale, { ...options, ...hour12 }).format(date);
  const day = numericDate(date, formats.dateFormat, options.timeZone === 'UTC');
  if (!hasTime) return day;
  const time = new Intl.DateTimeFormat(locale, {
    ...(options.timeStyle
      ? { timeStyle: options.timeStyle }
      : { hour: options.hour, minute: options.minute }),
    timeZone: options.timeZone,
    ...hour12,
  }).format(date);
  return `${day} ${time}`;
}

/** A wall-clock time kept as "HH:MM" (call times, wrap), in the chosen time format. */
export function formatClock(value: string, formats: Formats = getPreferences()): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || formats.timeFormat !== '12h') return value;
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? 'AM' : 'PM'}`;
}
