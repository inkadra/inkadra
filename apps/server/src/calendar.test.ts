import { CreateProject } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import {
  calendarToken,
  foldIcs,
  localInstant,
  matchesToken,
  serializeCalendar,
  tokenHash,
} from './calendar.ts';

describe('private calendars', () => {
  it('validates the project time zone at the API boundary', () => {
    expect(CreateProject.safeParse({ name: 'Shoot', timeZone: 'Europe/Rome' }).success).toBe(true);
    expect(CreateProject.safeParse({ name: 'Shoot', timeZone: 'Not/AZone' }).success).toBe(false);
  });
  it('hashes, compares and revokes the derived credential', () => {
    const token = calendarToken('test secret', 'user', 'one');
    expect(tokenHash(token)).not.toContain(token);
    expect(matchesToken(token, tokenHash(token))).toBe(true);
    expect(matchesToken(calendarToken('test secret', 'user', 'two'), tokenHash(token))).toBe(false);
    expect(matchesToken(token, 'invalid')).toBe(false);
  });
  it('escapes text, folds by UTF-8 octets and emits all-day and timed events', () => {
    const text = serializeCalendar([
      {
        uid: 'task-1',
        title: 'A, B; C\\D\nInjected:yes',
        description: 'é'.repeat(100),
        date: '2026-12-31',
      },
      {
        uid: 'day-1',
        title: 'Shoot',
        description: '',
        date: '2026-07-01',
        time: '08:00',
        wrap: '02:00',
        timeZone: 'Europe/Rome',
      },
    ]);
    expect(text).toContain('SUMMARY:A\\, B\\; C\\\\D\\nInjected:yes\r\n');
    expect(text).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    expect(text).toContain('DTSTART:20260701T060000Z');
    expect(text).toContain('DTEND:20260702T000000Z');
    expect(text.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(foldIcs('é'.repeat(100)).replace(/\r\n /g, '')).toBe('é'.repeat(100));
  });
  it('strips control characters, names the calendar and asks for hourly refreshes', () => {
    const text = serializeCalendar(
      [{ uid: 'a', title: 'A\u0000B\u0007C\tD\u007F', description: '', date: '2026-12-31' }],
      'Inkadra · Studio, Roma',
    );
    expect(text).toContain('SUMMARY:ABC\tD\r\n');
    expect(text).toContain('X-WR-CALNAME:Inkadra · Studio\\, Roma\r\n');
    expect(text).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n');
    expect(text).toContain('X-PUBLISHED-TTL:PT1H\r\n');
  });
  it('never turns a wrap equal to the call time into a 24 hour event', () => {
    const day = { uid: 'd', title: 'D', description: '', date: '2026-07-01', time: '08:00' };
    expect(serializeCalendar([{ ...day, wrap: '08:00' }])).not.toContain('DTEND');
    expect(serializeCalendar([{ ...day, wrap: '18:00' }])).toContain('DTEND:20260701T180000Z');
    expect(serializeCalendar([{ ...day, wrap: null }])).not.toContain('DTEND');
  });
  it('resolves DST gaps and overlaps using RFC 5545 clock semantics', () => {
    expect(localInstant('2026-03-29', '02:30', 'Europe/Rome').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(localInstant('2026-10-25', '02:30', 'Europe/Rome').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
  it('uses project DST rather than server time', () => {
    expect(localInstant('2026-01-01', '08:00', 'Europe/Rome').toISOString()).toBe(
      '2026-01-01T07:00:00.000Z',
    );
  });
});
