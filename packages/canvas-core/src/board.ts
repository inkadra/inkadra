// SPDX-License-Identifier: MPL-2.0
import {
  addElement,
  CONTAINER_TYPES,
  checkCard,
  type Element,
  type ElementType,
  newElementId,
  readElement,
  roots,
  UNSORTED,
} from '@inkadra/doc-schema';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import type { Point, Rect } from './geometry.ts';
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
    for (const [variant, base] of orphans) adoptBase(variant, planBaseOf(base));
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
    }
  }, opts.origin);
  return out;
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

/**
 * Elements copied to the clipboard. The format crosses tabs and versions, so it only grows:
 * `cards` (decision 0101) carries every card as stored, unknown fields, list items and note
 * nodes included, and readers that know it paste from it alone; older readers paste `elements`,
 * the validated view, with note bodies as Yjs updates in `bodies`.
 */
export interface ClipboardData {
  version: 1;
  elements: Element[];
  bodies: Record<string, string>;
  /** The Set of the base of each copied plan variant, for a board that lacks its base. */
  planBases?: Record<string, PlanBase>;
  /** Each copied card's Y.Map, as a Yjs update of a document holding it under `card` in `m`. */
  cards?: Array<{ id: string; update: string }>;
}

export function copyElements(doc: Y.Doc, ids: string[]): ClipboardData {
  const byId = new Map(listElements(doc).map((e) => [e.id, e]));
  const cards = storedSelection(doc, ids);
  const elements = cards.flatMap((card) => byId.get(card.id) ?? []);
  const bodies: Record<string, string> = {};
  for (const e of elements) {
    const body = getMap(doc, e.id)?.get('body');
    if (!(body instanceof Y.XmlFragment)) continue;
    bodies[e.id] = encodeShared('body', body.clone());
  }
  const planBases: Record<string, PlanBase> = {};
  for (const card of cards) {
    const baseId = card.map.get('variantOf');
    const base = typeof baseId === 'string' ? getMap(doc, baseId) : undefined;
    if (card.type === 'plan' && base?.get('type') === 'plan') planBases[card.id] = planBaseOf(base);
  }
  return {
    version: 1,
    elements,
    bodies,
    ...(Object.keys(planBases).length ? { planBases } : {}),
    cards: cards.map((card) => ({
      id: card.id,
      update: encodeShared('card', cloneMap(card.map)),
    })),
  };
}

function encodeShared(key: string, value: Y.Map<unknown> | Y.XmlFragment): string {
  const tmp = new Y.Doc();
  tmp.getMap('m').set(key, value);
  return toBase64(Y.encodeStateAsUpdate(tmp));
}

function decodeShared(key: string, update: string): unknown {
  const tmp = new Y.Doc();
  Y.applyUpdate(tmp, fromBase64(update));
  return tmp.getMap('m').get(key);
}

/**
 * The cards of the clipboard as stored, or null for a clipboard without them (an older build or
 * another source). Throws when one does not decode or does not validate: the clipboard is
 * outside data, checked as `addElement` checks the elements of an older clipboard.
 */
function clipboardCards(data: ClipboardData): Stored[] | null {
  if (!Array.isArray(data.cards)) return null;
  return data.cards.map(({ id, update }) => {
    const map = typeof update === 'string' ? decodeShared('card', update) : null;
    if (!(map instanceof Y.Map) || typeof id !== 'string' || !readElement(map))
      throw new Error('A copied card does not match the schema.');
    return stored(id, map);
  });
}

/** Pastes copied elements with their top-left corner at `at`. Returns the new top-level ids. */
export function pasteElements(
  doc: Y.Doc,
  data: ClipboardData,
  at: Point,
  opts: { userId: string | null; origin?: unknown },
): string[] {
  const cards = clipboardCards(data);
  if (cards) return pasteStored(doc, cards, data.planBases, at, opts);
  const all = listElements(doc);
  const fresh = new Map<string, string>();
  for (const e of data.elements) fresh.set(e.id, newElementId());
  // Everything that was not inside a copied column lands on the canvas.
  const placed = data.elements.filter((e) => !(e.parent && fresh.has(e.parent)));
  const free = placed.filter((e) => e.parent === null);
  const minX = free.length ? Math.min(...free.map((e) => e.x)) : 0;
  const minY = free.length ? Math.min(...free.map((e) => e.y)) : 0;
  const keys = keysAt(canvasElements(all), canvasElements(all).length, placed.length);
  const out: string[] = [];
  doc.transact(() => {
    for (const e of data.elements) {
      const id = fresh.get(e.id) ?? newElementId();
      const copiedParent = e.parent === null ? undefined : fresh.get(e.parent);
      const onCanvas = copiedParent === undefined;
      const x = onCanvas ? Math.round(at.x + (e.parent === null ? e.x - minX : 0)) : e.x;
      const y = onCanvas ? Math.round(at.y + (e.parent === null ? e.y - minY : 0)) : e.y;
      const copy: Element = {
        ...e,
        id,
        createdBy: opts.userId,
        createdAt: Date.now(),
        parent: copiedParent ?? null,
        x,
        y,
        z: onCanvas ? (keys[placed.indexOf(e)] ?? keyAtEnd(all, null)) : e.z,
      };
      if (copy.type === 'todo' && copy.sceneId)
        copy.sceneId = fresh.get(copy.sceneId) ?? copy.sceneId;
      if (copy.type === 'plan') {
        // Scenes: the copies of scenes pasted with it, or those of this board; others go.
        const here = new Set(all.map((x) => x.id));
        const scenes = (copy.sceneIds ?? [])
          .map((s) => fresh.get(s) ?? s)
          .filter((s) => here.has(s) || [...fresh.values()].includes(s));
        if (scenes.length) copy.sceneIds = scenes;
        else delete copy.sceneIds;
        // A variant follows the copy of its base, or its base on this board; on a board
        // without it, it stands alone with the base's Set (decision 0062).
        if (copy.variantOf && fresh.has(copy.variantOf)) copy.variantOf = fresh.get(copy.variantOf);
        else if (copy.variantOf && !here.has(copy.variantOf)) {
          const base = data.planBases?.[e.id];
          delete copy.variantOf;
          if (base) {
            copy.strokes = [...base.strokes, ...(copy.strokes ?? [])];
            copy.shapes = [...base.shapes, ...(copy.shapes ?? [])];
            copy.icons = [...base.icons, ...(copy.icons ?? [])];
            if (base.scale && !copy.scale)
              Object.assign(copy, { scale: base.scale, grid: base.grid, rulers: base.rulers });
          }
        }
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
      const map = addElement(doc, copy);
      const body = data.bodies[e.id];
      if (body) {
        const tmp = new Y.Doc();
        Y.applyUpdate(tmp, fromBase64(body));
        const fragment = tmp.getMap('m').get('body');
        if (fragment instanceof Y.XmlFragment) map.set('body', fragment.clone());
      }
      if (onCanvas) out.push(id);
    }
  }, opts.origin);
  return out;
}

/**
 * Pastes stored cards as they are (decision 0101), with the placement and the links of the
 * paste of elements below: fields this build does not know stay in the copies.
 */
function pasteStored(
  doc: Y.Doc,
  cards: Stored[],
  planBases: ClipboardData['planBases'],
  at: Point,
  opts: { userId: string | null; origin?: unknown },
): string[] {
  const { elements } = roots(doc);
  const all = listElements(doc);
  const here = new Set(all.map((e) => e.id));
  const fresh = new Map<string, string>();
  for (const card of cards) fresh.set(card.id, newElementId());
  const pasted = new Set(fresh.values());
  // Everything that was not inside a copied column lands on the canvas.
  const placed = cards.filter((card) => !(card.parent && fresh.has(card.parent)));
  const free = placed.filter((card) => card.parent === null);
  const minX = free.length ? Math.min(...free.map((card) => card.x)) : 0;
  const minY = free.length ? Math.min(...free.map((card) => card.y)) : 0;
  const keys = keysAt(canvasElements(all), canvasElements(all).length, placed.length);
  const out: string[] = [];
  doc.transact(() => {
    for (const card of cards) {
      const source = card.map;
      const id = fresh.get(card.id) ?? newElementId();
      const copiedParent = card.parent === null ? undefined : fresh.get(card.parent);
      const onCanvas = copiedParent === undefined;
      const x = onCanvas ? Math.round(at.x + (card.parent === null ? card.x - minX : 0)) : card.x;
      const y = onCanvas ? Math.round(at.y + (card.parent === null ? card.y - minY : 0)) : card.y;
      const copy = cloneMap(source);
      copy.set('id', id);
      copy.set('createdBy', opts.userId);
      copy.set('createdAt', Date.now());
      copy.set('parent', copiedParent ?? null);
      copy.set('x', x);
      copy.set('y', y);
      if (onCanvas) copy.set('z', keys[placed.indexOf(card)] ?? keyAtEnd(all, null));
      const sceneId = source.get('sceneId');
      if (card.type === 'todo' && typeof sceneId === 'string')
        copy.set('sceneId', fresh.get(sceneId) ?? sceneId);
      if (card.type === 'arrow') {
        // Ends move with the arrow; an attached end follows the copy of its card when the
        // card was copied too, else the original card. Other fields of an end stay.
        for (const key of ['from', 'to'] as const) {
          const end = source.get(key) as Record<string, unknown>;
          const elementId =
            typeof end.elementId === 'string' ? (fresh.get(end.elementId) ?? end.elementId) : null;
          const { elementId: _, ...rest } = end;
          const moved = {
            ...rest,
            x: (end.x as number) + x - card.x,
            y: (end.y as number) + y - card.y,
          };
          copy.set(key, elementId ? { ...moved, elementId } : moved);
        }
      }
      let base: PlanBase | undefined;
      if (card.type === 'plan') {
        // Scenes: the copies of scenes pasted with it, or those of this board; others go.
        const sceneIds = source.get('sceneIds');
        const scenes = (Array.isArray(sceneIds) ? sceneIds : [])
          .map((s) => fresh.get(s) ?? s)
          .filter((s) => here.has(s) || pasted.has(s));
        if (scenes.length) copy.set('sceneIds', scenes);
        else copy.delete('sceneIds');
        // A variant follows the copy of its base, or its base on this board; on a board
        // without it, it stands alone with the base's Set (decision 0062).
        const variantOf = source.get('variantOf');
        if (typeof variantOf === 'string' && fresh.has(variantOf))
          copy.set('variantOf', fresh.get(variantOf));
        else if (typeof variantOf === 'string' && !here.has(variantOf)) {
          copy.delete('variantOf');
          base = planBases?.[card.id];
        }
      }
      elements.set(id, copy);
      // Once stored: a Y.Map not yet in a document cannot be read back.
      if (base) adoptBase(copy, base);
      if (onCanvas) out.push(id);
    }
  }, opts.origin);
  return out;
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
