// SPDX-License-Identifier: MPL-2.0
/**
 * Calendar dates as YYYY-MM-DD strings on UTC midnight: days carry no time zone (decision 0022).
 * Weeks start on Monday. Shared by the date field's calendar and the shooting schedule.
 */

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) return date;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the week of `date`. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

/** The six weeks of a month grid, Monday first, with the days of the next and previous months. */
export function monthGrid(month: string): string[] {
  const start = weekStart(`${month.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Today (or any moment) as a calendar date in local time. */
export const localDate = (now: Date) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** The same day `months` later, kept inside the shorter month (31 Jan + 1 → 28 Feb). */
export function addMonths(date: string, months: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const total = year * 12 + month - 1 + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${pad(y, 4)}-${pad(m + 1)}-${pad(Math.min(day, last))}`;
}

export const clampDate = (date: string, min?: string, max?: string) =>
  min && date < min ? min : max && date > max ? max : date;

/**
 * Where a key moves the calendar's cursor: arrows by a day or a week, Page Up and Page Down by a
 * month, Home and End to the ends of the week. Null for any other key.
 */
export function calendarKey(date: string, key: string): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'PageUp':
      return addMonths(date, -1);
    case 'PageDown':
      return addMonths(date, 1);
    case 'Home':
      return weekStart(date);
    case 'End':
      return addDays(weekStart(date), 6);
    default:
      return null;
  }
}

/**
 * Where a key moves the cursor of the month grid (three months a row): arrows by a month or a row,
 * Page Up and Page Down by a year, Home and End to the ends of the row. Null for any other key.
 */
export function monthKey(date: string, key: string): string | null {
  const column = (Number(date.slice(5, 7)) - 1) % 3;
  const step = (
    {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
      PageUp: -12,
      PageDown: 12,
      Home: -column,
      End: 2 - column,
    } as Record<string, number | undefined>
  )[key];
  return step === undefined ? null : addMonths(date, step);
}

export interface DayContext {
  /** Any day of the month on show. */
  month: string;
  today: string;
  value?: string;
  /** The start of a range that ends on `value`. */
  rangeStart?: string;
  min?: string;
  max?: string;
}

/** How a day of the grid looks: the range shows only when the value comes after its start. */
export function dayState(date: string, c: DayContext) {
  const range = !!(c.rangeStart && c.value && c.value > c.rangeStart);
  return {
    outside: date.slice(0, 7) !== c.month.slice(0, 7),
    today: date === c.today,
    selected: date === c.value,
    disabled: !!((c.min && date < c.min) || (c.max && date > c.max)),
    rangeStart: range && date === c.rangeStart,
    inRange: range && date > (c.rangeStart as string) && date < (c.value as string),
    rangeEnd: range && date === c.value,
  };
}
