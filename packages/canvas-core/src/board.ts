// SPDX-License-Identifier: MPL-2.0
import {
  addElement,
  CONTAINER_TYPES,
  CURRENT_SCHEMA_VERSION,
  checkCard,
  checkElement,
  Element,
  type ElementType,
  getSchemaVersion,
  hasStoredShape,
  MAX_PLAN_ICONS,
  MAX_PLAN_OPENINGS,
  MAX_PLAN_WALLS,
  MAX_SHAPES,
  MAX_STROKES,
  newElementId,
  PlanElement,
  readElement,
  roots,
  UNSORTED,
} from '@inkadra/doc-schema';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import type { Point, Rect } from './geometry.ts';
import { unlinkCharacter } from './plan-links.ts';
import { adoptBase, type PlanBase, planBaseOf } from './plan-variants.ts';

/**
 * Edits on a board document. Every function runs in one transaction tagged with `origin`, so
 * an UndoManager that tracks that origin undoes it as one step.
 *
 * Ordering: `z` is a fractional index. On the canvas it is the drawing order; inside a column
 * (or "Non ordinati") it is the order from top to bottom.
 */

/** Default width of new elements, in world units. Height follows the content. */
export const DEFAULT_WIDTH: Record<ElementType, number> = {
  note: 240,
  image: 240,
  link: 240,
  file: 240,
  todo: 240,
  color: 120,
  column: 260,
  board: 180,
  scene: 260,
  frame: 240,
  arrow: 1,
  character: 240,
  location: 260,
  section: 640,
  table: 420,
  map: 240,
  plan: 480,
};

export const MIN_WIDTH = 80;
/** Narrowest width where the text of a note or a to-do list still breaks between words. */
export const TEXT_MIN_WIDTH = 160;

/**
 * Notes and to-do lists: the height they store is a minimum, their text takes what it needs
 * beyond it, so a resize never leaves the text spilling out under the card.
 */
export function growsWithText(el: Pick<Element, 'type'>): boolean {
  return el.type === 'note' || el.type === 'todo';
}

/** Columns and scenes hold other cards through `parent`; they cannot be nested. */
export function isContainer(el: Pick<Element, 'type'>): boolean {
  return (CONTAINER_TYPES as readonly string[]).includes(el.type);
}

/**
 * Cards a section heading moves when `moveCards` is on: free cards whose top sits below the
 * heading's middle and above the next heading that overlaps it, and whose centre falls within
 * its width. Locked cards and arrows stay (arrows follow the cards they attach to).
 */
export function sectionMembers(
  section: Element,
  canvas: readonly Element[],
  rectOf: (el: Element) => Rect,
): string[] {
  const s = rectOf(section);
  const top = s.y + s.h / 2;
  let bottom = Number.POSITIVE_INFINITY;
  for (const el of canvas) {
    if (el.type !== 'section' || el.id === section.id || el.parent !== null) continue;
    const r = rectOf(el);
    if (r.y > top && r.x < s.x + s.w && r.x + r.w > s.x) bottom = Math.min(bottom, r.y);
  }
  return canvas
    .filter((el) => {
      if (el.parent !== null || el.locked || el.type === 'arrow' || el.type === 'section')
        return false;
      const r = rectOf(el);
      const cx = r.x + r.w / 2;
      return r.y >= top && r.y < bottom && cx >= s.x && cx <= s.x + s.w;
    })
    .map((el) => el.id);
}

export type NewElement<T extends ElementType = ElementType> = Omit<
  Extract<Element, { type: T }>,
  'id' | 'type' | 'x' | 'y' | 'w' | 'z' | 'parent' | 'createdBy' | 'createdAt'
> &
  Partial<Pick<Element, 'w' | 'parent'>>;

export function listElements(doc: Y.Doc): Element[] {
  const out: Element[] = [];
  for (const map of roots(doc).elements.values()) {
    const el = readElement(map);
    if (el) out.push(el);
  }
  return out;
}

const views = new WeakMap<Y.Doc, () => Element[] | null>();

/**
 * Lets the helpers below take the elements from a view that follows the document (the web
 * app's BoardStore) instead of reading and validating every element again (decision 0094).
 * `view` returns null while it may be behind the document. Returns the function that removes it.
 */
export function setElementView(doc: Y.Doc, view: () => Element[] | null): () => void {
  views.set(doc, view);
  return () => {
    if (views.get(doc) === view) views.delete(doc);
  };
}

/**
 * The valid elements of the document, from its view when it is current. Their order is not
 * the document's: helpers that depend on it call listElements.
 */
export function currentElements(doc: Y.Doc): Element[] {
  return views.get(doc)?.() ?? listElements(doc);
}

const byZ = (a: Element, b: Element) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1);

/** Elements placed directly on the canvas, in drawing order. */
export function canvasElements(elements: Element[]): Element[] {
  return elements.filter((e) => e.parent === null).sort(byZ);
}

/** Children of a column, or of UNSORTED, from top to bottom. */
export function childrenOf(elements: Element[], parent: string): Element[] {
  return elements.filter((e) => e.parent === parent).sort(byZ);
}

function isKey(z: unknown): z is string {
  if (typeof z !== 'string') return false;
  try {
    generateKeyBetween(z, null);
    return true;
  } catch {
    return false;
  }
}

/** A key after every sibling of `parent`. Ignores keys that are not valid fractional indexes. */
export function keyAtEnd(elements: Element[], parent: string | null): string {
  let max: string | null = null;
  for (const e of elements) {
    if (e.parent === parent && isKey(e.z) && (max === null || e.z > max)) max = e.z;
  }
  return generateKeyBetween(max, null);
}

export function keyAtStart(elements: Element[], parent: string | null): string {
  let min: string | null = null;
  for (const e of elements) {
    if (e.parent === parent && isKey(e.z) && (min === null || e.z < min)) min = e.z;
  }
  return generateKeyBetween(null, min);
}

/** `count` keys that slot in before the sibling at `index` (after the last one if past the end). */
export function keysAt(siblings: Element[], index: number, count: number): string[] {
  const valid = siblings.filter((s) => isKey(s.z));
  const before = index > 0 ? (valid[Math.min(index, valid.length) - 1]?.z ?? null) : null;
  const after = valid[index]?.z ?? null;
  return generateNKeysBetween(before, after, count);
}

function getMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return roots(doc).elements.get(id);
}

export function createElement<T extends ElementType>(
  doc: Y.Doc,
  type: T,
  at: Point,
  fields: NewElement<T>,
  opts: { userId: string | null; origin?: unknown },
): Element {
  const all = currentElements(doc);
  const parent = fields.parent ?? null;
  const element = {
    ...fields,
    type,
    id: newElementId(),
    x: Math.round(at.x),
    y: Math.round(at.y),
    w: fields.w ?? DEFAULT_WIDTH[type],
    z: keyAtEnd(all, parent),
    parent,
    createdBy: opts.userId,
    createdAt: Date.now(),
  } as Element;
  doc.transact(() => {
    const map = addElement(doc, element);
    if (element.type === 'image' && !map.has('strokes')) map.set('strokes', new Y.Array());
  }, opts.origin);
  return element;
}

type Patch = Partial<Omit<Element, 'id' | 'type'>> & Record<string, unknown>;

export function updateElement(doc: Y.Doc, id: string, patch: Patch, origin?: unknown): void {
  updateElements(doc, [{ id, patch }], origin);
}

export function updateElements(
  doc: Y.Doc,
  changes: Array<{ id: string; patch: Patch }>,
  origin?: unknown,
): void {
  doc.transact(() => {
    for (const { id, patch } of changes) {
      const map = getMap(doc, id);
      if (!map) continue;
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'id' || key === 'type') continue;
        if (value === undefined) map.delete(key);
        else if (map.get(key) !== value) map.set(key, value);
      }
    }
  }, origin);
}

/** Deletes elements; deleting a column or a scene deletes the cards inside it too. */
export function deleteElements(doc: Y.Doc, ids: Iterable<string>, origin?: unknown): void {
  const { elements } = roots(doc);
  const doomed = new Set(ids);
  for (const [id, map] of elements.entries()) {
    const parent = map.get('parent');
    if (typeof parent === 'string' && doomed.has(parent)) doomed.add(id);
  }
  // Variants of a plan that goes keep its Set: copied into them, the link dropped (0062).
  const orphans: Array<[Y.Map<unknown>, Y.Map<unknown>]> = [];
  for (const [id, map] of elements.entries()) {
    const base = map.get('variantOf');
    if (map.get('type') !== 'plan' || typeof base !== 'string') continue;
    const baseMap = elements.get(base);
    if (doomed.has(base) && !doomed.has(id) && baseMap) orphans.push([map, baseMap]);
  }
  doc.transact(() => {
    // From the stored base, so items and fields this build does not know go along (0101).
    for (const [variant, base] of orphans) {
      if (base.get('type') === 'plan') adoptBase(variant, planBaseOf(base));
      else variant.delete('variantOf');
    }
    for (const id of doomed) elements.delete(id);
  }, origin);
}

/**
 * Cards that copying or deleting `ids` would copy, delete or rewrite and that this build does
 * not fully understand (strict check, decision 0101): the cards themselves, the cards inside the
 * columns and scenes among them and the variants of the plans among them. Read from the stored
 * maps, so cards that do not validate, which no list shows, count too. A client refuses the
 * operation, or asks, when either list is not empty.
 */
export function foreignCardsIn(
  doc: Y.Doc,
  ids: Iterable<string>,
): { foreign: string[]; unreadable: string[] } {
  const { elements } = roots(doc);
  const picked = new Set(ids);
  const affected = new Set([...picked].filter((id) => elements.has(id)));
  for (const [id, map] of elements.entries()) {
    const parent = map.get('parent');
    const base = map.get('variantOf');
    if (
      (typeof parent === 'string' && picked.has(parent)) ||
      (typeof base === 'string' && picked.has(base))
    )
      affected.add(id);
  }
  const foreign: string[] = [];
  const unreadable: string[] = [];
  for (const id of affected) {
    const compat = checkCard(elements.get(id) as Y.Map<unknown>);
    if (compat.status === 'foreign') (compat.readable ? foreign : unreadable).push(id);
  }
  return { foreign, unreadable };
}

/** Places elements on the canvas at the given positions, on top of everything else. */
export function moveToCanvas(
  doc: Y.Doc,
  moves: Array<{ id: string; x: number; y: number }>,
  origin?: unknown,
): void {
  const all = currentElements(doc);
  const onCanvas = canvasElements(all);
  const keys = keysAt(onCanvas, onCanvas.length, moves.length);
  doc.transact(() => {
    moves.forEach((m, i) => {
      const map = getMap(doc, m.id);
      if (!map) return;
      map.set('x', Math.round(m.x));
      map.set('y', Math.round(m.y));
      if (map.get('parent') !== null) {
        map.set('parent', null);
        map.set('z', keys[i]);
      }
    });
  }, origin);
}

/**
 * Moves elements into a column (or UNSORTED) before the child at `index`, keeping their
 * relative order. Columns cannot be nested: they are skipped.
 */
export function moveIntoParent(
  doc: Y.Doc,
  ids: string[],
  parent: string,
  index: number,
  origin?: unknown,
): void {
  const all = currentElements(doc);
  const moving = new Set(
    ids.filter((id) => {
      const el = all.find((e) => e.id === id);
      return el && !isContainer(el) && el.id !== parent;
    }),
  );
  if (moving.size === 0) return;
  const siblings = childrenOf(all, parent);
  // Index among the siblings that stay, so moving within the same column works.
  const staying = siblings.filter((s) => !moving.has(s.id));
  const shift = siblings.slice(0, index).filter((s) => moving.has(s.id)).length;
  const at = Math.max(0, Math.min(staying.length, index - shift));
  const byId = new Map(all.map((e) => [e.id, e]));
  const ordered = [...moving].sort((a, b) => {
    const ea = byId.get(a);
    const eb = byId.get(b);
    if (!ea || !eb) return 0;
    return ea.parent === eb.parent ? byZ(ea, eb) : ea.y - eb.y || ea.x - eb.x;
  });
  const keys = keysAt(staying, at, ordered.length);
  doc.transact(() => {
    ordered.forEach((id, i) => {
      const map = getMap(doc, id);
      if (!map) return;
      map.set('parent', parent);
      map.set('z', keys[i]);
    });
  }, origin);
}

export function moveToUnsorted(doc: Y.Doc, ids: string[], origin?: unknown): void {
  const all = currentElements(doc);
  moveIntoParent(doc, ids, UNSORTED, childrenOf(all, UNSORTED).length, origin);
}

export function bringToFront(doc: Y.Doc, ids: string[], origin?: unknown): void {
  restack(doc, ids, 'front', origin);
}

export function sendToBack(doc: Y.Doc, ids: string[], origin?: unknown): void {
  restack(doc, ids, 'back', origin);
}

function restack(doc: Y.Doc, ids: string[], where: 'front' | 'back', origin?: unknown) {
  const all = currentElements(doc);
  const onCanvas = canvasElements(all);
  const moving = onCanvas.filter((e) => ids.includes(e.id));
  if (moving.length === 0) return;
  const rest = onCanvas.filter((e) => !ids.includes(e.id));
  const keys = keysAt(rest, where === 'front' ? rest.length : 0, moving.length);
  doc.transact(() => {
    for (const [i, e] of moving.entries()) getMap(doc, e.id)?.set('z', keys[i]);
  }, origin);
}

/** A card as stored: what copies need of it, read without validating the card. */
interface Stored {
  id: string;
  map: Y.Map<unknown>;
  type: unknown;
  parent: string | null;
  x: number;
  y: number;
}

function stored(id: string, map: Y.Map<unknown>): Stored {
  const parent = map.get('parent');
  const x = map.get('x');
  const y = map.get('y');
  return {
    id,
    map,
    type: map.get('type'),
    parent: typeof parent === 'string' ? parent : null,
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
  };
}

const isStoredContainer = (card: Stored) =>
  (CONTAINER_TYPES as readonly unknown[]).includes(card.type);

/**
 * The stored cards `ids` names, then the cards inside the columns and scenes among them, in the
 * document's order. Read from the maps, not through listElements, so a copy holds every card the
 * original holds, also those this build cannot validate (decision 0101).
 */
function storedSelection(doc: Y.Doc, ids: string[]): Stored[] {
  const wanted = new Set(ids);
  const all = [...roots(doc).elements.entries()].map(([id, map]) => stored(id, map));
  const picked = all.filter((card) => wanted.has(card.id));
  const containers = new Set(picked.filter(isStoredContainer).map((card) => card.id));
  const children = all.filter(
    (card) => card.parent !== null && containers.has(card.parent) && !wanted.has(card.id),
  );
  return [...picked, ...children];
}

/** Copies elements (and the cards inside copied columns). Returns the ids of the copies. */
export function duplicateElements(
  doc: Y.Doc,
  ids: string[],
  offset: Point,
  opts: { userId: string | null; origin?: unknown },
): string[] {
  const { elements } = roots(doc);
  const all = listElements(doc);
  const cards = storedSelection(doc, ids);
  const picked = new Set(ids);
  const fresh = new Map<string, string>();
  for (const card of cards) fresh.set(card.id, newElementId());

  const onCanvas = cards.filter((card) => picked.has(card.id) && card.parent === null);
  const canvasKeys = keysAt(canvasElements(all), canvasElements(all).length, onCanvas.length);
  const out: string[] = [];
  doc.transact(() => {
    for (const card of cards) {
      const source = card.map;
      const id = fresh.get(card.id) ?? newElementId();
      const copy = cloneMap(source);
      copy.set('id', id);
      copy.set('createdBy', opts.userId);
      copy.set('createdAt', Date.now());
      const parent = (card.parent && fresh.get(card.parent)) ?? card.parent;
      copy.set('parent', parent);
      // A to-do list copied with its scene follows the copy, as arrows follow their cards.
      const sceneId = source.get('sceneId');
      if (card.type === 'todo' && typeof sceneId === 'string' && fresh.has(sceneId))
        copy.set('sceneId', fresh.get(sceneId));
      // A plan copied with its base or its scenes follows their copies.
      if (card.type === 'plan') {
        const variantOf = source.get('variantOf');
        const sceneIds = source.get('sceneIds');
        if (typeof variantOf === 'string' && fresh.has(variantOf))
          copy.set('variantOf', fresh.get(variantOf));
        if (Array.isArray(sceneIds) && sceneIds.some((s) => fresh.has(s)))
          copy.set(
            'sceneIds',
            sceneIds.map((s) => fresh.get(s) ?? s),
          );
      }
      if (card.parent === null) {
        copy.set('x', Math.round(card.x + offset.x));
        copy.set('y', Math.round(card.y + offset.y));
        copy.set('z', canvasKeys[onCanvas.indexOf(card)]);
      } else if (!fresh.has(card.parent)) {
        // A card copied out of its column lands right below the original.
        const siblings = childrenOf(listElements(doc), card.parent);
        const index = siblings.findIndex((s) => s.id === card.id) + 1;
        copy.set('z', keysAt(siblings, index, 1)[0]);
      }
      if (picked.has(card.id)) out.push(id);
      elements.set(id, copy);
      // Its location and the frames and characters of its icons follow their copies too.
      if (card.type === 'plan') relinkStoredPlan(copy, (l) => fresh.get(l) ?? l);
    }
  }, opts.origin);
  return out;
}

/**
 * The links a plan holds to other cards (decision 0104): its location, and the frame a camera
 * shoots and the character an actor plays.
 */
const ICON_LINKS = ['frameId', 'characterId'] as const;

/**
 * Points the links of a stored plan at `target(id)`: the id to keep, or undefined to drop the
 * link. The map must be in a document, so its lists can be read.
 */
function relinkStoredPlan(copy: Y.Map<unknown>, target: (id: string) => string | undefined): void {
  const relink = (map: Y.Map<unknown>, key: string) => {
    const id = map.get(key);
    if (typeof id !== 'string') return;
    const next = target(id);
    if (next === undefined) map.delete(key);
    else if (next !== id) map.set(key, next);
  };
  relink(copy, 'locationId');
  const icons = copy.get('icons');
  if (icons instanceof Y.Array)
    for (const icon of icons.toArray())
      if (icon instanceof Y.Map) for (const key of ICON_LINKS) relink(icon, key);
}

function cloneMap(map: Y.Map<unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of map.entries()) m.set(k, v instanceof Y.AbstractType ? cloneType(v) : v);
  return m;
}

function cloneType(value: Y.AbstractType<unknown>): unknown {
  if (value instanceof Y.XmlFragment) return value.clone();
  if (value instanceof Y.Array) {
    return Y.Array.from(
      value.toArray().map((v) => (v instanceof Y.AbstractType ? cloneType(v) : v)),
    );
  }
  if (value instanceof Y.Map) return cloneMap(value);
  // Any other shared type, such as one a newer schema adds, is copied as it is (decision 0101).
  return value.clone();
}

// To-do items ----------------------------------------------------------------

function todoItems(doc: Y.Doc, id: string): Y.Array<Y.Map<unknown>> | null {
  const items = getMap(doc, id)?.get('items');
  return items instanceof Y.Array ? (items as Y.Array<Y.Map<unknown>>) : null;
}

export function addTodoItem(
  doc: Y.Doc,
  id: string,
  text: string,
  index?: number,
  origin?: unknown,
): string | null {
  const items = todoItems(doc, id);
  if (!items) return null;
  const itemId = newElementId();
  doc.transact(() => {
    const item = new Y.Map<unknown>([
      ['id', itemId],
      ['text', text],
      ['done', false],
    ]);
    items.insert(Math.min(index ?? items.length, items.length), [item]);
  }, origin);
  return itemId;
}

export function updateTodoItem(
  doc: Y.Doc,
  id: string,
  itemId: string,
  patch: { text?: string; done?: boolean; assigneeId?: string | null; dueDate?: string | null },
  origin?: unknown,
): void {
  const items = todoItems(doc, id);
  if (!items) return;
  doc.transact(() => {
    for (const item of items) {
      if (item.get('id') !== itemId) continue;
      if (patch.text !== undefined) item.set('text', patch.text);
      if (patch.done !== undefined) item.set('done', patch.done);
      for (const key of ['assigneeId', 'dueDate'] as const) {
        if (patch[key] === null) item.delete(key);
        else if (patch[key] !== undefined) item.set(key, patch[key]);
      }
    }
  }, origin);
}

export function removeTodoItem(doc: Y.Doc, id: string, itemId: string, origin?: unknown): void {
  const items = todoItems(doc, id);
  if (!items) return;
  doc.transact(() => {
    const index = items.toArray().findIndex((item) => item.get('id') === itemId);
    if (index >= 0) items.delete(index, 1);
  }, origin);
}

// Clipboard ------------------------------------------------------------------

/** Where a copy comes from (decision 0101). */
export interface ClipboardSource {
  /** `meta.boardId` of the document copied from. */
  boardId: string;
  /** `meta.schemaVersion` of that document. */
  schemaVersion: number;
  /** The server it lives on, as the copying client names it (the web app: its origin). */
  instance?: string;
}

/**
 * Elements copied to the clipboard, with note bodies as Yjs updates. The format crosses tabs,
 * versions and servers, so it only grows; readers ignore what they do not know. `source` and
 * `cards` (decision 0101): where the copy comes from, and, as Yjs updates, the cards the copying
 * build does not fully understand, which `elements` leaves out or strips.
 */
export interface ClipboardData {
  version: 1;
  elements: Element[];
  bodies: Record<string, string>;
  /** The Set of the base of each copied plan variant, for a board that lacks its base. */
  planBases?: Record<string, PlanBase>;
  source?: ClipboardSource;
  /** By card id, a Yjs update of a document holding the card's Y.Map under `card` in `m`. */
  cards?: Record<string, string>;
}

/** A paste refused as a whole: nothing was written. */
export class PasteRefusedError extends Error {
  constructor(
    /** `newer`: content of a newer schema this build cannot paste here; `invalid`: malformed. */
    readonly reason: 'newer' | 'invalid',
  ) {
    super(
      reason === 'newer'
        ? 'The clipboard holds content of a newer schema.'
        : 'Malformed clipboard.',
    );
  }
}

/** The new top-level ids, and the copied cards left out because they do not validate. */
export interface PasteResult {
  ids: string[];
  skipped: number;
}

export function copyElements(
  doc: Y.Doc,
  ids: string[],
  opts: { instance?: string } = {},
): ClipboardData {
  const byId = new Map(listElements(doc).map((e) => [e.id, e]));
  const copied = storedSelection(doc, ids);
  // An actor carries the name of the character it plays as its label, so it still reads the
  // same pasted where that character is not (decision 0104).
  const elements = copied
    .flatMap((card) => byId.get(card.id) ?? [])
    .map((e) =>
      e.type === 'plan' && e.icons?.some((i) => i.characterId)
        ? {
            ...e,
            icons: e.icons.map((i) =>
              i.characterId ? { ...unlinkCharacter(i, byId), characterId: i.characterId } : i,
            ),
          }
        : e,
    );
  const bodies: Record<string, string> = {};
  for (const e of elements) {
    const body = getMap(doc, e.id)?.get('body');
    if (!(body instanceof Y.XmlFragment)) continue;
    bodies[e.id] = encodeShared('body', body.clone());
  }
  const planBases: Record<string, PlanBase> = {};
  for (const card of copied) {
    const baseId = card.map.get('variantOf');
    const base = typeof baseId === 'string' ? getMap(doc, baseId) : undefined;
    if (card.type === 'plan' && base?.get('type') === 'plan') planBases[card.id] = planBaseOf(base);
  }
  // Only what `elements` would lose: cards this build understands travel as elements alone.
  const cards: Record<string, string> = {};
  for (const card of copied)
    if (checkCard(card.map).status === 'foreign')
      cards[card.id] = encodeShared('card', cloneMap(card.map));
  const boardId = roots(doc).meta.get('boardId');
  return {
    version: 1,
    elements,
    bodies,
    ...(Object.keys(planBases).length ? { planBases } : {}),
    source: {
      boardId: typeof boardId === 'string' ? boardId : '',
      schemaVersion: getSchemaVersion(doc),
      ...(opts.instance ? { instance: opts.instance } : {}),
    },
    ...(Object.keys(cards).length ? { cards } : {}),
  };
}

function encodeShared(key: string, value: Y.Map<unknown> | Y.XmlFragment): string {
  const tmp = new Y.Doc();
  tmp.getMap('m').set(key, value);
  return toBase64(Y.encodeStateAsUpdate(tmp));
}

/** What a clipboard update holds under `key`, or null when it does not decode. */
function decodeShared(key: string, update: unknown): unknown {
  if (typeof update !== 'string') return null;
  try {
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, fromBase64(update));
    return tmp.getMap('m').get(key) ?? null;
  } catch {
    return null;
  }
}

/** A card of the clipboard, checked: its validated view, or its Y.Map to paste as stored. */
type Clip = { id: string; parent: string | null; x: number; y: number } & (
  | { element: Element; body: Y.XmlFragment | null }
  | { stored: Y.Map<unknown> }
);

/**
 * Reads and checks the clipboard before anything is written (it is outside data). A card this
 * build understands, or one that is not from a newer schema, goes through the validated view
 * as it always did; one that does not validate, in `elements` or `cards`, is left out and
 * counted. A card of a newer schema that this build does not understand is pasted as stored only
 * on a board of a newer schema than this build, at least as new as the copy, within its lineage
 * (the same board or the same server); elsewhere the paste is refused (decision 0101).
 */
function readClipboard(
  doc: Y.Doc,
  data: ClipboardData,
  instance: string | undefined,
): { clips: Clip[]; skipped: number } {
  const invalid = () => new PasteRefusedError('invalid');
  if (typeof data !== 'object' || data === null || !Array.isArray(data.elements)) throw invalid();
  const { source } = data;
  const newer =
    typeof source?.schemaVersion === 'number' && source.schemaVersion > CURRENT_SCHEMA_VERSION;
  // Pasting as stored is for an older build on a board of a newer schema, at least as new as
  // the copy's: the board's own version decides, never the clipboard, which anyone can write
  // (a web page puts it in copied HTML). On a board of this build's schema it is never open.
  const version = getSchemaVersion(doc);
  const asStored =
    newer &&
    version > CURRENT_SCHEMA_VERSION &&
    version >= (source?.schemaVersion as number) &&
    ((typeof source?.boardId === 'string' && source.boardId === roots(doc).meta.get('boardId')) ||
      (!!instance && source?.instance === instance));
  const stored = new Map<string, Y.Map<unknown>>();
  if (data.cards !== undefined) {
    if (typeof data.cards !== 'object' || data.cards === null) throw invalid();
    for (const [id, update] of Object.entries(data.cards)) {
      const map = decodeShared('card', update);
      if (!(map instanceof Y.Map)) throw invalid();
      stored.set(id, map);
    }
  }
  const plain = new Map<unknown, unknown>(
    data.elements.map((e) => [typeof e === 'object' && e !== null ? e.id : undefined, e]),
  );
  const clips: Clip[] = [];
  let skipped = 0;
  for (const id of new Set([...plain.keys(), ...stored.keys()])) {
    if (typeof id !== 'string') throw invalid();
    const map = stored.get(id);
    const element = plain.get(id) as Record<string, unknown> | undefined;
    const fromMap = map?.get('body');
    const body =
      fromMap instanceof Y.XmlFragment
        ? fromMap
        : (decodeShared('body', data.bodies?.[id]) as Y.XmlFragment | null);
    const compat = map
      ? checkCard(map)
      : newer && element
        ? checkElement(element, body instanceof Y.XmlFragment ? body : undefined)
        : null;
    if (compat?.status === 'foreign' && newer) {
      if (!compat.readable || !map || !asStored || !hasStoredShape(map))
        throw new PasteRefusedError('newer');
      clips.push({ ...place(id, map.get('parent'), map.get('x'), map.get('y')), stored: map });
      continue;
    }
    // Not from a newer schema: a card that does not validate is left out, as it always was.
    if (compat?.status === 'foreign' && !compat.readable) {
      skipped += 1;
      continue;
    }
    const parsed = Element.safeParse(map ? readElement(map) : element);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const e = parsed.data;
    clips.push({
      ...place(id, e.parent, e.x, e.y),
      element: e,
      body: body instanceof Y.XmlFragment ? body : null,
    });
  }
  return { clips, skipped };
}

function place(id: string, parent: unknown, x: unknown, y: unknown) {
  return {
    id,
    parent: typeof parent === 'string' ? parent : null,
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
  };
}

/** The Set of a base from the clipboard, checked like the plan's own fields; null if malformed. */
function clipboardBase(base: unknown): PlanBase | null {
  if (typeof base !== 'object' || base === null) return null;
  const b = base as Record<string, unknown>;
  const list = (value: unknown, max: number) =>
    Array.isArray(value) &&
    value.length <= max &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        Object.getPrototypeOf(item) === Object.prototype,
    );
  if (
    !list(b.strokes, MAX_STROKES) ||
    !list(b.shapes, MAX_SHAPES) ||
    !list(b.icons, MAX_PLAN_ICONS) ||
    // Walls and openings since version 23; a base copied by an older build has none.
    (b.walls !== undefined && !list(b.walls, MAX_PLAN_WALLS)) ||
    (b.openings !== undefined && !list(b.openings, MAX_PLAN_OPENINGS))
  )
    return null;
  for (const key of ['scale', 'grid', 'rulers'] as const)
    if (!PlanElement.shape[key].safeParse(b[key]).success) return null;
  return b as unknown as PlanBase;
}

/**
 * Pastes copied elements with their top-left corner at `at`, all or nothing: every copy is
 * built and checked before the one transaction that writes them. Throws PasteRefusedError.
 * `instance` names the server of the board, as `copyElements` was given it.
 */
export function pasteElements(
  doc: Y.Doc,
  data: ClipboardData,
  at: Point,
  opts: { userId: string | null; origin?: unknown; instance?: string },
): PasteResult {
  const { clips, skipped } = readClipboard(doc, data, opts.instance);
  const all = listElements(doc);
  const here = new Set(all.map((e) => e.id));
  const fresh = new Map<string, string>();
  for (const clip of clips) fresh.set(clip.id, newElementId());
  const pasted = new Set(fresh.values());
  // Everything that was not inside a copied column lands on the canvas.
  const placed = clips.filter((c) => !(c.parent && fresh.has(c.parent)));
  const free = placed.filter((c) => c.parent === null);
  const minX = free.length ? Math.min(...free.map((c) => c.x)) : 0;
  const minY = free.length ? Math.min(...free.map((c) => c.y)) : 0;
  const keys = keysAt(canvasElements(all), canvasElements(all).length, placed.length);
  const out: string[] = [];
  /** The base a variant takes along to a board without its own; checked, or the paste fails. */
  const baseFor = (clipId: string): PlanBase | undefined => {
    const raw = data.planBases?.[clipId];
    if (raw === undefined) return undefined;
    const base = clipboardBase(raw);
    if (!base) throw new PasteRefusedError('invalid');
    return base;
  };
  const writes = clips.map((clip): Write => {
    const id = fresh.get(clip.id) ?? newElementId();
    const copiedParent = clip.parent === null ? undefined : fresh.get(clip.parent);
    const onCanvas = copiedParent === undefined;
    const x = onCanvas ? Math.round(at.x + (clip.parent === null ? clip.x - minX : 0)) : clip.x;
    const y = onCanvas ? Math.round(at.y + (clip.parent === null ? clip.y - minY : 0)) : clip.y;
    const z = onCanvas ? (keys[placed.indexOf(clip)] ?? keyAtEnd(all, null)) : undefined;
    if (onCanvas) out.push(id);
    const fields = { id, x, y, z, parent: copiedParent ?? null };
    return 'stored' in clip
      ? { id, stored: storedCopy(clip, fields, here, pasted, fresh, baseFor, opts.userId) }
      : elementCopy(clip, fields, here, pasted, fresh, baseFor, opts.userId);
  });
  doc.transact(() => {
    for (const write of writes) {
      if ('stored' in write) {
        roots(doc).elements.set(write.id, cloneMap(write.stored));
        continue;
      }
      const map = addElement(doc, write.element);
      if (write.body) map.set('body', write.body.clone());
    }
  }, opts.origin);
  return { ids: out, skipped };
}

type Write =
  | { id: string; stored: Y.Map<unknown> }
  | { element: Element; body: Y.XmlFragment | null };

type CopyFields = {
  id: string;
  x: number;
  y: number;
  z: string | undefined;
  parent: string | null;
};

/** The copy of a card through its validated view, as pasting always worked; parsed here. */
function elementCopy(
  clip: Clip & { element: Element; body: Y.XmlFragment | null },
  fields: CopyFields,
  here: Set<string>,
  pasted: Set<string>,
  fresh: Map<string, string>,
  baseFor: (id: string) => PlanBase | undefined,
  userId: string | null,
): { element: Element; body: Y.XmlFragment | null } {
  const e = clip.element;
  const { x, y } = fields;
  const copy: Element = {
    ...e,
    id: fields.id,
    createdBy: userId,
    createdAt: Date.now(),
    parent: fields.parent,
    x,
    y,
    z: fields.z ?? e.z,
  };
  if (copy.type === 'todo' && copy.sceneId) copy.sceneId = fresh.get(copy.sceneId) ?? copy.sceneId;
  if (copy.type === 'plan') {
    // Scenes: the copies of scenes pasted with it, or those of this board; others go.
    const scenes = (copy.sceneIds ?? [])
      .map((s) => fresh.get(s) ?? s)
      .filter((s) => here.has(s) || pasted.has(s));
    if (scenes.length) copy.sceneIds = scenes;
    else delete copy.sceneIds;
    // A variant follows the copy of its base, or its base on this board; on a board
    // without it, it stands alone with the base's Set (decision 0062).
    if (copy.variantOf && fresh.has(copy.variantOf)) copy.variantOf = fresh.get(copy.variantOf);
    else if (copy.variantOf && !here.has(copy.variantOf)) {
      const base = baseFor(clip.id);
      delete copy.variantOf;
      if (base) {
        copy.strokes = [...base.strokes, ...(copy.strokes ?? [])];
        copy.shapes = [...base.shapes, ...(copy.shapes ?? [])];
        copy.icons = [...base.icons, ...(copy.icons ?? [])];
        if (base.walls?.length) copy.walls = [...base.walls, ...(copy.walls ?? [])];
        if (base.openings?.length) copy.openings = [...base.openings, ...(copy.openings ?? [])];
        if (base.scale && !copy.scale)
          Object.assign(copy, { scale: base.scale, grid: base.grid, rulers: base.rulers });
      }
    }
    // Its location and the frames and characters of its icons: their copies, or the cards of
    // this board; a link to a card that is not here goes, the icon keeping its label.
    const link = (l: string) => fresh.get(l) ?? (here.has(l) ? l : undefined);
    const location = copy.locationId && link(copy.locationId);
    if (location) copy.locationId = location;
    else delete copy.locationId;
    if (copy.icons)
      copy.icons = copy.icons.map((icon) => {
        const out = { ...icon };
        for (const key of ICON_LINKS) {
          const target = out[key] && link(out[key]);
          if (target) out[key] = target;
          else delete out[key];
        }
        return out;
      });
  }
  if (copy.type === 'arrow') {
    // Ends move with the arrow; an attached end follows the copy of its card when the
    // card was copied too, else the original card.
    const end = (p: typeof copy.from) => {
      const elementId = p.elementId && (fresh.get(p.elementId) ?? p.elementId);
      const moved = { x: p.x + x - e.x, y: p.y + y - e.y };
      return elementId ? { ...moved, elementId } : moved;
    };
    copy.from = end(copy.from);
    copy.to = end(copy.to);
  }
  const parsed = Element.safeParse(copy);
  if (!parsed.success) throw new PasteRefusedError('invalid');
  return { element: parsed.data, body: clip.body };
}

/**
 * The copy of a card as stored, with the same placement and links, built and checked in a
 * scratch document: a Y.Map not yet in a document cannot be read back.
 */
function storedCopy(
  clip: Clip & { stored: Y.Map<unknown> },
  fields: CopyFields,
  here: Set<string>,
  pasted: Set<string>,
  fresh: Map<string, string>,
  baseFor: (id: string) => PlanBase | undefined,
  userId: string | null,
): Y.Map<unknown> {
  const source = clip.stored;
  const copy = cloneMap(source);
  new Y.Doc().getMap('m').set('card', copy);
  const type = source.get('type');
  copy.set('id', fields.id);
  copy.set('createdBy', userId);
  copy.set('createdAt', Date.now());
  copy.set('parent', fields.parent);
  copy.set('x', fields.x);
  copy.set('y', fields.y);
  if (fields.z !== undefined) copy.set('z', fields.z);
  const sceneId = source.get('sceneId');
  if (type === 'todo' && typeof sceneId === 'string')
    copy.set('sceneId', fresh.get(sceneId) ?? sceneId);
  if (type === 'arrow') {
    // Ends move as above; other fields of an end stay.
    for (const key of ['from', 'to'] as const) {
      const end = source.get(key) as Record<string, unknown>;
      const elementId =
        typeof end.elementId === 'string' ? (fresh.get(end.elementId) ?? end.elementId) : null;
      const { elementId: _, ...rest } = end;
      const moved = {
        ...rest,
        x: (end.x as number) + fields.x - clip.x,
        y: (end.y as number) + fields.y - clip.y,
      };
      copy.set(key, elementId ? { ...moved, elementId } : moved);
    }
  }
  if (type === 'plan') {
    const sceneIds = source.get('sceneIds');
    const scenes = (Array.isArray(sceneIds) ? sceneIds : [])
      .map((s) => fresh.get(s) ?? s)
      .filter((s) => here.has(s) || pasted.has(s));
    if (scenes.length) copy.set('sceneIds', scenes);
    else copy.delete('sceneIds');
    const variantOf = source.get('variantOf');
    if (typeof variantOf === 'string' && fresh.has(variantOf))
      copy.set('variantOf', fresh.get(variantOf));
    else if (typeof variantOf === 'string' && !here.has(variantOf)) {
      const base = baseFor(clip.id);
      if (base) adoptBase(copy, base);
      else copy.delete('variantOf');
    }
    relinkStoredPlan(copy, (l) => fresh.get(l) ?? (here.has(l) ? l : undefined));
  }
  // As addElement creates them, so two people drawing on the copy add to the same lists.
  const lists =
    type === 'frame'
      ? ['strokes', 'shapes']
      : type === 'plan'
        ? ['strokes', 'shapes', 'icons', 'walls', 'openings']
        : [];
  for (const key of lists) if (!copy.has(key)) copy.set(key, new Y.Array());
  // A variant with its base's Set within the plan's limits, as the validated paste cuts it.
  if (type === 'plan')
    for (const [key, max] of [
      ['strokes', MAX_STROKES],
      ['shapes', MAX_SHAPES],
      ['icons', MAX_PLAN_ICONS],
      ['walls', MAX_PLAN_WALLS],
      ['openings', MAX_PLAN_OPENINGS],
    ] as const) {
      const list = copy.get(key);
      if (list instanceof Y.Array && list.length > max) list.delete(max, list.length - max);
    }
  if (!readElement(copy) || !hasStoredShape(copy)) throw new PasteRefusedError('newer');
  return copy;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
