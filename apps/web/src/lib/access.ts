import type { User } from '@inkadra/shared';

/** Decision 0041: servers before API 0.9.0 do not say, and there everyone can. */
export function canCreateProjects(user: Pick<User, 'canCreateProjects'> | null | undefined) {
  return user?.canCreateProjects !== false;
}

const DAY = 86_400_000;
/** Within this, an end date is shown in the warning colour. */
export const EXPIRY_SOON_MS = 3 * DAY;
/** The server accepts end dates up to this far ahead. */
export const EXPIRY_MAX_DAYS = 366;

export function expiresSoon(iso: string, now = Date.now()) {
  return new Date(iso).getTime() - now <= EXPIRY_SOON_MS;
}

/** "15 Dec", with the year only when it is not this year's. */
export function expiryDate(iso: string, locale: string, now = new Date()) {
  const at = new Date(iso);
  return at.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

const pad = (n: number) => String(n).padStart(2, '0');
/** `yyyy-mm-dd` of a moment in local time, for `<input type="date">`. */
export function dateInputValue(at: Date) {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Access chosen "until 15 Dec" lasts the whole of that day, in local time. */
export function endOfDay(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 0);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Bounds of the date picker: tomorrow to the furthest day the server accepts. Calendar days,
 * not 24-hour steps, so a daylight saving change cannot move them.
 */
export function expiryBounds(now = new Date()) {
  const day = (offset: number) =>
    dateInputValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  return { min: day(1), max: day(EXPIRY_MAX_DAYS - 1) };
}
