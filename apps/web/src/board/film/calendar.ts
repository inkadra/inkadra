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

/** Grid scale: one pixel per minute ("Compatto", the default). */
export const MINUTE_PX = 1;
/** The grid's pixels per minute at each density; "Comodo" is the mockup's 1.6×. */
export const DENSITY = { compact: MINUTE_PX, comfy: 1.6 } as const;
export type Density = keyof typeof DENSITY;

/** Where a block sits in the hour grid at `scale` px per minute: on its minute, inside its slot. */
export function blockBox(start: number, end: number, scale: number) {
  return { top: start * scale, height: Math.max(1, (end - start) * scale) };
}

/**
 * A choice remembered in this browser only (the column, the density). Storage may be missing or
 * blocked (private windows, previews): then the choice lasts for the page.
 */
export function readChoice(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function saveChoice(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept for the page only.
  }
}
export const SIDE_KEY = 'inkadra.schedule.side';
export const DENSITY_KEY = 'inkadra.schedule.density';

/**
 * Whether the month and queue column is open: the person's own choice wins; otherwise it opens
 * when something waits in the queue and folds to its rail when nothing does.
 */
export function sideOpen(stored: string | null, waiting: number): boolean {
  if (stored === 'open') return true;
  if (stored === 'closed') return false;
  return waiting > 0;
}
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

/**
 * What a block card shows at its height, as in the approved mockups. On a computer: the
 * "cast · duration" line from 60 px in the week, from 52 px in the day view (which leads with
 * the type), the title on two lines from 62 px, and in the day view the frame from 44 px. On a
 * phone: the line from 56 px, one line of title, no frame. A block that shares its time with
 * another (a lane) shows only its start time.
 */
export function blockDetail(view: 'day' | 'week', height: number, phone: boolean, lanes: number) {
  const day = view === 'day' && !phone;
  return {
    meta: height >= (phone ? 56 : day ? 52 : 60),
    type: day,
    wrap: !phone && height >= 62,
    picture: day && height >= 44,
    range: lanes < 2,
  };
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
  const call = clockMinutes(day.callTime);
  // A fixed clock before the call means the next morning; later cycles are not representable.
  const at = Math.min(call + 1439, Math.max(snap(minute, 1), call));
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
  // Next to its neighbour in time, the order on screen: a block with a fixed time may be stored
  // anywhere in the list.
  const order = timeOrder(day);
  const neighbour = order[order.indexOf(id) + offset];
  if (!order.includes(id) || !neighbour) return day;
  const blocks = [...day.blocks];
  const [moved] = blocks.splice(
    blocks.findIndex((block) => block.id === id),
    1,
  );
  const target = blocks.findIndex((block) => block.id === neighbour) + (offset === 1 ? 1 : 0);
  if (moved) blocks.splice(target, 0, { ...moved, start: null });
  return { ...day, blocks };
}

/** The blocks' ids as the day shows them, by start time. */
export function timeOrder(day: ShootingDayInput): string[] {
  return scheduleTimes(day)
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((slot) => slot.block.id);
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

/** Human duration input, in whole minutes; invalid text never reaches the schedule. */
export function parseDuration(text: string): number | null {
  const match = /^(?:(\d+)\s*h(?:\s*(\d+)(?:\s*min)?)?|(\d+)(?:\s*min)?)$/i.exec(text.trim());
  if (!match) return null;
  const minutes =
    match[1] === undefined ? Number(match[3]) : Number(match[1]) * 60 + Number(match[2] ?? 0);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

interface CalendarRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** Beside the card when there is room; otherwise use the calendar's separate annotation band. */
export function placeAnnotation(
  card: CalendarRect,
  size: { width: number; height: number },
  viewport: CalendarRect,
  obstacles: readonly CalendarRect[],
): { left: number; top: number } | null {
  const top = Math.max(
    viewport.top + 4,
    Math.min(card.top, viewport.top + viewport.height - size.height - 4),
  );
  for (const left of [card.left + card.width + 6, card.left - size.width - 6]) {
    if (left < viewport.left || left + size.width > viewport.left + viewport.width) continue;
    if (top + size.height > viewport.top + viewport.height) continue;
    if (
      obstacles.some(
        (rect) =>
          left < rect.left + rect.width &&
          left + size.width > rect.left &&
          top < rect.top + rect.height &&
          top + size.height > rect.top,
      )
    )
      continue;
    return { left, top };
  }
  return null;
}

/**
 * PostgreSQL JSONB may reorder object keys; array order and every contract field still matter.
 * Missing calls read as none (decision 0092): the server returns `calls: []` to the team for a
 * day the client created without them.
 */
export function sameScheduleInput(a: ShootingDayInput | null, b: ShootingDayInput | null): boolean {
  const canonical = (input: ShootingDayInput | null) =>
    JSON.stringify(input && { ...input, calls: input.calls ?? [] }, (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
    );
  return canonical(a) === canonical(b);
}

/**
 * The time a drag on empty grid draws (phase 2): from where it started to where it is, in
 * 5-minute steps, at least one step long and at most the schema's 1440 minutes.
 */
export function drawnRange(from: number, to: number): { start: number; end: number } {
  const a = snap(Math.max(0, Math.min(from, to)));
  const b = snap(Math.max(from, to));
  return { start: a, end: Math.min(a + 1440, Math.max(b, a + SNAP)) };
}

/**
 * A block drawn on empty time. Where nothing is planned (a gap before a fixed start, or after
 * the last block) it keeps the drawn time as a fixed start, otherwise there would be no way to
 * leave that room (0089). Drawn over other blocks, at the call or right where the queue would
 * put it anyway, it queues up like a dropped block.
 */
export function insertDrawnBlock(
  day: ShootingDayInput,
  block: ScheduleBlock,
  start: number,
): ShootingDayInput {
  const slots = scheduleTimes(day);
  const queued = placeBlock(day, block, start, false);
  const queuedAt = scheduleTimes(queued).find((slot) => slot.block.id === block.id)?.start;
  const busy = slots.some((slot) => start >= slot.start && start < slot.end);
  if (busy || start <= clockMinutes(day.callTime) || queuedAt === start) return queued;
  return placeBlock(day, block, start, true);
}

/**
 * A whole shooting day moved to `to` with its blocks (phase 3). The days already on `to` take
 * the date it leaves, so the two swap; every change is returned so one undo puts all back.
 */
export function moveDay<T extends { day: { id: string }; draft: ShootingDayInput }>(
  days: readonly T[],
  id: string,
  to: string,
): Array<{ entry: T; next: ShootingDayInput }> {
  const moved = days.find((entry) => entry.day.id === id);
  if (!moved || moved.draft.date === to) return [];
  const from = moved.draft.date;
  return [
    { entry: moved, next: { ...moved.draft, date: to } },
    ...days
      .filter((entry) => entry !== moved && entry.draft.date === to)
      .map((entry) => ({ entry, next: { ...entry.draft, date: from } })),
  ];
}

/**
 * The free day of the week drawn at full width while something is dragged over it: a block
 * (its drag target), a queued shot (the column under it) or a whole day (its target date). Each
 * is a column key, which for a free day is its date. The Day view never narrows a column.
 */
export function widenedFreeDay(
  view: 'day' | 'week',
  columns: readonly { date: string; entry: unknown }[],
  targets: readonly (string | null | undefined)[],
): string | null {
  if (view !== 'week') return null;
  return columns.find((column) => !column.entry && targets.includes(column.date))?.date ?? null;
}
