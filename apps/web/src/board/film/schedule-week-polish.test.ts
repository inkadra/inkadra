// The week's polish (mockup "Piano riprese, ora e dopo"): the density, the folded column's
// default and the note under "N conflicts".
import type { ScheduleBlock, ShootingDayInput } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { blockBox, DENSITY, sideOpen } from './calendar.ts';
import { conflictNotes, conflictPairs } from './schedule.ts';

const block = (title: string, duration: number, cast: string[], start: string | null = null) =>
  ({
    id: title,
    type: 'shot',
    title,
    start,
    duration,
    shotId: null,
    cast,
    departments: [],
  }) satisfies ScheduleBlock;
const day = (date: string, blocks: ScheduleBlock[]): ShootingDayInput => ({
  date,
  callTime: '08:00',
  wrap: null,
  location: '',
  notes: '',
  blocks,
});

describe('density', () => {
  it('places a block on its minute at both densities', () => {
    expect(DENSITY.compact).toBe(1);
    expect(blockBox(480, 540, DENSITY.compact)).toEqual({ top: 480, height: 60 });
    expect(blockBox(480, 540, DENSITY.comfy)).toEqual({ top: 768, height: 96 });
    // A block of no length still shows.
    expect(blockBox(480, 480, DENSITY.comfy).height).toBe(1);
  });
});

describe('the month and queue column', () => {
  it('opens when frames wait, folds when none do, and the person’s choice wins', () => {
    expect(sideOpen(null, 3)).toBe(true);
    expect(sideOpen(null, 0)).toBe(false);
    expect(sideOpen('open', 0)).toBe(true);
    expect(sideOpen('closed', 3)).toBe(false);
    expect(sideOpen('anything else', 0)).toBe(false);
  });
});

describe('the conflict note', () => {
  const t = (key: string, o?: Record<string, unknown>) =>
    `${key}:${o?.count}:${o?.names}:${o?.time}:${o?.a}:${o?.b}`;
  const title = (b: ScheduleBlock) => b.title;

  it('names who is double-booked, when, and the two blocks, one line each', () => {
    const thursday = day('2027-03-04', [
      block('Allestimento', 60, []),
      block('Inserto tazzina', 50, ['Elena', 'Marco'], '14:00'),
      block('Elena al banco', 70, ['elena', 'Marco'], '14:00'),
      block('Esterno', 60, ['Marco'], '14:50'),
    ]);
    const lines = conflictNotes(conflictPairs([thursday], '2027-03-04'), title, t, 'it');
    expect(lines).toEqual([
      'schedule.conflictNote:2:Elena e Marco:14:00:Inserto tazzina:Elena al banco',
      'schedule.conflictNote:1:Marco:14:50:Elena al banco:Esterno',
    ]);
  });

  it('includes a night shoot that runs into the morning, not other days', () => {
    const night = day('2027-03-03', [block('Notte', 60, ['Elena'], '23:30')]);
    const morning = { ...day('2027-03-04', [block('Alba', 60, ['Elena'])]), callTime: '00:00' };
    const other = day('2027-03-05', [block('Altro', 60, ['Elena'])]);
    const pairs = conflictPairs([night, morning, other], '2027-03-04');
    expect(pairs.map((p) => [p.a.id, p.b.id, p.at])).toEqual([['Notte', 'Alba', 0]]);
  });
});
