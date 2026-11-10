// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '@inkadra/doc-schema';
import { type CastLink, castNameKey, parseMapLink, type ShootingDayInput } from '@inkadra/shared';
import { neededForDay } from './needed.ts';
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

/** Times use the same overnight offsets as the schedule, never new saved fields. */
export function keyTimes(day: ShootingDayInput) {
  const slots = scheduleTimes(day);
  const shots = slots.filter(({ block }) => block.type === 'shot' || !!block.shotId);
  // Sunrise and sunset need a location's coordinates: see sunOfDay in day-calls.ts.
  return [
    { key: 'call', time: clockMinutes(day.callTime) },
    { key: 'ready', time: shots[0]?.start },
    { key: 'pause', time: slots.find(({ block }) => block.type === 'break')?.start },
    { key: 'cameraWrap', time: shots.at(-1)?.end },
    { key: 'crewWrap', time: plannedWrap(day) ?? undefined },
  ].filter((entry): entry is { key: string; time: number } => entry.time !== undefined);
}

export interface DayLocation {
  name: string;
  address?: string | undefined;
  mapUrl?: string | undefined;
}

/** Resolve by element identity, including scenes without numbers and loose frames. */
export function sheetShot(shotId: string | null, elements: ReadonlyMap<string, Element>) {
  const frame = shotId ? elements.get(shotId) : undefined;
  const parent = frame?.type === 'frame' && frame.parent ? elements.get(frame.parent) : undefined;
  return {
    frame: frame?.type === 'frame' ? frame : undefined,
    scene: parent?.type === 'scene' ? parent : undefined,
  };
}

export function hasSceneNumbers(day: ShootingDayInput, elements: ReadonlyMap<string, Element>) {
  return day.blocks.some((block) => !!sheetShot(block.shotId, elements).scene?.number?.trim());
}

/** Locations in shooting order; matching story cards provide the private address and map. */
export function locationsOfDay(
  day: ShootingDayInput,
  elements: ReadonlyMap<string, Element>,
): DayLocation[] {
  const names: string[] = [];
  for (const { block } of scheduleTimes(day)) {
    const name = sheetShot(block.shotId, elements).scene?.location?.trim();
    if (name && !names.some((value) => castNameKey(value) === castNameKey(name))) names.push(name);
  }
  if (!names.length && day.location.trim()) {
    let mapUrl: string | undefined;
    const text = day.location.replace(/\S+/g, (word) => {
      const token = word.replace(/^[<(]+|[>),.;]+$/g, '');
      const url = /^https?:/i.test(token) ? token : `https://${token}`;
      if (!parseMapLink(url)) return word;
      mapUrl ??= url;
      return '';
    });
    const [name = '', ...address] = text
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const card = [...elements.values()].find(
      (el) => el.type === 'location' && castNameKey(el.name) === castNameKey(name),
    );
    return [
      {
        name,
        address: card?.type === 'location' ? card.address : address.join('\n'),
        mapUrl: card?.type === 'location' ? card.mapUrl || mapUrl : mapUrl,
      },
    ];
  }
  return names.map((name) => {
    const card = [...elements.values()].find(
      (el) => el.type === 'location' && castNameKey(el.name) === castNameKey(name),
    );
    return {
      name,
      address: card?.type === 'location' ? card.address : undefined,
      mapUrl: card?.type === 'location' ? card.mapUrl : undefined,
    };
  });
}

/** Only the first scheduled row of a scene carries its own needed items, not the day's totals. */
export function serveLines(
  day: ShootingDayInput,
  elements: ReadonlyMap<string, Element>,
): Map<string, string> {
  const seen = new Set<string>();
  const lines = new Map<string, string>();
  for (const { block } of scheduleTimes(day)) {
    const scene = sheetShot(block.shotId, elements).scene;
    if (!scene || seen.has(scene.id)) continue;
    seen.add(scene.id);
    const needed = neededForDay({ ...day, blocks: [block] }, elements.values());
    if (needed.length)
      lines.set(
        block.id,
        needed.map((row) => `${row.text}${row.count > 1 ? ` ×${row.count}` : ''}`).join(', '),
      );
  }
  return lines;
}

export function castCharacter(name: string, elements: ReadonlyMap<string, Element>) {
  return [...elements.values()].find(
    (el): el is Extract<Element, { type: 'character' }> =>
      el.type === 'character' && castNameKey(el.name) === castNameKey(name),
  );
}
