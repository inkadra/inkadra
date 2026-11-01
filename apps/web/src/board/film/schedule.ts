import type { ScheduleBlock, ShootingDayInput } from '@inkadra/shared';
import { formatClock } from '../../lib/datetime.ts';

export function clockMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function clockLabel(minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const local = minutes % 1440;
  const clock = `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(local % 60).padStart(2, '0')}`;
  // In the person's time format (#302): 24 h unless they chose 12 h.
  return `${formatClock(clock)}${day ? ` (+${day})` : ''}`;
}

export function scheduleTimes(day: ShootingDayInput) {
  const call = clockMinutes(day.callTime);
  let cursor = call;
  return day.blocks.map((block) => {
    let start = block.start === null ? cursor : clockMinutes(block.start);
    if (block.start !== null && start < call) start += 1440;
    const end = start + block.duration;
    cursor = end;
    return { block, start, end };
  });
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
