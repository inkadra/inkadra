// SPDX-License-Identifier: MPL-2.0
import * as Y from 'yjs';
import { z } from 'zod';
import {
  AspectRatio,
  Element,
  type ElementType,
  MAX_STROKES,
  MAX_TABLE_ROWS,
  PlanStroke,
  Stroke,
  TableRow,
} from './elements.ts';

/** Bump when the shape of the board document changes, and add a migration below. */
export const CURRENT_SCHEMA_VERSION = 22;

/** Persisted ProseMirror additions: older editor schemas can destructively normalize them. */
export const NOTE_BODY_FORMAT = {
  version: 19,
  marks: ['noteInk'],
  nodes: ['taskList', 'taskItem', 'mention', 'noteImage'],
  blockAttributes: ['textAlign'],
} as const;

/**
 * Inline `mention` node of a note body (schema 19): an account of the project, by id, with
 * the name it had when it was written. Guests receive the name only.
 */
export const NoteMention = z.object({ id: z.string().min(1).max(64), label: z.string().max(200) });
export type NoteMention = z.infer<typeof NoteMention>;

/** Block `noteImage` node of a note body (schema 19): an uploaded picture of the project. */
export const NoteImage = z.object({
  assetId: z.string().min(1).max(64),
  alt: z.string().max(500).nullable().optional(),
});
export type NoteImage = z.infer<typeof NoteImage>;

/** Asset ids of the `noteImage` nodes of a note body, in document order. */
export function noteImageAssetIds(body: Y.XmlFragment | Y.XmlElement): string[] {
  const out: string[] = [];
  for (const child of body.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === 'noteImage') {
      const id = child.getAttribute('assetId');
      if (typeof id === 'string' && id) out.push(id);
    } else out.push(...noteImageAssetIds(child));
  }
  return out;
}

export const DOC_NAME_PREFIX = 'board:';

/** Name of the Hocuspocus document for a board. */
export function boardDocName(boardId: string): string {
  return `${DOC_NAME_PREFIX}${boardId}`;
}

export function parseBoardDocName(name: string): string | null {
  if (!name.startsWith(DOC_NAME_PREFIX)) return null;
  const id = name.slice(DOC_NAME_PREFIX.length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Root types of a board document. Nothing else may be stored at the root.
 * `meta` holds `schemaVersion`, `boardId`, from version 2 `aspect` (the AspectRatio of a
 * storyboard's frames) and from version 9 `animaticAudio` (the sound track of its animatic).
 */
export function roots(doc: Y.Doc) {
  return {
    meta: doc.getMap<unknown>('meta'),
    elements: doc.getMap<Y.Map<unknown>>('elements'),
  };
}

export function getSchemaVersion(doc: Y.Doc): number {
  const v = roots(doc).meta.get('schemaVersion');
  return typeof v === 'number' ? v : 0;
}

export function initBoardDoc(doc: Y.Doc, boardId: string): void {
  const { meta } = roots(doc);
  doc.transact(() => {
    meta.set('schemaVersion', CURRENT_SCHEMA_VERSION);
    meta.set('boardId', boardId);
  });
}

export function createBoardDoc(boardId: string): Y.Doc {
  const doc = new Y.Doc();
  initBoardDoc(doc, boardId);
  return doc;
}

type Migration = (doc: Y.Doc) => void;

/**
 * migrations[n] upgrades a document from version n to n + 1.
 * Version 0 is an empty document that was never initialised.
 */
const migrations: Record<number, Migration> = {
  // 2: scene, frame and arrow elements, `tags` on every element, `meta.aspect`. All additive,
  // so version 1 documents are valid as they are; the bump keeps older servers from loading
  // documents with element types they do not know.
  1: () => {},
  // 3: `guestHidden` on every element (decision 0013). Additive, so version 2 documents are
  // valid as they are; the bump keeps builds that do not know the field from copying or
  // recreating hidden cards without it, which would show them to guests.
  2: () => {},
  // 4: optional file captions (decision 0020). Existing documents need no data changes;
  // older builds must not silently discard captions when copying file cards.
  3: () => {},
  // 5: optional video still provenance on images and storyboard frames (decision 0042).
  // Existing documents stay unchanged; older clients must not discard the source.
  4: () => {},
  // 6: optional `path` (straight or curved) on arrows (decision 0043). Existing arrows stay
  // straight; older builds must not straighten curved arrows when copying them.
  5: () => {},
  // 7: character and location elements (decision 0044). Additive; the bump keeps older
  // servers from loading documents with element types they would refuse to validate.
  6: () => {},
  // 8: optional non-destructive `crop` and `rotation` on image elements (decision 0045).
  // Existing images stay uncropped and unrotated; older builds must not strip crop or rotation.
  7: () => {},
  // 9: optional `meta.animaticAudio`, the sound track of a storyboard's animatic (decision
  // 0046). Existing storyboards play silent; older builds must not drop the track on restore.
  8: () => {},
  // 10: optional `color` on columns and the section heading element (#307, #318). Additive;
  // older builds must not drop a column's colour or refuse documents with headings.
  9: () => {},
  // 11: the table and map elements (#317, #319, decisions 0052 and 0053). Additive; the bump
  // keeps older servers from loading documents with element types they would refuse to validate.
  10: () => {},
  // 12: optional assigneeId and dueDate on to-do items; old items stay unassigned.
  11: () => {},
  // 13: optional `list` and `sceneId` on to-do cards (#323, decision 0058). Existing lists stay
  // ordinary; older builds must not drop the kind or the scene when copying a card.
  12: () => {},
  // 14: the set plan element (#335, decision 0062). Additive; the bump keeps older servers from
  // loading documents with an element type they would refuse to validate.
  13: () => {},
  // 15: plans grow (#335 v2, decision 0062): more icon kinds, sizes, lenses and beams,
  // blocking steps, layers, groups, scenes, variants and a real scale. All optional; older
  // builds must not drop them when copying a plan.
  14: () => {},
  // 16: contextual appearance, image strokes and NOTE_BODY_FORMAT ProseMirror extensions. Omitted fields preserve old
  // documents; older builds must not drop the fields when copying cards.
  15: () => {},
  // 17: optional character details. Existing cards remain unchanged.
  16: () => {},
  // 18: optional `percent` on plan icons, any proportional size of a symbol (decision 0071).
  // Existing icons keep their S, M or L; older clients stay read-only and cannot drop the field.
  17: () => {},
  // 19: `mention` and `noteImage` nodes in note bodies (NOTE_BODY_FORMAT, decision 0074).
  // Existing notes stay unchanged; the bump keeps older editors, which would drop the unknown
  // nodes when they normalize a note, read-only.
  18: () => {},
  // 20: optional `background` on section headings (decision 0076). Existing headings stay
  // unchanged; older builds must not drop the field when copying a heading.
  19: () => {},
  // 21: optional `group` on images, links and colours, the moodboard's named groups (decision
  // 0077). Existing references stay ungrouped; older builds must not drop it when copying a card.
  20: () => {},
  // 22: optional `omitted` on scenes, a scene the latest draft of the script left out (decision
  // 0082). Existing scenes stay in; older clients stay read-only and cannot drop the mark.
  21: () => {},
};

/**
 * The one sound track of a storyboard's animatic: an uploaded audio file of the board's
 * project that starts with the first frame. `volume` is the level the team mixed (0 to 1);
 * muting is a choice of each viewer and is not stored.
 */
export const AnimaticAudio = z.object({
  assetId: z.uuid(),
  volume: z.number().min(0).max(1),
});
export type AnimaticAudio = z.infer<typeof AnimaticAudio>;

export function getAnimaticAudio(doc: Y.Doc): AnimaticAudio | null {
  const parsed = AnimaticAudio.safeParse(roots(doc).meta.get('animaticAudio'));
  return parsed.success ? parsed.data : null;
}

export function setAnimaticAudio(doc: Y.Doc, audio: AnimaticAudio | null, origin?: unknown): void {
  const { meta } = roots(doc);
  doc.transact(() => {
    if (audio === null) meta.delete('animaticAudio');
    else meta.set('animaticAudio', AnimaticAudio.parse(audio));
  }, origin);
}

export function getBoardAspect(doc: Y.Doc): AspectRatio | null {
  const parsed = AspectRatio.safeParse(roots(doc).meta.get('aspect'));
  return parsed.success ? parsed.data : null;
}

export function setBoardAspect(doc: Y.Doc, aspect: AspectRatio | null, origin?: unknown): void {
  const { meta } = roots(doc);
  doc.transact(() => {
    if (aspect === null) meta.delete('aspect');
    else meta.set('aspect', AspectRatio.parse(aspect));
  }, origin);
}

export class SchemaTooNewError extends Error {
  constructor(readonly version: number) {
    super(
      `Board document version ${version} is newer than this build (${CURRENT_SCHEMA_VERSION}).`,
    );
  }
}

/** Upgrades the document in place. Returns the versions it went through. */
export function migrateBoardDoc(doc: Y.Doc, boardId: string): number[] {
  let version = getSchemaVersion(doc);
  if (version > CURRENT_SCHEMA_VERSION) throw new SchemaTooNewError(version);
  const steps: number[] = [];
  if (version === 0) {
    initBoardDoc(doc, boardId);
    return [CURRENT_SCHEMA_VERSION];
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new Error(`Missing board document migration from version ${version}.`);
    doc.transact(() => {
      step(doc);
      roots(doc).meta.set('schemaVersion', version + 1);
    });
    version += 1;
    steps.push(version);
  }
  return steps;
}

const ID_ALPHABET = 'ModuleSymbhasOwnPr-0123456789ABCDEFGHNRVfgctiUvz_KqYTJkLxpZXIjQW';

export function newElementId(size = 21): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = '';
  for (const b of bytes) id += ID_ALPHABET[b & 63];
  return id;
}

/** Adds an element; rich text for notes and the strokes of frames are created empty. */
export function addElement(doc: Y.Doc, element: Element): Y.Map<unknown> {
  const parsed = Element.parse(element);
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;
      map.set(key, toYValue(key, value));
    }
    if (parsed.type === 'note') map.set('body', new Y.XmlFragment());
    // Created with the frame, so two people drawing on a new frame add to the same arrays
    // instead of each replacing the field with their own.
    if (parsed.type === 'frame' && !parsed.strokes) map.set('strokes', new Y.Array());
    if (parsed.type === 'frame' && !parsed.shapes) map.set('shapes', new Y.Array());
    if (parsed.type === 'plan') {
      if (!parsed.strokes) map.set('strokes', new Y.Array());
      if (!parsed.shapes) map.set('shapes', new Y.Array());
      if (!parsed.icons) map.set('icons', new Y.Array());
    }
    roots(doc).elements.set(parsed.id, map);
  });
  return map;
}

function toYMap(value: object): Y.Map<unknown> {
  return new Y.Map(Object.entries(value));
}

/** A table row as Yjs stores it: its cells in a Y.Map of their own. */
export function tableRowMap(row: TableRow): Y.Map<unknown> {
  return new Y.Map<unknown>([
    ['id', row.id],
    ['cells', new Y.Map(Object.entries(row.cells))],
  ]);
}

/**
 * To-do items, table columns and plan icons are Y.Maps in a Y.Array so two people can edit
 * different items; table rows too, with their cells in a nested Y.Map; pen strokes are
 * plain objects in a Y.Array (so are frame shapes) so two people can draw on the same frame. Everything else is a
 * plain value that a write replaces.
 */
function toYValue(key: string, value: unknown): unknown {
  if (key === 'items' || key === 'columns' || key === 'icons')
    return Y.Array.from((value as object[]).map(toYMap));
  if (key === 'rows') return Y.Array.from((value as TableRow[]).map(tableRowMap));
  if (key === 'strokes' || key === 'shapes') return Y.Array.from(value as object[]);
  return value;
}

/**
 * The lists that grow large, read item by item (decision 0094): strict lists fail the whole
 * element on one bad item or past `max`, as `z.array(item).max(max)` does; lenient ones leave
 * bad items out and cut at `max`, as the plan's lists do (elements.ts).
 */
const ITEM_LISTS = new Map<string, { key: string; item: z.ZodType; max: number; lenient: boolean }>(
  [
    ['frame', { key: 'strokes', item: Stroke, max: MAX_STROKES, lenient: false }],
    ['image', { key: 'strokes', item: Stroke, max: MAX_STROKES, lenient: false }],
    ['plan', { key: 'strokes', item: PlanStroke, max: MAX_STROKES, lenient: true }],
    ['table', { key: 'rows', item: TableRow, max: MAX_TABLE_ROWS, lenient: false }],
  ],
);
const INVALID = Symbol('invalid');
/**
 * Parsed plain items (strokes) by identity. Yjs hands out the stored object for as long as the
 * item lives, and an edit stores a new one, so an object is checked once: when it was written
 * or arrived. Callers must not mutate what they read, as with every other read.
 */
const parsedItems = new WeakMap<z.ZodType, WeakMap<object, unknown>>();
/** Parsed Y.Map items (table rows) with the content they had, compared on the next read. */
const parsedMaps = new WeakMap<
  Y.Map<unknown>,
  { item: z.ZodType; plain: Record<string, unknown>; data: unknown; dirty: boolean }
>();
const observedDocs = new WeakSet<Y.Doc>();

/** Include ancestors: a changed cell map invalidates its cached table row. */
function changedTypes(transaction: Y.Transaction): Set<object> {
  const changed = new Set<object>();
  for (const type of transaction.changed.keys()) {
    for (let current: typeof type | null = type; current; current = current.parent)
      changed.add(current);
  }
  return changed;
}

function invalidateMaps(transaction: Y.Transaction) {
  for (const type of changedTypes(transaction)) {
    const cached = parsedMaps.get(type as Y.Map<unknown>);
    if (cached) cached.dirty = true;
  }
}

function parseItem(item: z.ZodType, value: unknown): unknown {
  const result = item.safeParse(value);
  return result.success ? result.data : INVALID;
}

/** Whether a Y.Map still holds what its toJSON() gave: same keys, same values. */
function sameContent(map: Y.Map<unknown>, plain: Record<string, unknown>): boolean {
  let size = 0;
  for (const [key, value] of map.entries()) {
    size += 1;
    if (!Object.hasOwn(plain, key)) return false;
    const was = plain[key];
    if (value instanceof Y.Map) {
      if (typeof was !== 'object' || was === null || !sameContent(value, was as never))
        return false;
    } else if (value instanceof Y.AbstractType || value !== was) return false;
  }
  return size === Object.keys(plain).length;
}

function readItem(item: z.ZodType, value: unknown, changed?: ReadonlySet<object>): unknown {
  if (value instanceof Y.Map) {
    const cached = parsedMaps.get(value);
    if (cached?.item === item) {
      if (!cached.dirty && !changed?.has(value)) return cached.data;
      if (sameContent(value, cached.plain)) {
        cached.dirty = false;
        return cached.data;
      }
    }
    const plain = value.toJSON();
    const data = parseItem(item, plain);
    parsedMaps.set(value, { item, plain, data, dirty: false });
    return data;
  }
  if (value instanceof Y.AbstractType) return parseItem(item, value.toJSON());
  if (typeof value !== 'object' || value === null) return parseItem(item, value);
  let parsed = parsedItems.get(item);
  if (!parsed) {
    parsed = new WeakMap();
    parsedItems.set(item, parsed);
  }
  if (parsed.has(value)) return parsed.get(value);
  const data = parseItem(item, value);
  parsed.set(value, data);
  return data;
}

/** Plain JSON view of an element (without rich text), or null if it does not validate. */
export function readElement(map: Y.Map<unknown>): Element | null {
  const steps = readElementSteps(map, false);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * Cooperative initial reads: each step checks at most one large-list item. Only the return
 * value is a validated element. If the document changes between steps, discard and restart.
 */
export function* readElementSteps(
  map: Y.Map<unknown>,
  cooperative = true,
): Generator<void, Element | null> {
  const doc = map.doc;
  if (doc && !observedDocs.has(doc)) {
    // Before any deep observer reads, including observers registered before the cache.
    doc.on('beforeObserverCalls', invalidateMaps);
    observedDocs.add(doc);
  }
  // Observers have not run inside an open transaction: inspect its current changes too.
  const changed = doc?._transaction ? changedTypes(doc._transaction) : undefined;
  const list = ITEM_LISTS.get(map.get('type') as string);
  let items: unknown[] | undefined;
  const plain: Record<string, unknown> = {};
  for (const [key, value] of map.entries()) {
    if (value instanceof Y.XmlFragment) continue;
    if (list?.key === key && value instanceof Y.Array) {
      if (!list.lenient && value.length > list.max) return null;
      items = [];
      for (const item of value.toArray()) {
        const data = readItem(list.item, item, changed);
        if (data !== INVALID) items.push(data);
        else if (!list.lenient) return null;
        if (cooperative) yield;
      }
      if (list.lenient) items = items.slice(0, list.max);
      // The rest of the element is checked with an empty list, then gets the items back.
      plain[key] = [];
    } else plain[key] = value instanceof Y.AbstractType ? value.toJSON() : value;
    if (cooperative) yield;
  }
  const result = Element.safeParse(plain);
  if (!result.success) return null;
  if (list && items) (result.data as Record<string, unknown>)[list.key] = items;
  return result.data;
}

export interface ValidationIssue {
  elementId: string;
  message: string;
}

/** Checks every element; used by the server before persisting and by tests. */
export function validateBoardDoc(doc: Y.Doc): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { elements } = roots(doc);
  for (const [id, map] of elements.entries()) {
    const element = readElement(map);
    if (!element) issues.push({ elementId: id, message: 'Element does not match the schema.' });
    else if (element.id !== id) issues.push({ elementId: id, message: 'Key and id differ.' });
  }
  const aspect = roots(doc).meta.get('aspect');
  if (aspect !== undefined && !AspectRatio.safeParse(aspect).success) {
    issues.push({ elementId: '', message: 'meta.aspect is not a known aspect ratio.' });
  }
  const audio = roots(doc).meta.get('animaticAudio');
  if (audio !== undefined && !AnimaticAudio.safeParse(audio).success) {
    issues.push({ elementId: '', message: 'meta.animaticAudio is not a valid sound track.' });
  }
  for (const name of doc.share.keys()) {
    // Tiptap collaboration stores per-item position migration markers alongside our roots.
    // Keep these CRDT markers intact; unrelated roots still fail at the import boundary.
    if (
      name !== 'meta' &&
      name !== 'elements' &&
      !/^__tiptap_position_migrations:item:\d+:\d+$/.test(name)
    ) {
      issues.push({ elementId: '', message: `Unknown root type "${name}".` });
    }
  }
  return issues;
}

export function countByType(doc: Y.Doc): Partial<Record<ElementType, number>> {
  const counts: Partial<Record<ElementType, number>> = {};
  for (const map of roots(doc).elements.values()) {
    const type = map.get('type') as ElementType;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}
