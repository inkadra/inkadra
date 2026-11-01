// SPDX-License-Identifier: MPL-2.0
import * as Y from 'yjs';
import { z } from 'zod';
import { AspectRatio, Element, type ElementType } from './elements.ts';

/** Bump when the shape of the board document changes, and add a migration below. */
export const CURRENT_SCHEMA_VERSION = 10;

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
    roots(doc).elements.set(parsed.id, map);
  });
  return map;
}

function toYMap(value: object): Y.Map<unknown> {
  return new Y.Map(Object.entries(value));
}

/**
 * To-do items are Y.Maps in a Y.Array so two people can tick different items; pen strokes are
 * plain objects in a Y.Array (so are frame shapes) so two people can draw on the same frame. Everything else is a
 * plain value that a write replaces.
 */
function toYValue(key: string, value: unknown): unknown {
  if (key === 'items') return Y.Array.from((value as object[]).map(toYMap));
  if (key === 'strokes' || key === 'shapes') return Y.Array.from(value as object[]);
  return value;
}

/** Plain JSON view of an element (without rich text), or null if it does not validate. */
export function readElement(map: Y.Map<unknown>): Element | null {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of map.entries()) {
    if (value instanceof Y.XmlFragment) continue;
    plain[key] = value instanceof Y.AbstractType ? value.toJSON() : value;
  }
  const result = Element.safeParse(plain);
  return result.success ? result.data : null;
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
    if (name !== 'meta' && name !== 'elements') {
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
