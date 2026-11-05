/**
 * Texts of the emails the server sends, one file per language in mail-texts/ (Italian is the
 * reference, English the fallback). The web app has its own catalogues; emails are rendered on
 * the server, so they live here.
 */

import { de } from './mail-texts/de.ts';
import { en } from './mail-texts/en.ts';
import { es } from './mail-texts/es.ts';
import { fr } from './mail-texts/fr.ts';
import { it, type MailTexts as Texts } from './mail-texts/it.ts';
import { pt } from './mail-texts/pt.ts';

const time = (at: Date, locale: string, timeZone?: string) =>
  at.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  });

/** A date in the server's zone: "12 novembre 2026", without the year when `year` is false. */
export function mailDate(at: Date, locale: string, timeZone?: string, year = true): string {
  return at.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    ...(year ? { year: 'numeric' } : {}),
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * When access ends, for emails. Accounts keep no time zone, so the time and the zone name
 * (the server's) go with the date: "15 dicembre, 23:59 CET" is unambiguous anywhere.
 */
export function accessWhen(at: Date, locale: string, timeZone?: string): string {
  return `${mailDate(at, locale, timeZone, false)}, ${time(at, locale, timeZone)}`;
}

/** A moment with its year, time and zone: "5 novembre 2026, 18:42 CET". */
export function mailDateTime(at: Date, locale: string, timeZone?: string): string {
  return `${mailDate(at, locale, timeZone)}, ${time(at, locale, timeZone)}`;
}

const dayKey = (at: Date, timeZone?: string) =>
  at.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });

/** When a notification happened: "Oggi, 18:39 CET", "Ieri, …" or the date, in the server's zone. */
export function rowWhen(at: Date, now: Date, texts: Texts, timeZone?: string): string {
  const day = dayKey(at, timeZone);
  const today = dayKey(now, timeZone);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  const label =
    day === today
      ? texts.today
      : day === yesterday
        ? texts.yesterday
        : mailDate(at, texts.locale, timeZone, day.slice(0, 4) !== today.slice(0, 4));
  return `${label}, ${time(at, texts.locale, timeZone)}`;
}

const TEXTS: Record<string, Texts> = { it, en, es, de, fr, pt };

export function mailText(who: { locale?: string | null }): Texts {
  // shortcut: nothing sets `locale` at sign-up, so an account that never opened the language
  // setting has none, and today it reads Italian. It stays so until that is decided: a plain
  // English default would switch those people's emails without notice.
  if (!who.locale) return it;
  return TEXTS[who.locale.slice(0, 2).toLowerCase()] ?? en;
}

export type { Texts as MailTexts };
