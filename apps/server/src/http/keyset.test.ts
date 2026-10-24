import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, pageOf } from './keyset.ts';

const id = '00000000-0000-4000-8000-000000000001';
describe('keyset cursors', () => {
  it('preserves microseconds and accepts timestamps emitted by PostgreSQL', () => {
    for (const at of [
      '2026-10-24 08:00:00.000001+00',
      '2024-02-29T12:00:00.123456Z',
      '2026-10-24 08:00:00+05:30',
    ]) {
      expect(decodeCursor(encodeCursor({ at, id }))).toEqual({ at, id });
    }
    expect(decodeCursor(undefined)).toBeNull();
    expect(
      pageOf(
        [
          { at: '2026-10-24 08:00:00.000001+00', id },
          { at: '', id },
        ],
        1,
      ).nextCursor,
    ).toBe(encodeCursor({ at: '2026-10-24 08:00:00.000001+00', id }));
  });
  it('rejects invalid calendar data as a client error', () => {
    for (const at of [
      '2026-99-01 00:00:00+00',
      '2026-02-30 00:00:00+00',
      '2025-02-29 00:00:00+00',
      '2026-01-01 25:00:00+00',
      '2026-01-01 00:99:00+00',
      '0000-01-01 00:00:00+00',
      'infinity',
      '2026-01-01 00:00:00+99',
    ]) {
      expect(() => decodeCursor(encodeCursor({ at, id }))).toThrow('Invalid cursor.');
    }
    for (const value of [
      'not-json',
      '[]',
      JSON.stringify(['2026-01-01 00:00:00+00', 'not-uuid']),
    ]) {
      expect(() => decodeCursor(Buffer.from(value).toString('base64url'))).toThrow(
        'Invalid cursor.',
      );
    }
  });
});
