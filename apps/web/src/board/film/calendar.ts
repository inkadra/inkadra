import type { ScheduleBlock, ShootingDayInput } from '@inkadra/shared';
import { clockMinutes, scheduleTimes } from './schedule.ts';

/**
 * The shooting schedule as a calendar (decision 0089): pure helpers for the grid, the layout of
 * blocks that overlap and the edits a drag, a resize or a key makes. Blocks always queue up: a
 * block without a start follows the one before it, so moving or removing one closes the gap.
 * A fixed start (the pin) is the only way to leave room before a block.
 */

/** What a shot from the queue carries while it is dragged. */
export const SHOT_DRAG_TYPE = 'application/x-inkadra-schedule-shot';

/** Grid scale: one pixel per minute. */
export const MINUTE_PX = 1;
/** Drags and resizes snap to five minutes; Shift gives single minutes. */
export const SNAP = 5;

export const snap = (minutes: number, step = SNAP) => Math.round(minutes / step) * step;

/** "HH:MM" for minutes from the shooting date, the next day folded back as the schema wants. */
export function clockString(minutes: number): string {
  const local = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(local % 60).padStart(2, '0')}`;
}

/** Calendar dates, as YYYY-MM-DD strings on UTC midnight: days carry no time zone (0022). */
export function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) return date;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}
/** Monday of the week of `date`. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}
/**
 * The columns of a week: Monday to Friday, and Saturday or Sunday only when something is shot on
 * them, so a working week is not squeezed by two empty columns.
 */
export function weekDates(date: string, shooting: ReadonlySet<string>): string[] {
  const monday = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter(
    (d, i) => i < 5 || shooting.has(d),
  );
}
/** The six weeks of a month grid, Monday first, with the days of the next and previous months. */
export function monthGrid(month: string): string[] {
  const first = `${month.slice(0, 7)}-01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export const localDate = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export interface Slot {
  id: string;
  start: number;
  end: number;
}
/**
 * Side-by-side lanes for blocks that overlap, as a calendar draws them: each cluster of
 * overlapping blocks shares its width, a block takes the first free lane.
 */
export function layoutLanes(slots: readonly Slot[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...slots].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = new Map<string, { lane: number; lanes: number }>();
  let cluster: Array<{ id: string; lane: number }> = [];
  let ends: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const item of cluster) out.set(item.id, { lane: item.lane, lanes: ends.length });
    cluster = [];
    ends = [];
  };
  for (const slot of sorted) {
    if (slot.start >= clusterEnd) close();
    let lane = ends.findIndex((end) => end <= slot.start);
    if (lane === -1) lane = ends.length;
    ends[lane] = slot.end;
    cluster.push({ id: slot.id, lane });
    clusterEnd = Math.max(clusterEnd, slot.end);
  }
  close();
  return out;
}

/** Free time a fixed start leaves before its block, as "1h 30 libera". */
export function gapsBeforeFixed(day: Pick<ShootingDayInput, 'callTime' | 'blocks'>) {
  const gaps: Array<{ before: string; start: number; end: number }> = [];
  let previous = clockMinutes(day.callTime);
  for (const { block, start, end } of scheduleTimes(day)) {
    if (block.start !== null && start > previous)
      gaps.push({ before: block.id, start: previous, end: start });
    previous = Math.max(previous, end);
  }
  return gaps;
}

/**
 * Where a block whose top sits at `minute` goes in the order: before the first block whose middle
 * is lower. The moved block is not in `day`.
 */
export function insertIndexAt(day: Pick<ShootingDayInput, 'callTime' | 'blocks'>, minute: number) {
  const index = scheduleTimes(day).findIndex(({ start, end }) => (start + end) / 2 > minute);
  return index === -1 ? day.blocks.length : index;
}

const without = (day: ShootingDayInput, id: string): ShootingDayInput => ({
  ...day,
  blocks: day.blocks.filter((block) => block.id !== id),
});

/**
 * Puts `block` in `day` at the time a drop or a key chose. Queued (the default), it goes in the
 * order and starts when the block before it ends; the blocks after it move down. Fixed (Alt), it
 * keeps that clock time, before the call reading as the next morning as the schema says.
 */
export function placeBlock(
  day: ShootingDayInput,
  block: ScheduleBlock,
  minute: number,
  fixed: boolean,
): ShootingDayInput {
  const rest = without(day, block.id);
  if (!fixed) {
    const index = insertIndexAt(rest, minute);
    const blocks = [...rest.blocks];
    blocks.splice(index, 0, { ...block, start: null });
    return { ...rest, blocks };
  }
  const at = Math.max(snap(minute, 1), clockMinutes(day.callTime));
  const index = scheduleTimes(rest).findIndex(({ start }) => start >= at);
  const blocks = [...rest.blocks];
  blocks.splice(index === -1 ? blocks.length : index, 0, { ...block, start: clockString(at) });
  return { ...rest, blocks };
}

/** A drag inside one day. */
export function moveBlock(day: ShootingDayInput, id: string, minute: number, fixed: boolean) {
  const block = day.blocks.find((item) => item.id === id);
  return block ? placeBlock(day, block, minute, fixed) : day;
}

/**
 * A block dragged to another day: the day it leaves closes the gap by itself (its blocks queue
 * up); both new days are returned so one undo puts both back.
 */
export function moveBlockToDay(
  from: ShootingDayInput,
  to: ShootingDayInput,
  id: string,
  minute: number,
  fixed: boolean,
): { from: ShootingDayInput; to: ShootingDayInput } {
  const block = from.blocks.find((item) => item.id === id);
  if (!block) return { from, to };
  return { from: without(from, id), to: placeBlock(to, block, minute, fixed) };
}

/** One place up or down in the order (Alt+arrows); the block queues up again. */
export function shiftBlock(day: ShootingDayInput, id: string, offset: -1 | 1): ShootingDayInput {
  const index = day.blocks.findIndex((block) => block.id === id);
  const target = index + offset;
  if (index === -1 || target < 0 || target >= day.blocks.length) return day;
  const blocks = [...day.blocks];
  const [moved] = blocks.splice(index, 1);
  if (moved) blocks.splice(target, 0, { ...moved, start: null });
  return { ...day, blocks };
}

/** A new length, within the schema's 1 to 1440 minutes. */
export function resizeBlock(day: ShootingDayInput, id: string, duration: number) {
  const minutes = Math.min(1440, Math.max(1, Math.round(duration)));
  return {
    ...day,
    blocks: day.blocks.map((block) => (block.id === id ? { ...block, duration: minutes } : block)),
  };
}

/** A copy right after the block, queued after it. */
export function duplicateBlock(day: ShootingDayInput, id: string) {
  const index = day.blocks.findIndex((block) => block.id === id);
  const block = day.blocks[index];
  if (!block) return { day, id: null };
  const copy = { ...block, id: crypto.randomUUID(), start: null };
  const blocks = [...day.blocks];
  blocks.splice(index + 1, 0, copy);
  return { day: { ...day, blocks }, id: copy.id };
}

/** Minutes as "1h 30" or "45 min". */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}
