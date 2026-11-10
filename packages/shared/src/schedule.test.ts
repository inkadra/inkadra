// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { DayCall, ShootingDayInput } from './schedule.ts';

const block = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'shot',
  title: 'Arrival',
  start: null,
  duration: 30,
  shotId: null,
  cast: ['Mara'],
  departments: [],
} as const;
const day = {
  date: '2026-11-19',
  callTime: '07:30',
  wrap: null,
  location: '',
  notes: '',
  blocks: [block],
};
const call = (n: number) => ({
  crewMemberId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  call: null,
  pickup: null,
});

describe('day calls and block notes (decision 0092)', () => {
  it('reads a day saved before calls and notes as it was', () => {
    const parsed = ShootingDayInput.parse(day);
    expect(parsed).toEqual(day);
    expect(parsed.calls).toBeUndefined();
    expect(parsed.blocks[0]?.notes).toBeUndefined();
  });
  it('keeps calls and notes, with optional absence', () => {
    const calls = [
      { ...call(2), call: '07:00', pickup: 'Hotel 06:45' },
      { ...call(3), absent: true },
      { ...call(4), absent: false },
    ];
    const parsed = ShootingDayInput.parse({
      ...day,
      blocks: [{ ...block, notes: 'LIGHTS ON' }],
      calls,
    });
    expect(parsed.calls).toEqual(calls);
    expect(parsed.blocks[0]?.notes).toBe('LIGHTS ON');
  });
  it('bounds and validates them', () => {
    expect(DayCall.safeParse({ ...call(2), call: '7:00' }).success).toBe(false);
    expect(DayCall.safeParse({ ...call(2), pickup: 'x'.repeat(1001) }).success).toBe(false);
    expect(DayCall.safeParse({ ...call(2), phone: '1' }).success).toBe(false);
    expect(ShootingDayInput.safeParse({ ...day, calls: [call(2), call(2)] }).success).toBe(false);
    expect(
      ShootingDayInput.safeParse({ ...day, calls: Array.from({ length: 501 }, (_, i) => call(i)) })
        .success,
    ).toBe(false);
    expect(
      ShootingDayInput.safeParse({ ...day, blocks: [{ ...block, notes: 'x'.repeat(2001) }] })
        .success,
    ).toBe(false);
  });
});
