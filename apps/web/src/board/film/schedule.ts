import {
  clockMinutes,
  type ScheduleBlock,
  type ShootingDayInput,
  scheduleTimes,
} from '@inkadra/shared';
import { formatClock } from '../../lib/datetime.ts';

export { clockMinutes, scheduleTimes } from '@inkadra/shared';

export function clockLabel(minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const local = minutes % 1440;
  const clock = `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(local % 60).padStart(2, '0')}`;
  // In the person's time format (#302): 24 h unless they chose 12 h.
  return `${formatClock(clock)}${day ? ` (+${day})` : ''}`;
}

/** Case-insensitive cast matches, including blocks on neighbouring calendar dates. */
export function castConflicts(days: ShootingDayInput[]): Set<string> {
  const blocks = days.flatMap((day) => {
    const date = Date.parse(`${day.date}T00:00:00Z`) / 60000;
    return scheduleTimes(day).map((slot) => ({
      ...slot,
      start: date + slot.start,
      end: date + slot.end,
    }));
  });
  const conflicts = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    if (!a) continue;
    const cast = new Set(a.block.cast.map((name) => name.trim().toLocaleLowerCase()));
    for (const b of blocks.slice(i + 1)) {
      if (
        a.start < b.end &&
        b.start < a.end &&
        b.block.cast.some((name) => cast.has(name.trim().toLocaleLowerCase()))
      ) {
        conflicts.add(a.block.id);
        conflicts.add(b.block.id);
      }
    }
  }
  return conflicts;
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
