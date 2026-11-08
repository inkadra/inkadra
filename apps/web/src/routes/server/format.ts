import type { ServerProblem, ServerService, ServerStatus } from '@inkadra/shared';

/** How a meter reads in plain words: calm, busy or at the limit (#514). */
export type Verdict = 'ok' | 'busy' | 'high';

export function loadVerdict(share: number): Verdict {
  return share < 0.6 ? 'ok' : share < 0.85 ? 'busy' : 'high';
}

/** Under half a second is fast, as the page says. */
export function speedVerdict(p95: number | null): 'fast' | 'slow' | 'verySlow' | 'idle' {
  if (p95 === null) return 'idle';
  return p95 < 500 ? 'fast' : p95 < 1500 ? 'slow' : 'verySlow';
}

/** "Enough for about N months", or a warning when it is less than one. */
export function storageVerdict(storage: ServerStatus['storage']): {
  key: 'years' | 'months' | 'almostFull' | 'unknown';
  months?: number;
} {
  if (storage.total !== null && storage.free !== null && storage.total > 0) {
    if (storage.free / storage.total < 0.1 || storage.free < 5e9) return { key: 'almostFull' };
  }
  if (storage.monthsLeft === null) return { key: 'unknown' };
  if (storage.monthsLeft > 24) return { key: 'years' };
  if (storage.monthsLeft < 1) return { key: 'almostFull' };
  return { key: 'months', months: Math.round(storage.monthsLeft) };
}

/**
 * A local disk that compresses (ZFS, btrfs) takes less space than the files' real size, so the
 * originals, copies and previews add up to more than "used" (#526).
 * shortcut: `used` covers the whole filesystem under DATA_DIR (backups, other data), so on a
 * compressing disk that holds other data too this can stay false; upgrade by measuring the data
 * folder itself if admins still ask.
 */
export function diskCompresses(storage: ServerStatus['storage']): boolean {
  return (
    storage.total !== null && storage.used < storage.originals + storage.copies + storage.previews
  );
}

/** Services that stop part of Inkadra; `configuration` warns only. */
export function downServices(services: ServerService[]): ServerService[] {
  return services.filter((s) => s.status === 'down' && s.id !== 'configuration');
}

/** Open problems: not marked seen, newest first (the server sorts them). */
export function openProblems(problems: ServerProblem[]): ServerProblem[] {
  return problems.filter((p) => !p.seen);
}

export function bits(bytesPerSecond: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabit-per-second',
    maximumFractionDigits: bytesPerSecond * 8 < 1e7 ? 1 : 0,
  }).format((bytesPerSecond * 8) / 1e6);
}

export function percent(value: number, locale: string, digits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(value);
}

export function number(value: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/** "6 days", "4 hours", "12 minutes": the largest unit that fits. */
export function duration(ms: number, locale: string, display: 'long' | 'short' = 'long'): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const [value, unit] =
    minutes >= 2 * 1440
      ? [Math.floor(minutes / 1440), 'day']
      : minutes >= 120
        ? [Math.floor(minutes / 60), 'hour']
        : ms >= 60_000
          ? [minutes, 'minute']
          : [Math.max(0, Math.round(ms / 1000)), 'second'];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: display }).format(value);
}

/** "3 s ago", "2 min ago". */
export function ago(iso: string, now: number, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
  if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

/** The day of a moment against now: today, yesterday, tomorrow, or another. */
export function dayOf(iso: string, now: number): 'today' | 'yesterday' | 'tomorrow' | 'other' {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date(now)) - start(new Date(iso))) / 86_400_000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : days === -1 ? 'tomorrow' : 'other';
}

/** A chart's top: the value rounded up to 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (value <= m * exp) return m * exp;
  return 10 * exp;
}
