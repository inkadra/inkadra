import {
  clockMinutes,
  type ScheduleBlock,
  type ShootingDayInput,
  scheduleTimes,
} from '@inkadra/shared';
import { formatClock } from '../../lib/datetime.ts';

export { castConflicts, clockMinutes, scheduleTimes } from '@inkadra/shared';

export function clockLabel(minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const local = minutes % 1440;
  const clock = `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(local % 60).padStart(2, '0')}`;
  // In the person's time format (#302): 24 h unless they chose 12 h.
  return `${formatClock(clock)}${day ? ` (+${day})` : ''}`;
}

/**
 * A time of the schedule for a TimeField: its "HH:MM" on the clock and, when it falls on a
 * later day than the call, the "(+1)" that `clockLabel` writes after it.
 */
export function fieldClock(minutes: number): { time: string; suffix: string | undefined } {
  const day = Math.floor(minutes / 1440);
  const local = minutes % 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    time: `${pad(Math.floor(local / 60))}:${pad(local % 60)}`,
    suffix: day ? `(+${day})` : undefined,
  };
}

export function newScheduleBlock(
  type: ScheduleBlock['type'],
  shotId: string | null = null,
): ScheduleBlock {
  return {
    id: crypto.randomUUID(),
    type,
    title: '',
    start: null,
    duration: 30,
    shotId,
    cast: [],
    departments: [],
  };
}

export const textList = (value: string): string[] => [
  ...new Set(
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];

const calendarDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Where `now` falls on a day's clock, in minutes from that day's midnight, while the day is under
 * way: from the call to its end (a night shoot runs past midnight, up to 1440 + minutes). Null on
 * any other day or hour. Days have no time zone (decision 0022): the person's own clock is used.
 */
export function nowOnDay(day: ShootingDayInput, end: number | null, now: Date): number | null {
  const call = clockMinutes(day.callTime);
  const last = Math.max(call, end ?? call);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (day.date === calendarDate(now) && minutes >= call && minutes <= last) return minutes;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day.date === calendarDate(yesterday) && minutes + 1440 <= last) return minutes + 1440;
  return null;
}

/**
 * Runs `refresh` when the tab comes back into view, and every minute while it stays in view: a sheet
 * left open on a phone follows the changes made elsewhere. Returns the function that stops it.
 * shortcut: up to a minute late, until the server can push schedule changes.
 */
export function whileVisible(refresh: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(onVisible, 60_000);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}

/** Blocks that call the same people at the same time, for the note under "N conflicts". */
export interface ConflictGroup {
  /** The people in all of them, as first written. */
  names: string[];
  /** When they all overlap, in minutes from the date of `day`. */
  at: number;
  /** Two or more, in time order. */
  blocks: ScheduleBlock[];
}

/**
 * The double bookings that touch `day`, in time order: the blocks `castConflicts` marks, on every
 * day given (a night shoot may run into the next morning). A person's blocks that all overlap make
 * one group, and the people booked in the same blocks share it.
 */
export function conflictGroups(days: readonly ShootingDayInput[], day: string): ConflictGroup[] {
  const base = Date.parse(`${day}T00:00:00Z`) / 60000;
  const slots = days.flatMap((d) => {
    const date = Date.parse(`${d.date}T00:00:00Z`) / 60000;
    return scheduleTimes(d).map((slot) => ({
      block: slot.block,
      mine: d.date === day,
      start: date + slot.start,
      end: date + slot.end,
    }));
  });
  type Slot = (typeof slots)[number];
  const key = (name: string) => name.trim().toLocaleLowerCase();
  const people = new Map<string, { name: string; slots: Slot[] }>();
  for (const slot of slots) {
    for (const name of slot.block.cast) {
      const person = people.get(key(name)) ?? { name, slots: [] };
      people.set(key(name), person);
      if (!person.slots.includes(slot)) person.slots.push(slot);
    }
  }
  const groups = new Map<string, ConflictGroup>();
  for (const { name, slots: booked } of people.values()) {
    // At each block's start: it and the person's blocks already running that overlap it.
    const sets = booked
      .map((s) =>
        booked.filter((o) => o === s || (o.start <= s.start && o.start < s.end && s.start < o.end)),
      )
      .filter((set) => set.length > 1 && set.some((o) => o.mine));
    // Only the largest: three blocks at once are one line, not three pairs.
    const largest = sets.filter(
      (set, i) =>
        !sets.some(
          (other, j) => set.every((o) => other.includes(o)) && (other.length > set.length || j < i),
        ),
    );
    for (const set of largest) {
      const ordered = [...set].sort((x, y) => x.start - y.start);
      const at = Math.max(...set.map((o) => o.start)) - base;
      const id = `${at} ${ordered.map((o) => o.block.id).join(' ')}`;
      const group = groups.get(id) ?? { names: [], at, blocks: ordered.map((o) => o.block) };
      groups.set(id, group);
      group.names.push(name);
    }
  }
  return [...groups.values()].sort((x, y) => x.at - y.at);
}

/** One line per double booking: "Elena è in tre blocchi alle 14:00: «A», «B» e «C»." */
export function conflictNotes(
  groups: readonly ConflictGroup[],
  title: (block: ScheduleBlock) => string,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string,
): string[] {
  const list = new Intl.ListFormat(language, { type: 'conjunction' });
  return groups.map((group) =>
    t(group.blocks.length > 2 ? 'schedule.conflictNoteMany' : 'schedule.conflictNote', {
      count: group.names.length,
      names: list.format(group.names),
      time: clockLabel(group.at),
      blocks: group.blocks.length,
      titles: list.format(
        group.blocks.map((block) => t('schedule.conflictTitle', { title: title(block) })),
      ),
    }),
  );
}
