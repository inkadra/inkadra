// SPDX-License-Identifier: AGPL-3.0-only
import { type CastAppearance, castAppearances } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { CastAppearances } from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api } from '../../lib/api.ts';
import type { BoardStore } from '../store.ts';

const requests = new Map<string, Promise<CastAppearance[]>>();
const FRESH_MS = 60_000;

/**
 * Where the names of a cast appear on the other boards of a project, for everyone who asks.
 * shortcut: kept for a minute, so a frame edited on another board can show late.
 */
export function loadCastAppearances(projectId: string, boardId: string) {
  const key = `${projectId}:${boardId}`;
  let request = requests.get(key);
  if (!request) {
    request = api
      .get<CastAppearances>(`/projects/${projectId}/cast-appearances?excludeBoardId=${boardId}`)
      .then((result) => result.items)
      .catch(() => []);
    requests.set(key, request);
    setTimeout(() => requests.delete(key), FRESH_MS);
  }
  return request;
}

/** Where a character appears: its scenes come from the cast of the frames, by name. */
export function characterAppearance(
  name: string,
  appearances: Iterable<CastAppearance>,
): { frames: number; scenes: string[] } {
  const key = name.trim().toLocaleLowerCase();
  const found = [...appearances].filter((entry) => key && entry.name === key);
  return {
    frames: found.reduce((sum, entry) => sum + entry.frames, 0),
    scenes: [...new Set(found.flatMap((entry) => entry.scenes))],
  };
}

/** "Protagonista · 34 anni": a plain number becomes an age, anything else stays as written. */
export function characterSubtitle(
  card: { role?: string | undefined; age?: string | undefined },
  t: TFunction,
): string {
  const age =
    card.age && /^\d+$/.test(card.age)
      ? t('story.character.ageYears', { age: card.age })
      : card.age;
  return [card.role, age].filter(Boolean).join(' · ');
}

/** Scenes of a character, from the frames and from its manual field: the same everywhere. */
export function characterSceneCount(
  card: { name: string; scenes?: readonly string[] | undefined },
  appearances: Iterable<CastAppearance>,
): number {
  return new Set([...(card.scenes ?? []), ...characterAppearance(card.name, appearances).scenes])
    .size;
}

const perSnapshot = new WeakMap<object, CastAppearance[]>();

/** The cast of this board's frames, worked out once per change for all its character cards. */
export function boardCast(snapshot: { byId: ReadonlyMap<string, Element> }): CastAppearance[] {
  let cast = perSnapshot.get(snapshot.byId);
  if (!cast) {
    cast = castAppearances([...snapshot.byId.values()]);
    perSnapshot.set(snapshot.byId, cast);
  }
  return cast;
}

/**
 * Frames and scenes of a character: this board live, the other boards from the server. Guests
 * have only what their board shows. A card re-renders only when its own answer changes.
 */
export function useCharacterAppearance(
  store: BoardStore,
  name: string,
  projectId: string,
  boardId: string,
  guest: boolean,
) {
  const local = useSyncExternalStore(store.subscribe, () =>
    JSON.stringify(characterAppearance(name, boardCast(store.getSnapshot()))),
  );
  const [others, setOthers] = useState<CastAppearance[]>([]);
  useEffect(() => {
    if (guest) return;
    let live = true;
    void loadCastAppearances(projectId, boardId).then((next) => {
      if (live) setOthers(next);
    });
    return () => {
      live = false;
    };
  }, [projectId, boardId, guest]);
  return useMemo(() => {
    const here = JSON.parse(local) as { frames: number; scenes: string[] };
    return characterAppearance(name, [
      { name: name.trim().toLocaleLowerCase(), ...here },
      ...others,
    ]);
  }, [local, others, name]);
}
