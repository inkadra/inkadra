// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { northWay, sunDays, useScheduleDays } from './sun-days.ts';

const get = vi.fn();
vi.mock('../../lib/api.ts', () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

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
    { id: 'd14', date: '2026-03-14', blocks: [block('frame2Axxxxx')] },
    { id: 'd12', date: '2026-03-12', blocks: [block('frame9Axxxxx')] },
    { id: 'd13', date: '2026-03-13', blocks: [block(null)] },
  ];

  it("numbers the days by date and keeps those that shoot the plan's scenes, with their ids", () => {
    expect(sunDays(days, new Set(['frame2Axxxxx']))).toEqual([
      { id: 'd14', n: 3, date: '2026-03-14' },
    ]);
  });

  it('offers every day when the plan serves no scene or none of its shots is scheduled', () => {
    const all = [
      { id: 'd12', n: 1, date: '2026-03-12' },
      { id: 'd13', n: 2, date: '2026-03-13' },
      { id: 'd14', n: 3, date: '2026-03-14' },
    ];
    expect(sunDays(days, new Set())).toEqual(all);
    expect(sunDays(days, new Set(['elsewherexxx']))).toEqual(all);
  });
});

describe('useScheduleDays', () => {
  it('reads the schedule once per board, not on every render (an edit of the board)', async () => {
    get.mockReset();
    get.mockResolvedValue({ items: [], nextCursor: null });
    const host = document.createElement('div');
    const root = createRoot(host);
    const Probe = ({ boardId, edit }: { boardId: string; edit: number }) => {
      useScheduleDays(boardId);
      return createElement('span', null, edit);
    };
    for (let edit = 0; edit < 5; edit++)
      await act(async () => root.render(createElement(Probe, { boardId: 'boardA', edit })));
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(Probe, { boardId: 'boardB', edit: 6 })));
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith('/boards/boardB/schedule');
    await act(async () => root.unmount());
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
