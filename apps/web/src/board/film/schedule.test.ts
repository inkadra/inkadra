import type { ShootingDayInput } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { resolveDroppedShot } from './ScheduleView.tsx';
import {
  castConflicts,
  clockLabel,
  newScheduleBlock,
  scheduleTimes,
  textList,
} from './schedule.ts';

const day = (): ShootingDayInput => ({
  date: '2026-11-02',
  callTime: '23:30',
  wrap: null,
  location: '',
  notes: '',
  blocks: [],
});
describe('schedule planning', () => {
  it('computes consecutive estimates across midnight, with explicit next-day starts', () => {
    const value = day();
    value.blocks = [
      { ...newScheduleBlock('setup'), duration: 60 },
      { ...newScheduleBlock('shot'), duration: 45, start: '01:00' },
      newScheduleBlock('break'),
    ];
    expect(
      scheduleTimes(value).map(({ start, end }) => [clockLabel(start), clockLabel(end)]),
    ).toEqual([
      ['23:30', '00:30 (+1)'],
      ['01:00 (+1)', '01:45 (+1)'],
      ['01:45 (+1)', '02:15 (+1)'],
    ]);
  });
  it('warns about cast overlaps across days, ignoring case and adjacent boundaries', () => {
    const first = day();
    const a = { ...newScheduleBlock('shot'), duration: 90, cast: [' Anna '] };
    first.blocks = [a];
    const second = { ...day(), date: '2026-11-03', callTime: '00:00' };
    const b = { ...newScheduleBlock('shot'), cast: ['anna'] };
    const c = { ...newScheduleBlock('shot'), start: '01:00', cast: ['ANNA'] };
    second.blocks = [b, c];
    expect(castConflicts([first, second])).toEqual(new Set([a.id, b.id]));
    expect(textList('Anna, Luca, Anna, ')).toEqual(['Anna', 'Luca']);
  });
  it('accepts only current-board shot drops and refuses read-only or malformed drops', () => {
    const data = JSON.stringify({ boardId: 'board', shotId: 'shot' });
    expect(resolveDroppedShot(data, 'board', ['shot'], false)).toBe('shot');
    expect(resolveDroppedShot(data, 'other', ['shot'], false)).toBeNull();
    expect(resolveDroppedShot(data, 'board', [], false)).toBeNull();
    expect(resolveDroppedShot(data, 'board', ['shot'], true)).toBeNull();
    expect(resolveDroppedShot('{', 'board', ['shot'], false)).toBeNull();
  });
});
