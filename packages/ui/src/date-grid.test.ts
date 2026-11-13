// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { addMonths, calendarKey, clampDate, dayState, monthGrid } from './date-grid.ts';

describe('date grid', () => {
  it('shows six weeks from the Monday before the first', () => {
    const grid = monthGrid('2026-11-13');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-10-26');
    expect(grid[6]).toBe('2026-11-01');
    expect(grid[41]).toBe('2026-12-06');
  });

  it('keeps a month step inside the shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-11-13', -12)).toBe('2025-11-13');
  });

  it('moves the cursor with the keys', () => {
    const at = '2026-11-13'; // a Friday
    expect(calendarKey(at, 'ArrowLeft')).toBe('2026-11-12');
    expect(calendarKey(at, 'ArrowRight')).toBe('2026-11-14');
    expect(calendarKey(at, 'ArrowUp')).toBe('2026-11-06');
    expect(calendarKey(at, 'ArrowDown')).toBe('2026-11-20');
    expect(calendarKey(at, 'PageUp')).toBe('2026-10-13');
    expect(calendarKey(at, 'PageDown')).toBe('2026-12-13');
    expect(calendarKey(at, 'Home')).toBe('2026-11-09');
    expect(calendarKey(at, 'End')).toBe('2026-11-15');
    expect(calendarKey(at, 'a')).toBeNull();
  });

  it('clamps a date into its bounds', () => {
    expect(clampDate('2026-11-01', '2026-11-10')).toBe('2026-11-10');
    expect(clampDate('2026-12-01', undefined, '2026-11-30')).toBe('2026-11-30');
    expect(clampDate('2026-11-15', '2026-11-10', '2026-11-30')).toBe('2026-11-15');
  });

  it('draws a range from its start to the value', () => {
    const c = { month: '2026-11-01', today: '2026-11-13', value: '2026-11-20', rangeStart: '2026-11-16', min: '2026-11-16' };
    expect(dayState('2026-11-16', c)).toMatchObject({ rangeStart: true, inRange: false, selected: false });
    expect(dayState('2026-11-18', c)).toMatchObject({ inRange: true, rangeStart: false, rangeEnd: false });
    // The end is the selected day, joined to the band.
    expect(dayState('2026-11-20', c)).toMatchObject({ selected: true, rangeEnd: true, inRange: false });
    expect(dayState('2026-11-21', c)).toMatchObject({ inRange: false, rangeEnd: false });
    expect(dayState('2026-11-13', c)).toMatchObject({ today: true, disabled: true });
    expect(dayState('2026-10-31', c).outside).toBe(true);
  });

  it('keeps a single day whole when there is no range', () => {
    const lone = { month: '2026-11-01', today: '2026-11-13', value: '2026-11-16', rangeStart: '2026-11-16' };
    expect(dayState('2026-11-16', lone)).toMatchObject({ selected: true, rangeStart: false, rangeEnd: false });
    const before = { ...lone, value: '2026-11-10' };
    expect(dayState('2026-11-10', before)).toMatchObject({ selected: true, rangeEnd: false });
    expect(dayState('2026-11-12', before).inRange).toBe(false);
  });

  it('disables days outside the bounds', () => {
    const c = { month: '2026-11-01', today: '2026-11-13', min: '2026-11-05', max: '2026-11-25' };
    expect(dayState('2026-11-04', c).disabled).toBe(true);
    expect(dayState('2026-11-05', c).disabled).toBe(false);
    expect(dayState('2026-11-26', c).disabled).toBe(true);
  });
});
