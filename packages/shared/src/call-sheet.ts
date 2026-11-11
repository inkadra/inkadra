// SPDX-License-Identifier: MPL-2.0
import type { CrewCharacter, CrewMember } from './crew.ts';
import { castNameKey, clockMinutes, type ShootingDayInput, scheduleTimes } from './schedule.ts';

/**
 * Who is called on a shooting day and when (decisions 0091, 0092): the rules every client shows
 * on the schedule and the call sheet. Times are minutes from the shooting date's midnight; a
 * block past midnight goes on from 1440. Days have no time zone (decision 0022).
 */

/** First scheduled appearance of each cast name, earliest first, then by name. */
export function castCalls(day: ShootingDayInput): Array<{ name: string; start: number }> {
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

/**
 * Ids of the blocks whose cast overlaps in time with another block sharing a name (compared
 * without case), across the given days, including blocks that run into the next date.
 */
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

/**
 * The part of a board card the call sheet reads: a `character` card of the board document
 * (`@inkadra/doc-schema`), with its name, actor and contact. Any element of the board fits.
 */
export interface CallSheetCard {
  type: string;
  name?: string;
  actor?: string | undefined;
  contact?: string | undefined;
}

/** A cast row: department or role "Cast". */
export const isCast = (member: CrewMember) =>
  castNameKey(member.department) === 'cast' || castNameKey(member.role) === 'cast';

/**
 * The character card a row is linked to: on this board, read live from its elements; on another
 * board of the project, from the project's characters (crew rows are project data).
 */
export function linkedCharacter(
  member: CrewMember,
  elements: ReadonlyMap<string, CallSheetCard>,
  characters: readonly CrewCharacter[] = [],
): { name: string; actor: string; contact: string } | undefined {
  const ref = member.character;
  if (!ref) return undefined;
  const here = elements.get(ref.elementId);
  if (here?.type === 'character')
    return { name: here.name ?? '', actor: here.actor ?? '', contact: here.contact ?? '' };
  return characters.find((c) => c.boardId === ref.boardId && c.elementId === ref.elementId);
}

export function characterName(
  member: CrewMember,
  elements: ReadonlyMap<string, CallSheetCard>,
  characters: readonly CrewCharacter[] = [],
) {
  return linkedCharacter(member, elements, characters)?.name.trim() ?? '';
}

/**
 * The cast names of each crew row (decisions 0092, 0095): its own name and its linked card's
 * always; the role of a row in Cast only when no row has that name or card, and then for the
 * first such row by roster position. The server reads the same rule (`crewCastKeys`).
 */
export function castKeysOf(
  crew: readonly CrewMember[],
  elements: ReadonlyMap<string, CallSheetCard> = new Map(),
  characters: readonly CrewCharacter[] = [],
): Map<string, Set<string>> {
  const own = new Map(
    crew.map((member) => [
      member.id,
      new Set(
        [member.name, characterName(member, elements, characters)]
          .filter((name) => name.trim())
          .map(castNameKey),
      ),
    ]),
  );
  const named = new Set([...own.values()].flatMap((keys) => [...keys]));
  const roles = new Map<string, string>();
  // Roster order: position, then id, as the server's `crewCastKeys`.
  const order = (a: CrewMember, b: CrewMember) =>
    a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const member of [...crew].sort(order)) {
    const role = castNameKey(member.department) === 'cast' ? castNameKey(member.role) : '';
    if (role && !named.has(role) && !roles.has(role)) roles.set(role, member.id);
  }
  for (const [role, id] of roles) own.get(id)?.add(role);
  return own;
}

/** One crew member on one shooting day (decision 0092). */
export interface DayCrewEntry {
  member: CrewMember;
  /** A cast row: department or role "Cast", or linked to a character card. */
  cast: boolean;
  /** What the default rule says: crew are called, cast only when named in the blocks. */
  usual: boolean;
  called: boolean;
  /** Call in minutes from the shooting date: the person's own, else the day's. */
  call: number;
  ownCall: string | null;
  /** Pick-up of the day, else the usual one; may be empty. */
  pickup: string;
  ownPickup: string | null;
  /** First block with them in its cast. */
  scene: { start: number; blockId: string } | null;
  /** The cast names of the blocks that are theirs: their name, their character's or their role. */
  names: string[];
}

/** Every crew row on the day, in roster order: called or not, with their call and pick-up. */
export function dayCrew(
  day: ShootingDayInput,
  crew: readonly CrewMember[],
  elements: ReadonlyMap<string, CallSheetCard> = new Map(),
  characters: readonly CrewCharacter[] = [],
): DayCrewEntry[] {
  const dayCall = clockMinutes(day.callTime);
  const slots = scheduleTimes(day);
  const castKeys = castKeysOf(crew, elements, characters);
  return crew.map((member) => {
    const keys = castKeys.get(member.id) ?? new Set<string>();
    const names = [
      ...new Set(day.blocks.flatMap((b) => b.cast.filter((name) => keys.has(castNameKey(name))))),
    ];
    const first = slots
      .filter(({ block }) => block.cast.some((name) => keys.has(castNameKey(name))))
      .sort((a, b) => a.start - b.start)[0];
    const cast = isCast(member) || !!member.character;
    const usual = !cast || !!first;
    const own = day.calls?.find((c) => c.crewMemberId === member.id);
    return {
      member,
      cast,
      usual,
      called: own?.absent === undefined ? usual : !own.absent,
      call: own?.call ? clockMinutes(own.call) : dayCall,
      ownCall: own?.call ?? null,
      pickup: own?.pickup ?? member.pickup,
      ownPickup: own?.pickup ?? null,
      scene: first ? { start: first.start, blockId: first.block.id } : null,
      names,
    };
  });
}

/** Departments in roster order; a department keeps the people in their roster order. */
export function byDepartment(entries: readonly DayCrewEntry[]) {
  const groups = new Map<string, DayCrewEntry[]>();
  for (const entry of entries) {
    const key = entry.member.department.trim();
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups].map(([department, people]) => ({ department, people }));
}

/**
 * The number to dial in a free-text phone field ("Agenzia Nord · +39 02 000 0001"), or null.
 * Only digits and a leading + go into the tel: link.
 */
export function dialNumber(text: string): string | null {
  const found = text.match(/\+?\d[\d\s().\-/]{4,}\d/);
  if (!found) return null;
  return found[0].replace(/[^\d+]/g, '');
}
