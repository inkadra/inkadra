// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '@inkadra/doc-schema';
import {
  type CastLink,
  type Crew,
  type CrewMember,
  castNameKey,
  type DayCall,
  type ShootingDayInput,
} from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { castCalls, type DayLocation } from './call-sheet.ts';
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
 * The character card a row is linked to, read from this board's elements.
 * shortcut: a card on another board of the project is not resolved; its row is matched by name.
 */
export function characterName(member: CrewMember, elements: ReadonlyMap<string, Element>) {
  const card = member.character ? elements.get(member.character.elementId) : undefined;
  return card?.type === 'character' ? card.name.trim() : '';
}

export function dayCrew(
  day: ShootingDayInput,
  crew: readonly CrewMember[],
  elements: ReadonlyMap<string, Element> = new Map(),
): DayCrewEntry[] {
  const dayCall = clockMinutes(day.callTime);
  const slots = scheduleTimes(day);
  return crew.map((member) => {
    const keys = new Set(
      [member.name, characterName(member, elements)].filter(Boolean).map(castNameKey),
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
): DayCall[] {
  const rest = (calls ?? []).filter((c) => c.crewMemberId !== entry.member.id);
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
 * The viewer's own call: through the crew row linked to their account, else (for people outside
 * the roster) through the cast names linked to them on this board, as before.
 */
export function personalDayCall(
  day: ShootingDayInput,
  entries: readonly DayCrewEntry[],
  links: readonly CastLink[] | undefined,
  userId: string | undefined,
): { label: string; start: number; pickup?: string | undefined; crew: boolean } | null {
  const mine = userId ? entries.find((e) => e.member.userId === userId && e.called) : undefined;
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
 * map link in the day's own location text. None without coordinates.
 */
export function sunOfDay(day: ShootingDayInput, locations: readonly DayLocation[]) {
  for (const [index, location] of locations.entries()) {
    const coords = location.mapUrl ? locationCoords(location.mapUrl) : null;
    if (coords) return { ...sunTimes(day.date, coords.lat, coords.lng), location: index + 1 };
  }
  const coords = locationCoords(day.location);
  if (!coords) return null;
  // The day's own location is Loc. 1 when the scenes name none.
  return { ...sunTimes(day.date, coords.lat, coords.lng), location: 1 };
}

export interface CrewState {
  /** Null while it loads or when it cannot be read. */
  items: CrewMember[] | null;
  /** Not readable: a grant on one board does not disclose the roster (decision 0091). */
  failed: boolean;
}

/** The project's crew, asked again while the tab is in view, as the schedule is. */
export function useCrew(projectId: string | undefined): CrewState {
  const [state, setState] = useState<CrewState>({ items: null, failed: false });
  useEffect(() => {
    if (!projectId) {
      setState({ items: null, failed: true });
      return;
    }
    const controller = new AbortController();
    const load = () =>
      api.get<Crew>(`/projects/${projectId}/crew`, controller.signal).then(
        (r) => setState({ items: r.items, failed: false }),
        () => {
          // A failed refresh keeps the roster on screen.
          if (!controller.signal.aborted)
            setState((current) => (current.items ? current : { items: null, failed: true }));
        },
      );
    void load();
    const stop = whileVisible(() => void load());
    return () => {
      stop();
      controller.abort();
    };
  }, [projectId]);
  return state;
}

/** The roster of a print: fetched once; nothing when it cannot be read. */
export async function loadCrew(projectId: string | undefined): Promise<CrewMember[]> {
  if (!projectId) return [];
  return api.get<Crew>(`/projects/${projectId}/crew`).then(
    (r) => r.items,
    () => [],
  );
}
