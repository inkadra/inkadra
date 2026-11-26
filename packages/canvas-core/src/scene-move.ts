// SPDX-License-Identifier: MPL-2.0
import { compareZ, type Element, roots } from '@inkadra/doc-schema';
import { generateNKeysBetween } from 'fractional-indexing';
import type * as Y from 'yjs';
import { cloneMap, deleteElements, foreignCardsIn, keyAtEnd, listElements } from './board.ts';
import type { SceneElement } from './film.ts';

/**
 * Scenes live in storyboards (decision 0140): the loose scenes of an ordinary board move into a
 * storyboard with their frames, their set plans and their scene lists. A scene stays where a
 * move would leave something behind:
 * - `server`: comments, reactions, review decisions or guest picks, kept by board and card;
 * - `days`: a shooting day points at it, or one of its plans follows a shooting day;
 * - `links`: an arrow or a plan link ties it to a card that stays;
 * - `foreign`: a card this build does not fully understand (decision 0101).
 */
export type SceneStayReason = 'server' | 'days' | 'links' | 'foreign';

export interface SceneMovePlan {
  /** Cards on the board to move: scenes (their frames go with them), their plans and lists. */
  ids: string[];
  /** The same cards by unit: a scene with its plans and lists, or scenes one plan links. */
  units: string[][];
  /** The scenes that move, in storyboard order. */
  scenes: SceneElement[];
  /** Frames of those scenes. */
  frames: number;
  /** The scenes that stay, each with the first reason found. */
  stay: Array<{ scene: SceneElement; reason: SceneStayReason }>;
}

/** The scenes of a board, in order. */
export const scenesOf = (elements: readonly Element[]): SceneElement[] =>
  elements.filter((e): e is SceneElement => e.type === 'scene').sort(compareZ);

/**
 * Which scenes of `doc` can move to another board, and which stay. `held` names the cards the
 * server keeps something about (comments and the like: `server`; shooting days: `days`).
 * A plan that links several scenes moves them together, or none of them. `only`: these scenes
 * and no others (the ones a screenplay import just added).
 */
export function planSceneMove(
  doc: Y.Doc,
  held: ReadonlyMap<string, 'server' | 'days'>,
  only?: ReadonlySet<string>,
): SceneMovePlan {
  const all = listElements(doc);
  const everyScene = new Set(scenesOf(all).map((s) => s.id));
  const scenes = scenesOf(all).filter((s) => !only || only.has(s.id));
  const plans = all.filter((e) => e.type === 'plan');
  // Scenes joined by a shared plan (or plan family) form one unit: union-find on scene ids.
  const root = new Map(scenes.map((s) => [s.id, s.id]));
  const find = (id: string): string => {
    const up = root.get(id) ?? id;
    if (up === id) return id;
    const top = find(up);
    root.set(id, top);
    return top;
  };
  const join = (a: string, b: string) => root.set(find(a), find(b));
  // A plan and its variants are one family (decision 0062): they go together.
  const family = new Map<string, string>();
  for (const p of plans) family.set(p.id, p.type === 'plan' && p.variantOf ? p.variantOf : p.id);
  const familyScenes = new Map<string, string[]>();
  for (const p of plans) {
    if (p.type !== 'plan') continue;
    const key = family.get(p.id) ?? p.id;
    const list = familyScenes.get(key) ?? [];
    for (const s of p.sceneIds ?? []) if (root.has(s)) list.push(s);
    familyScenes.set(key, list);
  }
  for (const list of familyScenes.values())
    for (const s of list.slice(1)) if (list[0]) join(list[0], s);

  const units = new Map<string, Set<string>>();
  const unitOf = (sceneId: string) => {
    const key = find(sceneId);
    let set = units.get(key);
    if (!set) {
      set = new Set();
      units.set(key, set);
    }
    return set;
  };
  for (const s of scenes) unitOf(s.id).add(s.id);
  for (const e of all) {
    if (e.type === 'frame' && e.parent && root.has(e.parent)) unitOf(e.parent).add(e.id);
    if (e.type === 'todo' && e.sceneId && root.has(e.sceneId)) unitOf(e.sceneId).add(e.id);
  }
  for (const p of plans) {
    const linked = familyScenes.get(family.get(p.id) ?? p.id)?.[0];
    if (linked) unitOf(linked).add(p.id);
  }

  const verdict = new Map<string, SceneStayReason | null>();
  for (const [key, members] of units) {
    let reason: SceneStayReason | null = null;
    for (const id of members) {
      const h = held.get(id);
      if (h) reason = reason ?? h;
    }
    for (const e of all) {
      if (reason) break;
      if (e.type === 'arrow') {
        if (
          (e.from.elementId && members.has(e.from.elementId)) ||
          (e.to.elementId && members.has(e.to.elementId))
        )
          reason = 'links';
      } else if (e.type === 'plan') {
        const inside = members.has(e.id);
        if (inside && e.sun?.day) reason = 'days';
        // It also links a scene that is not moving.
        if (inside && (e.sceneIds ?? []).some((id) => everyScene.has(id) && !root.has(id)))
          reason = 'links';
        // Its links point out of the unit, or into it from a plan that stays.
        const links = [e.locationId, ...(e.icons ?? []).flatMap((i) => [i.frameId, i.characterId])];
        if (links.some((l) => l && (inside ? !members.has(l) : members.has(l)))) reason = 'links';
      }
    }
    if (!reason) {
      const top = [...members].filter((id) => !all.some((e) => e.id === id && e.type === 'frame'));
      const { foreign, unreadable } = foreignCardsIn(doc, top);
      if (foreign.length || unreadable.length) reason = 'foreign';
    }
    verdict.set(key, reason);
  }

  const plan: SceneMovePlan = { ids: [], units: [], scenes: [], frames: 0, stay: [] };
  for (const scene of scenes) {
    const reason = verdict.get(find(scene.id));
    if (reason) plan.stay.push({ scene, reason });
    else plan.scenes.push(scene);
  }
  for (const [key, members] of units) {
    if (verdict.get(key)) continue;
    const unit: string[] = [];
    for (const e of all) {
      if (!members.has(e.id)) continue;
      if (e.type === 'frame') plan.frames += 1;
      else unit.push(e.id);
    }
    plan.ids.push(...unit);
    plan.units.push(unit);
  }
  return plan;
}

/** Where a card sits: kept when it moves, to put it back exactly where it was. */
export interface CardPlace {
  x: number;
  y: number;
  z: string;
  parent: string | null;
}

/** Where each of these cards (not their children) sits in `doc` now. */
export function placesOf(doc: Y.Doc, ids: readonly string[]): Map<string, CardPlace> {
  const places = new Map<string, CardPlace>();
  for (const e of listElements(doc))
    if (ids.includes(e.id)) places.set(e.id, { x: e.x, y: e.y, z: e.z, parent: e.parent });
  return places;
}

/**
 * Copies cards with their children from `source` into `target` as they are stored, ids and
 * authors included, each top card at the place `placeOf` gives. Throws, writing nothing, when
 * an id is already there or a card is gone from `source`.
 */
export function copyCards(
  source: Y.Doc,
  target: Y.Doc,
  ids: readonly string[],
  placeOf: (id: string) => CardPlace,
  origin?: unknown,
): void {
  const from = roots(source).elements;
  const to = roots(target).elements;
  const picked = new Set(ids);
  const children = [...from.entries()].filter(
    ([, map]) => typeof map.get('parent') === 'string' && picked.has(map.get('parent') as string),
  );
  const all = [...ids, ...children.map(([id]) => id)];
  if (all.some((id) => to.has(id))) throw new Error('A card is already there.');
  if (ids.some((id) => !from.has(id))) throw new Error('A card is gone.');
  const places = ids.map((id) => placeOf(id));
  target.transact(() => {
    ids.forEach((id, i) => {
      const map = from.get(id);
      const place = places[i];
      if (!map || !place) return;
      const copy = cloneMap(map);
      copy.set('x', Math.round(place.x));
      copy.set('y', Math.round(place.y));
      copy.set('z', place.z);
      copy.set('parent', place.parent);
      to.set(id, copy);
    });
    for (const [id, map] of children) to.set(id, cloneMap(map));
  }, origin);
}

/**
 * Copies the cards of a move plan into `target`: the scenes after the last scene there,
 * everything to the right of what it has. Throws, writing nothing, when an id is already there.
 */
export function copySceneCards(
  source: Y.Doc,
  target: Y.Doc,
  plan: Pick<SceneMovePlan, 'ids'>,
  origin?: unknown,
): void {
  const there = listElements(target);
  const picked = new Set(plan.ids);
  const cards = listElements(source)
    .filter((e) => picked.has(e.id))
    .sort(compareZ);
  const right = there
    .filter((e) => e.parent === null)
    .reduce((m, e) => Math.max(m, e.x + (e.w ?? 0)), Number.NEGATIVE_INFINITY);
  const left = Math.min(...cards.map((c) => c.x));
  const top = Math.min(...cards.map((c) => c.y));
  const dx = (Number.isFinite(right) ? right + 40 : 0) - left;
  const keys = generateNKeysBetween(keyAtEnd(there, null), null, cards.length);
  const at = new Map(
    cards.map((c, i) => [
      c.id,
      { x: c.x + dx, y: c.y - top, z: keys[i] ?? keyAtEnd(there, null), parent: null },
    ]),
  );
  copyCards(
    source,
    target,
    cards.map((c) => c.id),
    (id) => at.get(id) as CardPlace,
    origin,
  );
}

/** Takes the moved cards off a board; false, removing nothing, when it cannot (0062). */
export function removeSceneCards(
  doc: Y.Doc,
  plan: Pick<SceneMovePlan, 'ids'>,
  origin?: unknown,
): boolean {
  return deleteElements(doc, plan.ids, origin).length === 0;
}

/** JSON with its keys sorted, so the same content always reads the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * A print of each card as stored, with its children (their ids and contents): two prints are
 * equal only when nobody changed, added or removed anything in it. A card that is gone has none.
 */
export function cardPrints(doc: Y.Doc, ids: readonly string[]): Map<string, string> {
  const elements = roots(doc).elements;
  const prints = new Map<string, string>();
  for (const id of ids) {
    const map = elements.get(id);
    if (!map) continue;
    const children = [...elements.entries()]
      .filter(([, child]) => child.get('parent') === id)
      .map(([childId, child]) => [childId, child.toJSON()])
      .sort(([a], [b]) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
    prints.set(id, stable({ card: map.toJSON(), children }));
  }
  return prints;
}

/** Whether every card of a unit is in `doc` exactly as printed. */
export function unitUnchanged(
  doc: Y.Doc,
  unit: readonly string[],
  prints: ReadonlyMap<string, string>,
): boolean {
  const now = cardPrints(doc, unit);
  return unit.every((id) => prints.has(id) && now.get(id) === prints.get(id));
}

/** The scenes' place on the board: the top-left corner of the moved cards. */
export function sceneMoveOrigin(
  elements: readonly Element[],
  plan: Pick<SceneMovePlan, 'ids'>,
): { x: number; y: number } | null {
  const cards = elements.filter((e) => plan.ids.includes(e.id) && e.type === 'scene');
  if (cards.length === 0) return null;
  return { x: Math.min(...cards.map((c) => c.x)), y: Math.min(...cards.map((c) => c.y)) };
}
