import type { ScheduleBlock, ShootingDayInput } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  blockDetail,
  clockString,
  drawnRange,
  duplicateBlock,
  gapsBeforeFixed,
  insertDrawnBlock,
  layoutLanes,
  monthGrid,
  moveBlock,
  moveBlockToDay,
  moveDay,
  parseDuration,
  placeAnnotation,
  resizeBlock,
  sameScheduleInput,
  shiftBlock,
  weekDates,
  widenedFreeDay,
} from './calendar.ts';
import { clockLabel, scheduleTimes } from './schedule.ts';

const block = (id: string, duration: number, start: string | null = null): ScheduleBlock => ({
  id,
  type: 'shot',
  title: id,
  start,
  duration,
  shotId: null,
  cast: [],
  departments: [],
});
const day = (blocks: ScheduleBlock[], callTime = '07:00'): ShootingDayInput => ({
  date: '2026-11-09',
  callTime,
  wrap: null,
  location: '',
  notes: '',
  blocks,
});
/** "id start–end" for every block, in order. */
const times = (value: ShootingDayInput) =>
  scheduleTimes(value).map(
    ({ block: b, start, end }) => `${b.id} ${clockLabel(start)}–${clockLabel(end)}`,
  );

describe('calendar dates', () => {
  it('shows Monday to Friday, and a weekend day only when something is shot on it', () => {
    expect(weekDates('2026-11-11', new Set())).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ]);
    expect(weekDates('2026-11-15', new Set(['2026-11-15'])).at(-1)).toBe('2026-11-15');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    const grid = monthGrid('2026-11-20');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-10-26');
    expect(grid[6]).toBe('2026-11-01');
    expect(clockString(1460)).toBe('00:20');
  });
});

describe('blocks that overlap', () => {
  it('sit side by side, and only as wide as their cluster needs', () => {
    const lanes = layoutLanes([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
      { id: 'c', start: 60, end: 120 },
      { id: 'd', start: 200, end: 230 },
    ]);
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get('b')).toEqual({ lane: 1, lanes: 2 });
    // c starts when a ends: it takes a's lane back.
    expect(lanes.get('c')).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get('d')).toEqual({ lane: 0, lanes: 1 });
  });

  it('marks the free time a fixed start leaves before its block', () => {
    const value = day([block('a', 60), block('b', 30, '09:30'), block('c', 30)]);
    expect(gapsBeforeFixed(value)).toEqual([{ before: 'b', start: 8 * 60, end: 9 * 60 + 30 }]);
    // A fixed block that starts before the previous one ends leaves no gap: they overlap.
    expect(gapsBeforeFixed(day([block('a', 120), block('b', 30, '08:00')]))).toEqual([]);
  });
});

describe('moving blocks', () => {
  const plan = () => day([block('a', 60), block('b', 45), block('c', 30), block('d', 30)]);

  it('queues a dragged block between two others: the ones after it move down, no gaps', () => {
    // d dropped with its top at 07:50, before the middle of b (08:22).
    expect(times(moveBlock(plan(), 'd', 7 * 60 + 50, false))).toEqual([
      'a 07:00–08:00',
      'd 08:00–08:30',
      'b 08:30–09:15',
      'c 09:15–09:45',
    ]);
    // Dragging a fixed block without Alt queues it again.
    const pinned = day([block('a', 60), block('b', 30, '10:00')]);
    expect(moveBlock(pinned, 'b', 0, false).blocks[0]).toMatchObject({ id: 'b', start: null });
  });

  it('fixes the clock time with Alt: the block stays put and the others queue around it', () => {
    const moved = moveBlock(plan(), 'a', 10 * 60, true);
    expect(times(moved)).toEqual([
      'b 07:00–07:45',
      'c 07:45–08:15',
      'd 08:15–08:45',
      'a 10:00–11:00',
    ]);
    expect(moved.blocks.at(-1)?.start).toBe('10:00');
    // Before the call is not the next morning: it clamps to the call.
    expect(moveBlock(plan(), 'd', 5 * 60, true).blocks[0]).toMatchObject({
      id: 'd',
      start: '07:00',
    });
    // On a night shoot, past midnight is the next morning.
    const night = day([block('a', 60), block('b', 60)], '22:00');
    expect(times(moveBlock(night, 'a', 1440 + 60, true))).toEqual([
      'b 22:00–23:00',
      'a 01:00 (+1)–02:00 (+1)',
    ]);
  });

  it('moves up and down one place with the keys, and resizes within the schema', () => {
    expect(shiftBlock(plan(), 'b', -1).blocks.map((b) => b.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(shiftBlock(plan(), 'a', -1)).toEqual(plan());
    // A fixed block stored last but shown in the middle moves past its neighbours in time.
    const mixed = day([block('a', 60), block('b', 30, '14:00'), block('c', 30, '11:00')]);
    expect(shiftBlock(mixed, 'c', 1).blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(shiftBlock(mixed, 'c', -1).blocks.map((b) => b.id)).toEqual(['c', 'a', 'b']);
    expect(shiftBlock(mixed, 'b', 1)).toEqual(mixed);
    expect(times(resizeBlock(plan(), 'a', 35)).slice(0, 2)).toEqual([
      'a 07:00–07:35',
      'b 07:35–08:20',
    ]);
    expect(resizeBlock(plan(), 'a', 0).blocks[0]?.duration).toBe(1);
    expect(resizeBlock(plan(), 'a', 5000).blocks[0]?.duration).toBe(1440);
  });

  it('moves to another day: the day it leaves closes the gap, the other makes room', () => {
    const other = { ...day([block('x', 60)], '08:00'), date: '2026-11-10' };
    const { from, to } = moveBlockToDay(plan(), other, 'b', 8 * 60, false);
    expect(times(from)).toEqual(['a 07:00–08:00', 'c 08:00–08:30', 'd 08:30–09:00']);
    expect(times(to)).toEqual(['b 08:00–08:45', 'x 08:45–09:45']);
    expect(moveBlockToDay(plan(), other, 'nope', 0, false).to).toBe(other);
  });

  it('duplicates right after the original, with a new id', () => {
    const { day: copy, id } = duplicateBlock(plan(), 'a');
    expect(copy.blocks).toHaveLength(5);
    expect(copy.blocks[1]).toMatchObject({ id, title: 'a', start: null });
    expect(id).not.toBe('a');
  });
});

describe('drawing a new block on empty time (phase 2)', () => {
  const plan = () => day([block('a', 60), block('b', 30, '10:00'), block('c', 30)]);
  const drawn = (start: number, duration = 30) =>
    insertDrawnBlock(plan(), block('n', duration), start);

  it('snaps the drawn time to 5 minutes, in either direction, at least one step long', () => {
    expect(drawnRange(16 * 60 + 53, 17 * 60 + 27)).toEqual({
      start: 16 * 60 + 55,
      end: 17 * 60 + 25,
    });
    expect(drawnRange(17 * 60 + 27, 16 * 60 + 53)).toEqual({
      start: 16 * 60 + 55,
      end: 17 * 60 + 25,
    });
    expect(drawnRange(600, 601)).toEqual({ start: 600, end: 605 });
    expect(drawnRange(-30, 20)).toEqual({ start: 0, end: 20 });
    expect(drawnRange(0, 5000)).toEqual({ start: 0, end: 1440 });
  });

  it('keeps the drawn time in a gap before a fixed block and after the end of the day', () => {
    // a ends at 08:00, b is fixed at 10:00: 08:30 is free time.
    expect(times(drawn(8 * 60 + 30))).toEqual([
      'a 07:00–08:00',
      'n 08:30–09:00',
      'b 10:00–10:30',
      'c 10:30–11:00',
    ]);
    expect(drawn(8 * 60 + 30).blocks[1]).toMatchObject({ id: 'n', start: '08:30' });
    expect(times(drawn(16 * 60 + 55)).at(-1)).toBe('n 16:55–17:25');
  });

  it('queues up when drawn over other blocks, at the call or where the queue puts it anyway', () => {
    // Over the top half of a: before it, and a moves down.
    expect(times(drawn(7 * 60 + 10)).slice(0, 2)).toEqual(['n 07:00–07:30', 'a 07:30–08:30']);
    expect(drawn(7 * 60 + 10).blocks[0]?.start).toBeNull();
    // Right after the last block: queued, so it follows c if c changes.
    expect(drawn(11 * 60).blocks.at(-1)).toMatchObject({ id: 'n', start: null });
    // Before the call: queued first, as a drop before the call is.
    expect(drawn(5 * 60).blocks[0]).toMatchObject({ id: 'n', start: null });
    // An empty day starts with it at the call.
    expect(insertDrawnBlock(day([]), block('n', 30), 7 * 60).blocks).toEqual([block('n', 30)]);
  });
});

describe('moving a whole day (phase 3)', () => {
  const entry = (id: string, date: string) => ({
    day: { id },
    draft: { ...day([block(id, 30)]), date },
  });
  const week = [entry('mon', '2026-11-09'), entry('wed', '2026-11-11'), entry('thu', '2026-11-12')];

  it('moves a day with its blocks to a free date', () => {
    const changes = moveDay(week, 'mon', '2026-11-10');
    expect(changes.map((c) => [c.entry.day.id, c.next.date])).toEqual([['mon', '2026-11-10']]);
    expect(changes[0]?.next.blocks).toEqual(week[0]?.draft.blocks);
  });

  it('swaps two days when the date is taken, and does nothing on its own date', () => {
    const changes = moveDay(week, 'mon', '2026-11-11');
    expect(changes.map((c) => [c.entry.day.id, c.next.date])).toEqual([
      ['mon', '2026-11-11'],
      ['wed', '2026-11-09'],
    ]);
    expect(moveDay(week, 'mon', '2026-11-09')).toEqual([]);
    expect(moveDay(week, 'nope', '2026-11-10')).toEqual([]);
  });
});

describe('duration text', () => {
  it.each([
    ['1h', 60],
    ['1h 30', 90],
    ['45', 45],
    ['45 min', 45],
    ['90', 90],
    ['24h', 1440],
    ['1', 1],
  ])('parses %s', (text, minutes) => {
    expect(parseDuration(String(text))).toBe(minutes);
  });
  it.each(['', '0', '-1', '1441', '24h 1', '1.5h', '45 minutes', '1h junk', 'Infinity'])(
    'rejects %s',
    (text) => {
      expect(parseDuration(text)).toBeNull();
    },
  );
});

it('clamps fixed drags to the clock cycle represented by the day contract', () => {
  const original = day([block('a', 30)]);
  const moved = moveBlock(original, 'a', 3000, true);
  expect(scheduleTimes(moved)[0]?.start).toBe(7 * 60 + 1439);
});

it('keeps drag notes beside cards only when they fit without covering another card', () => {
  const card = { left: 100, top: 80, width: 100, height: 40 };
  const bounds = { left: 0, top: 0, width: 400, height: 200 };
  const size = { width: 80, height: 24 };
  expect(placeAnnotation(card, size, bounds, [card])).toEqual({ left: 206, top: 80 });
  const right = { left: 200, top: 80, width: 200, height: 40 };
  expect(placeAnnotation(card, size, bounds, [card, right])).toEqual({ left: 14, top: 80 });
  expect(
    placeAnnotation(card, size, { ...bounds, left: 100, width: 300 }, [card, right]),
  ).toBeNull();
  expect(
    placeAnnotation(card, size, bounds, [
      card,
      right,
      { left: 0, top: 0, width: 100, height: 200 },
    ]),
  ).toBeNull();
  expect(placeAnnotation(card, { width: 500, height: 24 }, bounds, [])).toBeNull();
});

it('compares JSONB drafts independently of object key order, preserving array order', () => {
  const input = day([block('a', 30), block('b', 45)]);
  const reversed = JSON.parse(
    JSON.stringify(input, (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  expect(sameScheduleInput(input, reversed)).toBe(true);
  expect(sameScheduleInput(input, { ...input, blocks: [...input.blocks].reverse() })).toBe(false);
  expect(sameScheduleInput(input, null)).toBe(false);
  // A day saved by the team comes back with an empty call list (decision 0092).
  expect(sameScheduleInput(input, { ...input, calls: [] })).toBe(true);
  const call = { crewMemberId: '00000000-0000-4000-8000-000000000001', call: null, pickup: 'Bar' };
  expect(sameScheduleInput(input, { ...input, calls: [call] })).toBe(false);
});

it('shows on each card what the approved mockup shows at its height', () => {
  // The week: "cast · duration" from 60 px, the title on two lines from 62 px, no frame.
  expect(blockDetail('week', 59, false, 1)).toMatchObject({ meta: false, wrap: false });
  expect(blockDetail('week', 60, false, 1)).toMatchObject({ meta: true, type: false, wrap: false });
  expect(blockDetail('week', 62, false, 1)).toMatchObject({ wrap: true, picture: false });
  // The day view: the line, led by the type, from 52 px, and the frame from 44 px.
  expect(blockDetail('day', 51, false, 1)).toMatchObject({ meta: false, picture: true });
  expect(blockDetail('day', 52, false, 1)).toMatchObject({ meta: true, type: true });
  expect(blockDetail('day', 43, false, 1).picture).toBe(false);
  // A phone: the line from 56 px, one line of title, no frame.
  expect(blockDetail('day', 55, true, 1).meta).toBe(false);
  expect(blockDetail('day', 90, true, 1)).toMatchObject({
    meta: true,
    type: false,
    wrap: false,
    picture: false,
  });
  // Side by side, a card shows only its start time.
  expect(blockDetail('week', 90, false, 1).range).toBe(true);
  expect(blockDetail('week', 90, false, 2).range).toBe(false);
});

describe('widenedFreeDay', () => {
  const columns = [
    { date: '2026-03-01', entry: { day: { id: 'd1' } } },
    { date: '2026-03-02', entry: null },
    { date: '2026-03-03', entry: null },
  ];
  it('widens the free day a block, a queued shot or a whole day is dragged over', () => {
    expect(widenedFreeDay('week', columns, ['2026-03-02', null, null])).toBe('2026-03-02');
    expect(widenedFreeDay('week', columns, [null, '2026-03-03', null])).toBe('2026-03-03');
    expect(widenedFreeDay('week', columns, [null, undefined, '2026-03-02'])).toBe('2026-03-02');
  });
  it('leaves shooting days, other dates and the Day view alone', () => {
    expect(widenedFreeDay('week', columns, ['d1', null, '2026-03-01'])).toBeNull();
    expect(widenedFreeDay('week', columns, ['2026-04-01', null, null])).toBeNull();
    expect(widenedFreeDay('week', columns, [null, null, null])).toBeNull();
    expect(widenedFreeDay('day', columns, ['2026-03-02', null, null])).toBeNull();
  });
});
