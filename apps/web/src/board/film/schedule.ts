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

/** Two blocks that call the same people at the same time, for the note under "N conflicts". */
export interface ConflictPair {
  /** The people in both blocks, as written in the first one. */
  names: string[];
  /** When they start to overlap, in minutes from the date of `day`. */
  at: number;
  a: ScheduleBlock;
  b: ScheduleBlock;
}

/**
 * The double bookings that touch `day`, in time order: the same pairs `castConflicts` marks, on
 * every day given (a night shoot may run into the next morning).
 */
export function conflictPairs(days: readonly ShootingDayInput[], day: string): ConflictPair[] {
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
  const key = (name: string) => name.trim().toLocaleLowerCase();
  const pairs: ConflictPair[] = [];
  for (const [i, a] of slots.entries()) {
    const cast = new Set(a.block.cast.map(key));
    for (const b of slots.slice(i + 1)) {
      if (!(a.mine || b.mine) || !(a.start < b.end && b.start < a.end)) continue;
      const shared = new Set(b.block.cast.map(key));
      const names = a.block.cast.filter((name) => cast.has(key(name)) && shared.has(key(name)));
      if (!names.length) continue;
      const [first, second] = a.start <= b.start ? [a, b] : [b, a];
      pairs.push({
        names: [...new Set(names)],
        at: second.start - base,
        a: first.block,
        b: second.block,
      });
    }
  }
  return pairs.sort((x, y) => x.at - y.at);
}

/** One line per double booking: "Elena è in due blocchi alle 14:00: «A» e «B»." */
export function conflictNotes(
  pairs: readonly ConflictPair[],
  title: (block: ScheduleBlock) => string,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string,
): string[] {
  const list = new Intl.ListFormat(language, { type: 'conjunction' });
  return pairs.map((pair) =>
    t('schedule.conflictNote', {
      count: pair.names.length,
      names: list.format(pair.names),
      time: clockLabel(pair.at),
      a: title(pair.a),
      b: title(pair.b),
    }),
  );
}
