import { describe, expect, it } from 'vitest';
import { formatClock, formatDateTime } from './datetime.ts';

const at = new Date(2026, 10, 14, 7, 30);
const medium = { dateStyle: 'medium', timeStyle: 'short' } as const;

describe('formatDateTime', () => {
  it('follows the language when nothing is chosen', () => {
    expect(formatDateTime(at, medium, { dateFormat: 'auto', timeFormat: 'auto' }, 'it')).toBe(
      new Intl.DateTimeFormat('it', medium).format(at),
    );
  });

  it('writes the chosen numeric date and time format', () => {
    const f = (dateFormat: 'dmy' | 'mdy' | 'ymd', timeFormat: '24h' | '12h') =>
      formatDateTime(at, medium, { dateFormat, timeFormat }, 'en');
    expect(f('dmy', '24h')).toBe('14/11/2026 07:30');
    expect(f('mdy', '12h')).toMatch(/^11\/14\/2026 7:30\sAM$/);
    expect(f('ymd', '24h')).toBe('2026-11-14 07:30');
    expect(
      formatDateTime(
        at,
        { day: 'numeric', month: 'short' },
        { dateFormat: 'ymd', timeFormat: 'auto' },
      ),
    ).toBe('2026-11-14');
  });

  it('keeps dates written in words in the language', () => {
    const long = { dateStyle: 'full' } as const;
    expect(formatDateTime(at, long, { dateFormat: 'dmy', timeFormat: '24h' }, 'it')).toBe(
      new Intl.DateTimeFormat('it', long).format(at),
    );
  });
});

describe('formatClock', () => {
  it('turns call times into 12 h only when chosen', () => {
    expect(formatClock('07:30', { dateFormat: 'auto', timeFormat: '12h' })).toBe('7:30 AM');
    expect(formatClock('00:05', { dateFormat: 'auto', timeFormat: '12h' })).toBe('12:05 AM');
    expect(formatClock('18:00', { dateFormat: 'auto', timeFormat: '12h' })).toBe('6:00 PM');
    expect(formatClock('18:00', { dateFormat: 'auto', timeFormat: '24h' })).toBe('18:00');
    expect(formatClock('', { dateFormat: 'auto', timeFormat: '12h' })).toBe('');
  });
});

describe('formatDateTime language', () => {
  it('keeps a language with its region instead of the browser variant', () => {
    const day = { day: 'numeric', month: 'short' } as const;
    expect(formatDateTime(at, day, { dateFormat: 'auto', timeFormat: 'auto' }, 'en-GB')).toBe(
      new Intl.DateTimeFormat('en-GB', day).format(at),
    );
  });
});
