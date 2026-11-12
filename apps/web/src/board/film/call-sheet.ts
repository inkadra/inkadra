// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '@inkadra/doc-schema';
import {
  type CastLink,
  castCalls,
  castNameKey,
  isMapLink,
  plannedWrap,
  type ScheduleBlock,
  type ShootingDayInput,
} from '@inkadra/shared';
import { neededForDay } from './needed.ts';
import { clockMinutes, scheduleTimes } from './schedule.ts';

export { castCalls, plannedWrap } from '@inkadra/shared';

/** The person's first call of the day through the cast names linked to them. */
export function personalCall(
  day: ShootingDayInput,
  links: readonly CastLink[],
  userId: string | undefined,
) {
  const mine = new Set(links.filter((link) => link.userId === userId).map((l) => l.castKey));
  return castCalls(day).find((call) => mine.has(castNameKey(call.name))) ?? null;
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
  // A scene block shoots its scene as a whole (decision 0123).
  const shots = slots.filter(({ block }) => !asideBlock(block));
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

/**
 * A block that reads as one quiet line across the sheet: a break, a move, a set-up or a note,
 * not a shot or a scene.
 */
export const asideBlock = (block: Pick<ScheduleBlock, 'type' | 'shotId'>) =>
  block.type !== 'shot' && block.type !== 'scene' && !block.shotId;

type Planned = Pick<ScheduleBlock, 'type' | 'shotId'> & { sceneId?: string | undefined };

/**
 * Resolve by element identity, including scenes without numbers and loose frames: a shot
 * block's frame and its scene, a scene block's scene (decision 0123).
 */
export function sheetShot(block: Planned, elements: ReadonlyMap<string, Element>) {
  if (block.type === 'scene' && !block.shotId) {
    const scene = block.sceneId ? elements.get(block.sceneId) : undefined;
    return { frame: undefined, scene: scene?.type === 'scene' ? scene : undefined };
  }
  const frame = block.shotId ? elements.get(block.shotId) : undefined;
  const parent = frame?.type === 'frame' && frame.parent ? elements.get(frame.parent) : undefined;
  return {
    frame: frame?.type === 'frame' ? frame : undefined,
    scene: parent?.type === 'scene' ? parent : undefined,
  };
}

export function hasSceneNumbers(day: ShootingDayInput, elements: ReadonlyMap<string, Element>) {
  return day.blocks.some((block) => !!sheetShot(block, elements).scene?.number?.trim());
}

/**
 * The cast a sheet prints for a block: its own list, and for a scene block also the cast of the
 * scene's frames, if it has any (decision 0123). Each name once.
 */
export function blockCast(
  block: Planned & Pick<ScheduleBlock, 'cast'>,
  elements: ReadonlyMap<string, Element>,
): string[] {
  const names = [...block.cast];
  if (block.type === 'scene' && block.sceneId)
    for (const el of elements.values())
      if (el.type === 'frame' && el.parent === block.sceneId) names.push(...(el.cast ?? []));
  return [...new Map(names.map((n) => [castNameKey(n), n.trim()])).values()].filter(Boolean);
}

/** The scene locations of the day, in shooting order, each once. */
function sceneLocations(day: ShootingDayInput, elements: ReadonlyMap<string, Element>): string[] {
  const names: string[] = [];
  for (const { block } of scheduleTimes(day)) {
    const name = sheetShot(block, elements).scene?.location?.trim();
    if (name && !names.some((value) => castNameKey(value) === castNameKey(name))) names.push(name);
  }
  return names;
}

/**
 * The day's own Location field: its first line names the place, the next ones are the address,
 * a map link anywhere is the map. A location card of that name provides address and map.
 */
function dayPlace(day: ShootingDayInput, elements: ReadonlyMap<string, Element>) {
  if (!day.location.trim()) return null;
  let mapUrl: string | undefined;
  const text = day.location.replace(/\S+/g, (word) => {
    const token = word.replace(/^[<(]+|[>),.;]+$/g, '');
    const url = /^https?:/i.test(token) ? token : `https://${token}`;
    if (!isMapLink(url)) return word;
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
  // A card without an address or a map keeps the ones written in the day's field.
  const own = card?.type === 'location' ? card : undefined;
  return { name, address: own?.address || address.join('\n'), mapUrl: own?.mapUrl || mapUrl };
}

/** Locations in shooting order; matching story cards provide the private address and map. */
export function locationsOfDay(
  day: ShootingDayInput,
  elements: ReadonlyMap<string, Element>,
): DayLocation[] {
  const names = sceneLocations(day, elements);
  const own = dayPlace(day, elements);
  if (!names.length) return own ? [own] : [];
  return names.map((name) => {
    const card = [...elements.values()].find(
      (el) => el.type === 'location' && castNameKey(el.name) === castNameKey(name),
    );
    // The day's Location naming this very place gives it its address and map.
    const same = own && castNameKey(own.name) === castNameKey(name) ? own : undefined;
    if (card?.type !== 'location') return { name, address: same?.address, mapUrl: same?.mapUrl };
    return {
      name,
      address: card.address || (same?.address ?? card.address),
      mapUrl: card.mapUrl || (same?.mapUrl ?? card.mapUrl),
    };
  });
}

/**
 * The day's own Location (address and map link) when the scenes name theirs, printed beside the
 * numbered ones: it is where the crew goes. Null when it is Loc. 1 already, or empty.
 */
export function dayAddress(
  day: ShootingDayInput,
  elements: ReadonlyMap<string, Element>,
): DayLocation | null {
  const names = sceneLocations(day, elements);
  const own = names.length ? dayPlace(day, elements) : null;
  // The same place as a scene's adds nothing to its numbered line.
  if (!own || names.some((name) => castNameKey(name) === castNameKey(own.name))) return null;
  return own;
}

/** Only the first scheduled row of a scene carries its own needed items, not the day's totals. */
export function serveLines(
  day: ShootingDayInput,
  elements: ReadonlyMap<string, Element>,
): Map<string, string> {
  const seen = new Set<string>();
  const lines = new Map<string, string>();
  for (const { block } of scheduleTimes(day)) {
    const scene = sheetShot(block, elements).scene;
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
