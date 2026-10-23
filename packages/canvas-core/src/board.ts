// SPDX-License-Identifier: MPL-2.0
import {
  addElement,
  type Element,
  type ElementType,
  newElementId,
  readElement,
  roots,
  UNSORTED,
} from '@inkadra/doc-schema';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import type { Point } from './geometry.ts';

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
  board: 140,
  scene: 260,
  frame: 240,
  arrow: 1,
};

export const MIN_WIDTH = 80;

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
  const all = listElements(doc);
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
  doc.transact(() => addElement(doc, element), opts.origin);
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

/** Deletes elements; deleting a column deletes the cards inside it too. */
export function deleteElements(doc: Y.Doc, ids: Iterable<string>, origin?: unknown): void {
  const { elements } = roots(doc);
  const doomed = new Set(ids);
  for (const [id, map] of elements.entries()) {
    const parent = map.get('parent');
    if (typeof parent === 'string' && doomed.has(parent)) doomed.add(id);
  }
  doc.transact(() => {
    for (const id of doomed) elements.delete(id);
  }, origin);
}

/** Places elements on the canvas at the given positions, on top of everything else. */
export function moveToCanvas(
  doc: Y.Doc,
  moves: Array<{ id: string; x: number; y: number }>,
  origin?: unknown,
): void {
  const all = listElements(doc);
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
  const all = listElements(doc);
  const moving = new Set(
    ids.filter((id) => {
      const el = all.find((e) => e.id === id);
      return el && el.type !== 'column' && el.id !== parent;
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
  const all = listElements(doc);
  moveIntoParent(doc, ids, UNSORTED, childrenOf(all, UNSORTED).length, origin);
}

export function bringToFront(doc: Y.Doc, ids: string[], origin?: unknown): void {
  restack(doc, ids, 'front', origin);
}

export function sendToBack(doc: Y.Doc, ids: string[], origin?: unknown): void {
  restack(doc, ids, 'back', origin);
}

function restack(doc: Y.Doc, ids: string[], where: 'front' | 'back', origin?: unknown) {
  const all = listElements(doc);
  const onCanvas = canvasElements(all);
  const moving = onCanvas.filter((e) => ids.includes(e.id));
  if (moving.length === 0) return;
  const rest = onCanvas.filter((e) => !ids.includes(e.id));
  const keys = keysAt(rest, where === 'front' ? rest.length : 0, moving.length);
  doc.transact(() => {
    for (const [i, e] of moving.entries()) getMap(doc, e.id)?.set('z', keys[i]);
  }, origin);
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
  const picked = all.filter((e) => ids.includes(e.id));
  const fresh = new Map<string, string>();
  for (const e of picked) fresh.set(e.id, newElementId());
  const children = all.filter((e) => e.parent && fresh.has(e.parent) && !fresh.has(e.id));
  for (const e of children) fresh.set(e.id, newElementId());

  const onCanvas = picked.filter((e) => e.parent === null);
  const canvasKeys = keysAt(canvasElements(all), canvasElements(all).length, onCanvas.length);
  const out: string[] = [];
  doc.transact(() => {
    for (const e of [...picked, ...children]) {
      const source = elements.get(e.id);
      if (!source) continue;
      const id = fresh.get(e.id) ?? newElementId();
      const copy = new Y.Map<unknown>();
      for (const [key, value] of source.entries()) {
        if (value instanceof Y.AbstractType) copy.set(key, cloneType(value));
        else copy.set(key, value);
      }
      copy.set('id', id);
      copy.set('createdBy', opts.userId);
      copy.set('createdAt', Date.now());
      const parent = (e.parent && fresh.get(e.parent)) ?? e.parent;
      copy.set('parent', parent);
      if (e.parent === null) {
        copy.set('x', Math.round(e.x + offset.x));
        copy.set('y', Math.round(e.y + offset.y));
        copy.set('z', canvasKeys[onCanvas.indexOf(e)]);
      } else if (!fresh.has(e.parent)) {
        // A card copied out of its column lands right below the original.
        const siblings = childrenOf(listElements(doc), e.parent);
        const index = siblings.findIndex((s) => s.id === e.id) + 1;
        copy.set('z', keysAt(siblings, index, 1)[0]);
      }
      if (picked.includes(e)) out.push(id);
      elements.set(id, copy);
    }
  }, opts.origin);
  return out;
}

function cloneType(value: Y.AbstractType<unknown>): unknown {
  if (value instanceof Y.XmlFragment) return value.clone();
  if (value instanceof Y.Array) {
    return Y.Array.from(
      value.toArray().map((v) => (v instanceof Y.AbstractType ? cloneType(v) : v)),
    );
  }
  if (value instanceof Y.Map) {
    const m = new Y.Map<unknown>();
    for (const [k, v] of value.entries()) m.set(k, v instanceof Y.AbstractType ? cloneType(v) : v);
    return m;
  }
  return value.toJSON();
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
  patch: { text?: string; done?: boolean },
  origin?: unknown,
): void {
  const items = todoItems(doc, id);
  if (!items) return;
  doc.transact(() => {
    for (const item of items) {
      if (item.get('id') !== itemId) continue;
      if (patch.text !== undefined) item.set('text', patch.text);
      if (patch.done !== undefined) item.set('done', patch.done);
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

/** Elements copied to the clipboard, with note bodies as Yjs updates. */
export interface ClipboardData {
  version: 1;
  elements: Element[];
  bodies: Record<string, string>;
}

export function copyElements(doc: Y.Doc, ids: string[]): ClipboardData {
  const all = listElements(doc);
  const picked = all.filter((e) => ids.includes(e.id));
  const columnIds = new Set(picked.filter((e) => e.type === 'column').map((e) => e.id));
  const children = all.filter((e) => e.parent && columnIds.has(e.parent) && !ids.includes(e.id));
  const elements = [...picked, ...children];
  const bodies: Record<string, string> = {};
  for (const e of elements) {
    const body = getMap(doc, e.id)?.get('body');
    if (!(body instanceof Y.XmlFragment)) continue;
    const tmp = new Y.Doc();
    tmp.getMap('m').set('body', body.clone());
    bodies[e.id] = toBase64(Y.encodeStateAsUpdate(tmp));
  }
  return { version: 1, elements, bodies };
}

/** Pastes copied elements with their top-left corner at `at`. Returns the new top-level ids. */
export function pasteElements(
  doc: Y.Doc,
  data: ClipboardData,
  at: Point,
  opts: { userId: string | null; origin?: unknown },
): string[] {
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
      const copy: Element = {
        ...e,
        id,
        createdBy: opts.userId,
        createdAt: Date.now(),
        parent: copiedParent ?? null,
        x: onCanvas ? Math.round(at.x + (e.parent === null ? e.x - minX : 0)) : e.x,
        y: onCanvas ? Math.round(at.y + (e.parent === null ? e.y - minY : 0)) : e.y,
        z: onCanvas ? (keys[placed.indexOf(e)] ?? keyAtEnd(all, null)) : e.z,
      };
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
