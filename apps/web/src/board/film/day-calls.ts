// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '@inkadra/doc-schema';
import {
  type CastLink,
  type Crew,
  type CrewCharacter,
  type CrewMember,
  castNameKey,
  type DayCall,
  type ShootingDayInput,
} from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { castCalls, castCharacter, type DayLocation } from './call-sheet.ts';
import { clockMinutes, scheduleTimes, whileVisible } from './schedule.ts';
import { locationCoords, sunTimes } from './sun.ts';

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
  /** The cast names of the blocks that are theirs: their name or their character's. */
  names: string[];
}

const isCast = (member: CrewMember) =>
  castNameKey(member.department) === 'cast' || castNameKey(member.role) === 'cast';

/**
 * The character card a row is linked to: on this board, read live from its elements; on another
 * board of the project, from the project's characters (crew rows are project data).
 */
export function linkedCharacter(
  member: CrewMember,
  elements: ReadonlyMap<string, Element>,
  characters: readonly CrewCharacter[] = [],
): { name: string; actor: string; contact: string } | undefined {
  const ref = member.character;
  if (!ref) return undefined;
  const here = elements.get(ref.elementId);
  if (here?.type === 'character')
    return { name: here.name, actor: here.actor ?? '', contact: here.contact ?? '' };
  return characters.find((c) => c.boardId === ref.boardId && c.elementId === ref.elementId);
}

export function characterName(
  member: CrewMember,
  elements: ReadonlyMap<string, Element>,
  characters: readonly CrewCharacter[] = [],
) {
  return linkedCharacter(member, elements, characters)?.name.trim() ?? '';
}

/**
 * The character card of a cast name on the sheet, for its actor and contact: a card of this board
 * with that name, else the card with that name its crew row is linked to, on any board.
 */
export function castCard(
  name: string,
  entry: DayCrewEntry | undefined,
  elements: ReadonlyMap<string, Element>,
  characters: readonly CrewCharacter[] = [],
) {
  const here = castCharacter(name, elements);
  if (here) return { name: here.name, actor: here.actor ?? '', contact: here.contact ?? '' };
  const linked = entry ? linkedCharacter(entry.member, elements, characters) : undefined;
  return linked && castNameKey(linked.name) === castNameKey(name) ? linked : undefined;
}

export function dayCrew(
  day: ShootingDayInput,
  crew: readonly CrewMember[],
  elements: ReadonlyMap<string, Element> = new Map(),
  characters: readonly CrewCharacter[] = [],
): DayCrewEntry[] {
  const dayCall = clockMinutes(day.callTime);
  const slots = scheduleTimes(day);
  return crew.map((member) => {
    const keys = new Set(
      [member.name, characterName(member, elements, characters)].filter(Boolean).map(castNameKey),
    );
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

/**
 * The day's calls after one change. Only exceptions are stored: an entry that says what the
 * default says is dropped, so the person follows the day again.
 */
export function withDayCall(
  calls: readonly DayCall[] | undefined,
  entry: DayCrewEntry,
  patch: { call?: string | null; pickup?: string | null; called?: boolean },
  crew: readonly CrewMember[],
): DayCall[] {
  const rest = (calls ?? []).filter(
    (c) =>
      c.crewMemberId !== entry.member.id && crew.some((member) => member.id === c.crewMemberId),
  );
  if (!crew.some((member) => member.id === entry.member.id)) return rest;
  const called = patch.called ?? entry.called;
  const call = patch.call !== undefined ? patch.call : entry.ownCall;
  const pickup = patch.pickup !== undefined ? patch.pickup || null : entry.ownPickup;
  if (call === null && pickup === null && called === entry.usual) return rest;
  return [
    ...rest,
    {
      crewMemberId: entry.member.id,
      call,
      pickup,
      ...(called === entry.usual ? {} : { absent: !called }),
    },
  ];
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

/** Departments in roster order; a department keeps the people in their roster order. */
export function byDepartment(entries: readonly DayCrewEntry[]) {
  const groups = new Map<string, DayCrewEntry[]>();
  for (const entry of entries) {
    const key = entry.member.department.trim();
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups].map(([department, people]) => ({ department, people }));
}

/** The people the call sheet prints as "on-set contact": called first, else any marked. */
export function onSetContacts(entries: readonly DayCrewEntry[]) {
  const marked = entries.filter((e) => e.member.onSetContact);
  const called = marked.filter((e) => e.called);
  return called.length ? called : marked;
}

/**
 * The cast table of the sheet: each cast name with its crew row, when there is one. Pick-up and
 * call fall back to the row's usual pick-up and to the day's call.
 */
export function castRows(day: ShootingDayInput, entries: readonly DayCrewEntry[]) {
  return castCalls(day).map((call) => ({
    ...call,
    entry: entries.find((e) => e.names.some((n) => castNameKey(n) === castNameKey(call.name))),
  }));
}

/** Called people the troupe section prints: everyone not already in the cast table. */
export function troupeRows(day: ShootingDayInput, entries: readonly DayCrewEntry[]) {
  const inCast = new Set(castRows(day, entries).flatMap((row) => row.entry?.member.id ?? []));
  return entries.filter((e) => e.called && !inCast.has(e.member.id));
}

/**
 * The viewer's own call, from the crew row linked to their account (decision 0091). With the
 * roster in hand it is the row's own call and pick-up; a person who cannot read the roster (a
 * grant on one board) gets the cast names of their row from the attendance links instead.
 */
export function personalDayCall(
  day: ShootingDayInput,
  entries: readonly DayCrewEntry[],
  links: readonly CastLink[] | undefined,
  userId: string | undefined,
): { label: string; start: number; pickup?: string | undefined; crew: boolean } | null {
  // One account can have several rows (two characters): the earliest row called today wins.
  const rows = userId ? entries.filter((e) => e.member.userId === userId) : [];
  const mine = rows.filter((e) => e.called).sort((a, b) => a.call - b.call)[0];
  if (rows.length && !mine) return null;
  if (mine)
    return {
      label: mine.member.role.trim() || mine.member.name,
      start: mine.call,
      pickup: mine.pickup.trim() || undefined,
      crew: true,
    };
  if (!links) return null;
  const keys = new Set(links.filter((l) => l.userId === userId).map((l) => l.castKey));
  const call = castCalls(day).find((c) => keys.has(castNameKey(c.name)));
  return call ? { label: call.name, start: call.start, crew: false } : null;
}

/**
 * Sunrise and sunset at the first location with coordinates: a location card's map link, else a
 * map link in the day's own location text, on the clock of the project (see `sunTimes`). None
 * without coordinates.
 */
export function sunOfDay(
  day: ShootingDayInput,
  locations: readonly DayLocation[],
  timeZone?: string | undefined,
) {
  for (const [index, location] of locations.entries()) {
    const coords = location.mapUrl ? locationCoords(location.mapUrl) : null;
    if (coords)
      return { ...sunTimes(day.date, coords.lat, coords.lng, timeZone), location: index + 1 };
  }
  const coords = locationCoords(day.location);
  if (!coords) return null;
  // The day's own location is Loc. 1 when the scenes name none.
  return { ...sunTimes(day.date, coords.lat, coords.lng, timeZone), location: 1 };
}

export interface CrewState {
  /** Null while it loads or when it cannot be read. */
  items: CrewMember[] | null;
  /** Character cards of other boards that crew rows are linked to; empty when none. */
  characters: CrewCharacter[];
  /** Not readable: a grant on one board does not disclose the roster (decision 0091). */
  failed: boolean;
  /** Ask again now, after a change made elsewhere (a cast link). */
  reload: () => void;
}

/** The boards other than this one that crew rows link a character on, sorted. */
const otherBoards = (crew: readonly CrewMember[], boardId: string | undefined) =>
  [
    ...new Set(
      crew.flatMap((m) =>
        m.character && m.character.boardId !== boardId ? [m.character.boardId] : [],
      ),
    ),
  ].sort();

/**
 * Character cards of the project, only when a row links one on another board: reading them opens
 * every board's document on the server. They are private like the roster (decision 0091).
 */
async function fetchCharacters(
  projectId: string,
  crew: readonly CrewMember[],
  boardId: string | undefined,
  signal?: AbortSignal,
): Promise<CrewCharacter[]> {
  const boards = new Set(otherBoards(crew, boardId));
  if (!boards.size) return [];
  return api.get<{ items: CrewCharacter[] }>(`/projects/${projectId}/crew/characters`, signal).then(
    (r) => r.items.filter((c) => boards.has(c.boardId)),
    () => [],
  );
}

/** The project's crew, asked again while the tab is in view, as the schedule is. */
export function useCrew(projectId: string | undefined, boardId?: string): CrewState {
  const [state, setState] = useState<Omit<CrewState, 'reload'>>({
    items: null,
    characters: [],
    failed: false,
  });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt asks for the roster again.
  useEffect(() => {
    if (!projectId) {
      setState({ items: null, characters: [], failed: true });
      return;
    }
    const controller = new AbortController();
    // Characters are fetched again only when the boards they come from change.
    let boards = '';
    let characters: CrewCharacter[] = [];
    const load = () =>
      api.get<Crew>(`/projects/${projectId}/crew`, controller.signal).then(
        async (r) => {
          const next = otherBoards(r.items, boardId).join();
          if (next !== boards) {
            characters = await fetchCharacters(projectId, r.items, boardId, controller.signal);
            boards = next;
          }
          if (!controller.signal.aborted) setState({ items: r.items, characters, failed: false });
        },
        () => {
          // A failed refresh keeps the roster on screen.
          if (!controller.signal.aborted)
            setState((current) =>
              current.items ? current : { items: null, characters: [], failed: true },
            );
        },
      );
    void load();
    const stop = whileVisible(() => void load());
    return () => {
      stop();
      controller.abort();
    };
  }, [projectId, boardId, attempt]);
  return { ...state, reload: () => setAttempt((n) => n + 1) };
}

/** The roster of a print: fetched once; nothing when it cannot be read. */
export async function loadCrew(
  projectId: string | undefined,
  boardId?: string,
): Promise<{ crew: CrewMember[]; characters: CrewCharacter[] }> {
  if (!projectId) return { crew: [], characters: [] };
  const crew = await api.get<Crew>(`/projects/${projectId}/crew`).then(
    (r) => r.items,
    () => [],
  );
  return { crew, characters: await fetchCharacters(projectId, crew, boardId) };
}
