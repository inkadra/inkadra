// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  byDepartment,
  type CallSheetCard,
  castCalls,
  castConflicts,
  castKeysOf,
  dayCrew,
  dialNumber,
  isCast,
  plannedWrap,
} from './call-sheet.ts';
import type { CrewMember } from './crew.ts';
import type { ScheduleBlock, ShootingDayInput } from './schedule.ts';

let ids = 0;
const block = (patch: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  id: `block-${++ids}`,
  type: 'shot',
  title: '',
  start: null,
  duration: 30,
  shotId: null,
  cast: [],
  departments: [],
  ...patch,
});
const day = (patch: Partial<ShootingDayInput> = {}): ShootingDayInput => ({
  date: '2026-11-19',
  callTime: '07:00',
  wrap: null,
  location: '',
  notes: '',
  blocks: [],
  ...patch,
});
const member = (patch: Partial<CrewMember> = {}): CrewMember => ({
  id: `member-${++ids}`,
  projectId: 'project',
  name: '',
  role: '',
  department: '',
  phone: '',
  email: '',
  pickup: '',
  notes: '',
  userId: null,
  character: null,
  onSetContact: false,
  position: 0,
  revision: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...patch,
});

describe('castCalls', () => {
  it('is empty without blocks or names', () => {
    expect(castCalls(day())).toEqual([]);
    expect(castCalls(day({ blocks: [block({ cast: ['  '] })] }))).toEqual([]);
  });

  it('keeps the earliest appearance of each name, whatever its case', () => {
    const value = day({
      blocks: [
        block({ duration: 60, cast: ['Mara '] }),
        block({ cast: ['mara', 'Luca'] }),
        block({ start: '06:30', cast: ['LUCA'] }),
      ],
    });
    // 06:30 is before the 07:00 call: it is the next morning.
    expect(castCalls(value)).toEqual([
      { name: 'Mara', start: 7 * 60 },
      { name: 'Luca', start: 8 * 60 },
    ]);
  });

  it('orders names that start together by name', () => {
    const value = day({ blocks: [block({ cast: ['Zoe', 'Anna'] })] });
    expect(castCalls(value).map((call) => call.name)).toEqual(['Anna', 'Zoe']);
  });
});

describe('plannedWrap', () => {
  it('is null without a wrap or blocks', () => {
    expect(plannedWrap(day())).toBeNull();
  });

  it('takes the saved wrap, the next morning when it is before the call', () => {
    expect(plannedWrap(day({ wrap: '19:00' }))).toBe(19 * 60);
    expect(plannedWrap(day({ callTime: '18:00', wrap: '02:00' }))).toBe(26 * 60);
    expect(plannedWrap(day({ wrap: '07:00' }))).toBe(7 * 60);
  });

  it('else ends with the last block, past midnight too', () => {
    const value = day({ callTime: '22:00', blocks: [block({ duration: 90 }), block()] });
    expect(plannedWrap(value)).toBe(24 * 60);
  });
});

describe('castConflicts', () => {
  it('finds nothing without days or shared names', () => {
    expect(castConflicts([])).toEqual(new Set());
    const value = day({ blocks: [block({ cast: ['Mara'] }), block({ cast: ['Luca'] })] });
    expect(castConflicts([value])).toEqual(new Set());
  });

  it('marks overlapping blocks that share a name, without case', () => {
    const a = block({ duration: 60, cast: ['Mara'] });
    const b = block({ start: '07:30', cast: [' mara '] });
    const c = block({ start: '08:00', cast: ['Mara'] });
    expect(castConflicts([day({ blocks: [a, b, c] })])).toEqual(new Set([a.id, b.id]));
  });

  it('compares a night block with the next date, on the wall clock across a DST change', () => {
    // Europe moves its clocks on 2026-03-29; days have no time zone, so nothing shifts.
    const night = block({ duration: 120, cast: ['Mara'] });
    const morning = block({ cast: ['Mara'] });
    const first = day({ date: '2026-03-28', callTime: '23:30', blocks: [night] });
    const second = day({ date: '2026-03-29', callTime: '01:00', blocks: [morning] });
    expect(castConflicts([first, second])).toEqual(new Set([night.id, morning.id]));
    const later = day({
      date: '2026-03-29',
      callTime: '01:30',
      blocks: [block({ cast: ['Mara'] })],
    });
    expect(castConflicts([first, later])).toEqual(new Set());
  });
});

describe('who is called on a day', () => {
  it('tells cast rows by department or role', () => {
    expect(isCast(member({ department: ' Cast ' }))).toBe(true);
    expect(isCast(member({ department: 'Actors', role: 'CAST' }))).toBe(true);
    expect(isCast(member({ department: 'Camera' }))).toBe(false);
  });

  it('gives a Cast role to the first row by position, only when no row has that name', () => {
    const second = member({ department: 'Cast', role: 'Guard', position: 2 });
    const first = member({ department: 'Cast', role: 'guard', position: 1 });
    const named = member({ name: 'Mara', department: 'Cast', role: 'Mara' });
    const other = member({ department: 'Cast', role: 'Mara', position: 0 });
    const keys = castKeysOf([second, first, named, other]);
    expect([...(keys.get(first.id) ?? [])]).toEqual(['guard']);
    expect([...(keys.get(second.id) ?? [])]).toEqual([]);
    expect([...(keys.get(other.id) ?? [])]).toEqual([]);
    expect([...(keys.get(named.id) ?? [])]).toEqual(['mara']);
  });

  it('calls crew always, cast when named, and keeps the exceptions of the day', () => {
    const camera = member({ name: 'Piero', department: 'Camera', pickup: 'Station' });
    const actor = member({ name: 'Mara', department: 'Cast' });
    const idle = member({ name: 'Luca', department: 'Cast' });
    const linked = member({
      name: 'Giulia',
      character: { boardId: 'board', elementId: 'card' },
    });
    const first = block({ start: '08:00', cast: ['anna'] });
    const value = day({
      blocks: [block({ cast: ['Mara'] }), first],
      calls: [{ crewMemberId: camera.id, call: '06:00', pickup: 'Hotel' }],
    });
    const elements = new Map<string, CallSheetCard>([
      ['card', { type: 'character', name: 'Anna' }],
    ]);
    const [c, a, i, l] = dayCrew(value, [camera, actor, idle, linked], elements);
    expect(c).toMatchObject({
      cast: false,
      called: true,
      call: 6 * 60,
      ownCall: '06:00',
      pickup: 'Hotel',
      ownPickup: 'Hotel',
      scene: null,
    });
    expect(a).toMatchObject({
      cast: true,
      usual: true,
      called: true,
      call: 7 * 60,
      names: ['Mara'],
    });
    expect(i).toMatchObject({ cast: true, usual: false, called: false, names: [] });
    expect(l).toMatchObject({
      cast: true,
      called: true,
      names: ['anna'],
      scene: { start: 8 * 60, blockId: first.id },
    });
  });

  it('follows a saved absence or call against the default', () => {
    const camera = member({ department: 'Camera' });
    const actor = member({ department: 'Cast' });
    const value = day({
      calls: [
        { crewMemberId: camera.id, call: null, pickup: null, absent: true },
        { crewMemberId: actor.id, call: null, pickup: null, absent: false },
      ],
    });
    const [c, a] = dayCrew(value, [camera, actor]);
    expect(c).toMatchObject({ usual: true, called: false });
    expect(a).toMatchObject({ usual: false, called: true });
  });

  it('groups by trimmed department in roster order', () => {
    const entries = dayCrew(day(), [
      member({ name: 'A', department: 'Camera' }),
      member({ name: 'B', department: 'Sound' }),
      member({ name: 'C', department: 'Camera ' }),
    ]);
    expect(
      byDepartment(entries).map((g) => [g.department, g.people.map((p) => p.member.name)]),
    ).toEqual([
      ['Camera', ['A', 'C']],
      ['Sound', ['B']],
    ]);
    expect(byDepartment([])).toEqual([]);
  });
});

describe('dialNumber', () => {
  it('takes the digits and a leading + of the first number', () => {
    expect(dialNumber('Agenzia Nord · +39 02 000 0001')).toBe('+39020000001');
    expect(dialNumber('(02) 123-4567 or 333 1234567')).toBe('021234567');
  });

  it('is null without a number long enough to dial', () => {
    expect(dialNumber('')).toBeNull();
    expect(dialNumber('ext. 1234')).toBeNull();
  });
});
