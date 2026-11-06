// SPDX-License-Identifier: AGPL-3.0-only
import {
  type CastLink,
  castNameKey,
  type ScheduleBlock,
  type ShootingDayInput,
} from '@inkadra/shared';
import { clockMinutes, scheduleTimes } from './schedule.ts';

/** First scheduled appearance, in local minutes from the shooting date (including overnight). */
export function castCalls(day: ShootingDayInput) {
  const calls = new Map<string, { name: string; start: number }>();
  for (const { block, start } of scheduleTimes(day)) {
    for (const value of block.cast) {
      const name = value.trim();
      if (!name) continue;
      const key = castNameKey(name);
      const previous = calls.get(key);
      if (!previous || start < previous.start) calls.set(key, { name, start });
    }
  }
  return [...calls.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}

/** The person's first call of the day through the cast names linked to them. */
export function personalCall(
  day: ShootingDayInput,
  links: readonly CastLink[],
  userId: string | undefined,
) {
  const mine = new Set(links.filter((link) => link.userId === userId).map((l) => l.castKey));
  return castCalls(day).find((call) => mine.has(castNameKey(call.name))) ?? null;
}

export interface SheetRow {
  id: string;
  start: number;
  block: ScheduleBlock;
  scene?: string | undefined;
  /** Label of the shot, or of the first of several. */
  first?: string | undefined;
  /** Label of the last of several shots in a row. */
  last?: string | undefined;
}

/**
 * The schedule for a narrow screen: shots in a row of one scene with the same cast read as one
 * line, "Sc. 4 · 4A–4C", at the time of the first.
 */
export function sheetRows(
  day: ShootingDayInput,
  shotOf: (id: string | null) => { label: string; scene?: string | undefined } | undefined,
): SheetRow[] {
  const castOf = (block: ScheduleBlock) => block.cast.map(castNameKey).join('\n');
  const rows: SheetRow[] = [];
  for (const { block, start } of scheduleTimes(day)) {
    const shot = shotOf(block.shotId);
    const previous = rows.at(-1);
    // Without a scene number the labels say nothing about belonging together.
    if (
      shot?.scene &&
      previous?.first &&
      previous.scene === shot.scene &&
      castOf(previous.block) === castOf(block)
    ) {
      previous.last = shot.label;
    } else {
      rows.push({ id: block.id, start, block, scene: shot?.scene, first: shot?.label });
    }
  }
  return rows;
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
