// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '@inkadra/doc-schema';
import {
  type CastLink,
  type Crew,
  type CrewCharacter,
  type CrewMember,
  castCalls,
  castNameKey,
  type DayCall,
  type DayCrewEntry,
  linkedCharacter,
  type ShootingDayInput,
} from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { api, RequestError } from '../../lib/api.ts';
import { castCharacter, type DayLocation } from './call-sheet.ts';
import { whileVisible } from './schedule.ts';
import { locationCoords, sunTimes } from './sun.ts';

export {
  byDepartment,
  type CallSheetCard,
  castKeysOf,
  characterName,
  type DayCrewEntry,
  dayCrew,
  dialNumber,
  linkedCharacter,
} from '@inkadra/shared';

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
 * without coordinates. `location` is its number on the sheet, 0 for the day's `address`.
 */
export function sunOfDay(
  day: ShootingDayInput,
  locations: readonly DayLocation[],
  timeZone?: string | undefined,
  address?: DayLocation | null,
) {
  for (const [index, location] of locations.entries()) {
    const coords = location.mapUrl ? locationCoords(location.mapUrl) : null;
    if (coords)
      return { ...sunTimes(day.date, coords.lat, coords.lng, timeZone), location: index + 1 };
  }
  const coords =
    locationCoords(day.location) ?? (address?.mapUrl ? locationCoords(address.mapUrl) : null);
  if (!coords) return null;
  // The day's own location is Loc. 1 when the scenes name none, else its own Address line.
  return { ...sunTimes(day.date, coords.lat, coords.lng, timeZone), location: address ? 0 : 1 };
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
    (error) => {
      if (error instanceof RequestError && [403, 404].includes(error.status)) return [];
      throw error;
    },
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
    const load = () =>
      api
        .get<Crew>(`/projects/${projectId}/crew`, controller.signal)
        .then(async (r) => {
          const characters = await fetchCharacters(projectId, r.items, boardId, controller.signal);
          if (!controller.signal.aborted) setState({ items: r.items, characters, failed: false });
        })
        .catch(() => {
          // A failed refresh keeps the roster on screen.
          if (!controller.signal.aborted)
            setState((current) =>
              current.items ? current : { items: null, characters: [], failed: true },
            );
        });
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
    (error) => {
      if (error instanceof RequestError && [403, 404].includes(error.status)) return [];
      throw error;
    },
  );
  return { crew, characters: await fetchCharacters(projectId, crew, boardId) };
}
