import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function calendarToken(secret: string, userId: string, generation: string) {
  return `${userId}.${createHmac('sha256', secret).update(`calendar-feed:${userId}:${generation}`).digest('base64url')}`;
}
export function matchesToken(token: string, hash: string) {
  const stored = Buffer.from(hash, 'hex');
  const candidate = Buffer.from(tokenHash(token), 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping C0 controls is the point.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const escapeIcs = (value: string) =>
  value
    .replace(CONTROL, '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
/** RFC 5545 limits physical lines to 75 octets, never split a UTF-8 character. */
export function foldIcs(line: string) {
  let result = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += char;
    bytes += size;
  }
  return result;
}
export interface CalendarEvent {
  uid: string;
  title: string;
  description: string;
  location?: string;
  date: string;
  time?: string;
  wrap?: string | null;
  timeZone?: string;
  modified?: Date;
}
const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
/** Resolve a project-local wall clock using the platform's IANA database (DST included). */
export function localInstant(date: string, time: string, timeZone: string) {
  const target = Date.parse(`${date}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const before = target - 86400000;
  let instant =
    target - (Date.parse(`${fmt.format(new Date(before)).replace(' ', 'T')}Z`) - before);
  let previous = instant;
  for (let i = 0; i < 4; i++) {
    const wall = Date.parse(`${fmt.format(new Date(instant)).replace(' ', 'T')}Z`);
    const delta = target - wall;
    if (!delta) return new Date(instant);
    const next = instant + delta;
    if (next === previous) return new Date(Math.max(instant, next));
    previous = instant;
    instant = next;
  }
  // Nonexistent spring-forward clock time: advance to the first corresponding instant.
  return new Date(instant);
}
export function serializeCalendar(events: CalendarEvent[], name = 'Inkadra') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Inkadra//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcs(event.uid)}@inkadra`,
      `DTSTAMP:${stamp(event.modified ?? new Date('2026-01-01T00:00:00Z'))}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(event.description)}`,
    );
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.time) {
      lines.push(`DTSTART:${stamp(localInstant(event.date, event.time, event.timeZone ?? 'UTC'))}`);
      // wrap == call would be a 24 h event: leave the end open. An earlier wrap is an overnight shoot.
      if (event.wrap && event.wrap !== event.time) {
        const endDate =
          event.wrap < event.time
            ? new Date(Date.parse(`${event.date}T00:00Z`) + 86400000).toISOString().slice(0, 10)
            : event.date;
        lines.push(`DTEND:${stamp(localInstant(endDate, event.wrap, event.timeZone ?? 'UTC'))}`);
      }
    } else {
      lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`);
      lines.push(
        `DTEND;VALUE=DATE:${new Date(Date.parse(event.date) + 86400000).toISOString().slice(0, 10).replace(/-/g, '')}`,
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcs).join('\r\n')}\r\n`;
}
