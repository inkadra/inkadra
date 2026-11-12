// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { northWay, sunDays } from './sun-days.ts';

const block = (shotId: string | null) => ({
  id: `b${shotId ?? 'none'}xxxxxxx`,
  type: 'shot' as const,
  title: '',
  start: null,
  duration: 30,
  shotId,
  cast: [],
  departments: [],
});

describe('sunDays', () => {
  const days = [
    { date: '2026-03-14', blocks: [block('frame2Axxxxx')] },
    { date: '2026-03-12', blocks: [block('frame9Axxxxx')] },
    { date: '2026-03-13', blocks: [block(null)] },
  ];

  it("numbers the days by date and keeps those that shoot the plan's scenes", () => {
    expect(sunDays(days, new Set(['frame2Axxxxx']))).toEqual([{ n: 3, date: '2026-03-14' }]);
  });

  it('offers every day when the plan serves no scene or none of its shots is scheduled', () => {
    const all = [
      { n: 1, date: '2026-03-12' },
      { n: 2, date: '2026-03-13' },
      { n: 3, date: '2026-03-14' },
    ];
    expect(sunDays(days, new Set())).toEqual(all);
    expect(sunDays(days, new Set(['elsewherexxx']))).toEqual(all);
  });
});

describe('northWay', () => {
  it('names the nearest of eight ways, turning past a full circle', () => {
    expect(northWay(0)).toBe('up');
    expect(northWay(20)).toBe('up');
    expect(northWay(90)).toBe('right');
    expect(northWay(200)).toBe('down');
    expect(northWay(337)).toBe('upLeft');
    expect(northWay(359)).toBe('up');
    expect(northWay(-90)).toBe('left');
  });
});
