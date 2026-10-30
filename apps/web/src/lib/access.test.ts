import { describe, expect, it } from 'vitest';
import {
  canCreateProjects,
  dateInputValue,
  endOfDay,
  expiresSoon,
  expiryBounds,
  expiryDate,
} from './access.ts';

describe('access helpers (decision 0041)', () => {
  it('lets people create projects unless the server says otherwise', () => {
    expect(canCreateProjects(null)).toBe(true);
    expect(canCreateProjects({})).toBe(true);
    expect(canCreateProjects({ canCreateProjects: true })).toBe(true);
    expect(canCreateProjects({ canCreateProjects: false })).toBe(false);
  });

  it('marks end dates within three days as soon', () => {
    const now = new Date('2026-12-10T12:00:00Z').getTime();
    expect(expiresSoon('2026-12-13T11:00:00Z', now)).toBe(true);
    expect(expiresSoon('2026-12-14T12:00:01Z', now)).toBe(false);
  });

  it('formats the date short, with the year only when it differs', () => {
    const now = new Date(2026, 9, 30);
    expect(expiryDate(new Date(2026, 11, 15, 23, 59).toISOString(), 'en-GB', now)).toBe('15 Dec');
    expect(expiryDate(new Date(2027, 0, 5).toISOString(), 'en-GB', now)).toBe('5 Jan 2027');
  });

  it('ends access at the end of the chosen local day', () => {
    const iso = endOfDay('2026-12-15');
    expect(iso).not.toBeNull();
    const at = new Date(iso ?? '');
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours()]).toEqual([
      2026, 11, 15, 23,
    ]);
    expect(dateInputValue(at)).toBe('2026-12-15');
    expect(endOfDay('15/12/2026')).toBeNull();
  });

  it('offers tomorrow to a year ahead', () => {
    expect(expiryBounds(new Date(2026, 9, 30, 10))).toEqual({
      min: '2026-10-31',
      max: '2027-10-30',
    });
  });
});
