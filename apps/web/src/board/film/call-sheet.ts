// SPDX-License-Identifier: AGPL-3.0-only
import type { ShootingDayInput } from '@inkadra/shared';
import { clockMinutes, scheduleTimes } from './schedule.ts';

/** First scheduled appearance, in local minutes from the shooting date (including overnight). */
export function castCalls(day: ShootingDayInput) {
  const calls = new Map<string, { name: string; start: number }>();
  for (const { block, start } of scheduleTimes(day)) {
    for (const value of block.cast) {
      const name = value.trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      const previous = calls.get(key);
      if (!previous || start < previous.start) calls.set(key, { name, start });
    }
  }
  return [...calls.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}

/**
 * Planned wrap in minutes from the shooting date: the saved wrap time when there is one (the
 * next morning when it is before the call), otherwise the end of the last block.
 */
export function plannedWrap(day: ShootingDayInput): number | null {
  const call = clockMinutes(day.callTime);
  if (day.wrap) {
    const wrap = clockMinutes(day.wrap);
    return wrap < call ? wrap + 1440 : wrap;
  }
  const slots = scheduleTimes(day);
  return slots.length ? Math.max(...slots.map((slot) => slot.end)) : null;
}

export interface DepartmentNote {
  department: string;
  note: string;
  start: number;
  blockId: string;
}

/**
 * Department entries of the day, grouped by department. "Camera: bring the dolly" reads as
 * department and note; an entry without a colon names the department only.
 */
export function departmentNotes(day: ShootingDayInput): DepartmentNote[] {
  const notes: DepartmentNote[] = [];
  for (const { block, start } of scheduleTimes(day)) {
    for (const entry of block.departments) {
      const colon = entry.indexOf(':');
      const department = (colon > 0 ? entry.slice(0, colon) : entry).trim();
      const note = colon > 0 ? entry.slice(colon + 1).trim() : '';
      if (department) notes.push({ department, note, start, blockId: block.id });
    }
  }
  return notes.sort(
    (a, b) =>
      a.department.localeCompare(b.department, undefined, { sensitivity: 'base' }) ||
      a.start - b.start,
  );
}
