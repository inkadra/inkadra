// SPDX-License-Identifier: MPL-2.0

/** The parts of a time being typed: hours 0-23 and minutes 0-59, either still empty. */
export type TimeParts = { h: number | null; m: number | null };

const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:MM" (24 h) into its parts; anything else is empty. */
export function timeParts(value: string | null | undefined): TimeParts {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  const h = Number(match?.[1]);
  const m = Number(match?.[2]);
  return match && h < 24 && m < 60 ? { h, m } : { h: null, m: null };
}

/** The stored form of a time, always "HH:MM" in 24 h; empty until the hour is known. */
export function timeValue({ h, m }: TimeParts): string {
  return h === null ? '' : `${pad(h)}:${pad(m ?? 0)}`;
}

/** The hour as shown: 0-23 in 24 h, 1-12 in 12 h. */
export const shownHour = (h: number, hour12: boolean) => (hour12 ? h % 12 || 12 : h);

/**
 * One digit typed into the hours or minutes segment. `buffer` holds the digit typed before it in
 * the same segment, if any. A digit that cannot start a two-digit value completes the segment at
 * once (`done`, the focus moves on); otherwise the next digit does. A pair out of range starts
 * again from the new digit, so hours over 23 (12) or minutes over 59 cannot be typed. In 12 h
 * the hour keeps the half of the day of `pm`.
 */
export function typeDigit(
  segment: 'h' | 'm',
  buffer: string,
  digit: number,
  options: { hour12: boolean; pm: boolean },
): { value: number; buffer: string; done: boolean } {
  const max = segment === 'm' ? 59 : options.hour12 ? 12 : 23;
  const lead = Math.floor(max / 10);
  const pair = buffer === '' ? null : Number(buffer) * 10 + digit;
  const toHour = (n: number) =>
    segment === 'h' && options.hour12 ? (n % 12) + (options.pm ? 12 : 0) : n;
  if (pair !== null && pair <= max && !(options.hour12 && segment === 'h' && pair === 0))
    return { value: toHour(pair), buffer: '', done: true };
  if (digit > lead) return { value: toHour(digit), buffer: '', done: true };
  return { value: toHour(digit), buffer: String(digit), done: false };
}

/** Up or down by `step` in one segment, wrapping within the day or the hour. */
export function stepTime(
  parts: TimeParts,
  segment: 'h' | 'm' | 'p',
  step: number,
  from: TimeParts,
): TimeParts {
  const h = parts.h ?? from.h ?? 0;
  const m = parts.m ?? from.m ?? 0;
  if (segment === 'p') return { h: (h + 12) % 24, m };
  if (segment === 'h') return { h: (((h + step) % 24) + 24) % 24, m };
  const total = (((h * 60 + m + step) % 1440) + 1440) % 1440;
  // Minutes wrap within their hour, as the native field does.
  return { h, m: total % 60 };
}

/**
 * A pasted or dropped time, in either format: "1930", "19:30", "19.30", "7:30 pm", "7pm", "7".
 * Null when it is not one.
 */
export function parseTime(text: string): TimeParts | null {
  const match = /^\s*(\d{1,2})(?:[:.h]?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?\s*$/i.exec(text);
  if (!match) return null;
  let h = Number(match[1]);
  const m = match[2] === undefined ? 0 : Number(match[2]);
  const period = match[3]?.toLowerCase();
  if (m > 59) return null;
  if (period) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (period === 'p' ? 12 : 0);
  }
  return h > 23 ? null : { h, m };
}

/** The minutes of the list: every `step` minutes, plus a typed minute off the step in its place. */
export function minuteOptions(step: number, current: number | null): number[] {
  const list = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (current !== null && !list.includes(current)) {
    list.push(current);
    list.sort((a, b) => a - b);
  }
  return list;
}
