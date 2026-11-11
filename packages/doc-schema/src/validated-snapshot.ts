// SPDX-License-Identifier: MPL-2.0
import * as Y from 'yjs';
import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, roots } from './doc.ts';
import { ELEMENT_TYPES, Element, ElementId } from './elements.ts';

/**
 * Validated snapshots (decision 0106): what a board's validated view looked like, saved by the
 * app next to its local copy of the document, so that opening the same cards again with the same
 * build skips their validation.
 *
 * - The snapshot is bound to the **build** that wrote it: an identity the host passes (its app
 *   version and commit, or for the web the bundle hash) must be the same to open it. The schema
 *   version, a hash of Element's JSON schema and a reader version are a second, weaker check.
 * - Each card is bound to its content by a fingerprint of the Yjs items it is made of (their ids
 *   are never reused for other content), keyed by a random key of the snapshot.
 * - A card whose fingerprint differs is read and validated normally. A snapshot of another build,
 *   schema or board, or with any line that is malformed, is ignored as a whole.
 *
 * What a match hands out is the data this build validated when it saved the snapshot, never the
 * stored content unchecked. The text is a header line, then `"key"\tfingerprint\telement-or-null`
 * per card.
 */

/** Bump when reading or validating changes in a way the JSON schema of Element does not show. */
const READER = 2;
const MAGIC = 'inkadra-validated-snapshot';
const ELEMENT_TYPE_SET: ReadonlySet<unknown> = new Set(ELEMENT_TYPES);
const HEX64 = /^[0-9a-f]{16}$/;

/** Who wrote a snapshot: the host's build identity, the same when it is written and opened. */
export interface SnapshotBuild {
  /** App version and commit, or the bundle hash: anything that changes with every release. */
  build: string;
}

function checkBuild({ build }: SnapshotBuild): string {
  if (typeof build !== 'string' || build.length === 0 || build.length > 200)
    throw new RangeError('build must be a string of 1 to 200 characters');
  return build;
}

let schemaId: string | undefined;
/**
 * This build's schema: its version and a hash of Element's JSON schema, computed once per process
 * (about 15 ms without a JIT). Refines, URL protocols and everything behind a transform are not in
 * the JSON schema, so this is only a second check after the build identity.
 */
function schemaFingerprint(): string {
  if (schemaId === undefined) {
    const json = JSON.stringify(z.toJSONSchema(Element, { io: 'input', unrepresentable: 'any' }));
    laneA = 0x9747b28c;
    laneB = 0x2b9e6b1f;
    for (let i = 0; i < json.length; i += 3)
      mix(json.charCodeAt(i), json.charCodeAt(i + 1) | 0, json.charCodeAt(i + 2) | 0);
    mix(json.length, -6, -6);
    schemaId = `${CURRENT_SCHEMA_VERSION}.${finish(laneA)}${finish(laneB)}`;
  }
  return schemaId;
}

/** The secret of one snapshot: two 32-bit words seeding the fingerprints. */
export type FingerprintKey = readonly [number, number];

/**
 * Fingerprint of what a card is made of: the ids of the items it holds that are not deleted,
 * through nested types, without its rich text (reads leave it out). Map entries are taken in key
 * order (two clients adding keys make different orders live and after a reload) and an item id
 * also fixes the key it was written under. Runs of consecutive clocks of one client count as one,
 * as Yjs merges and splits such items freely. Any edit adds items with new ids, so the
 * fingerprint changes. Seeded by the snapshot's random key, which never leaves the app's
 * storage, so someone editing the board cannot aim at a card's fingerprint. Two 32-bit lanes
 * mixed inline: this runs over every stroke item of a board when it opens, without a JIT.
 */
export function cardFingerprint(map: Y.Map<unknown>, key: FingerprintKey): string {
  laneA = key[0] | 0;
  laneB = key[1] | 0;
  mix(0x5bd1e995, laneA, laneB);
  const own = map._item?.id;
  if (own) mix(own.client, own.clock, 0);
  walkType(map);
  return finish(laneA) + finish(laneB);
}

let laneA = 0;
let laneB = 0;

/** Clocks past 2^32 fold onto lower ones: a collision there needs 4 billion edits by one client. */
function mix(x: number, y: number, z: number) {
  laneA = Math.imul(laneA ^ x, 0xcc9e2d51);
  laneA = Math.imul(laneA ^ (laneA >>> 15) ^ y, 0x1b873593);
  laneA = Math.imul(laneA ^ (laneA >>> 13) ^ z, 0xe6546b65);
  laneA ^= laneA >>> 16;
  laneB = Math.imul(laneB + x, 0x85ebca6b);
  laneB = Math.imul(laneB ^ (laneB >>> 13), 0xc2b2ae35) + y;
  laneB = Math.imul(laneB ^ (laneB >>> 16), 0x27d4eb2f) + z;
  laneB ^= laneB >>> 15;
}

function finish(h: number): string {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0).toString(16).padStart(8, '0');
}

/** The parts of a Yjs type a fingerprint walks: its map entries and its list. */
type Walked = Pick<Y.AbstractType<unknown>, '_map' | '_start'>;

const byKey = (a: [string, Y.Item], b: [string, Y.Item]) => (a[0] < b[0] ? -1 : 1);

function walkType(type: Walked) {
  if (type._map.size > 0) {
    const entries = type._map.size === 1 ? [...type._map] : [...type._map].sort(byKey);
    for (const [, item] of entries) {
      if (item.deleted) continue;
      mix(item.id.client, item.id.clock, -1);
      walkContent(item);
    }
  }
  mix(-2, -2, -2);
  let client = -1;
  let start = 0;
  let end = 0;
  for (let item = type._start; item; item = item.right) {
    if (item.deleted) continue;
    const id = item.id;
    const nested = item.content instanceof Y.ContentType;
    if (!nested && id.client === client && id.clock === end) {
      end += item.length;
      continue;
    }
    if (client !== -1) mix(client, start, end);
    if (nested) {
      mix(id.client, id.clock, -3);
      client = -1;
      walkContent(item);
    } else {
      client = id.client;
      start = id.clock;
      end = id.clock + item.length;
    }
  }
  if (client !== -1) mix(client, start, end);
  mix(-4, -4, -4);
}

function walkContent(item: Y.Item) {
  if (!(item.content instanceof Y.ContentType)) return;
  const type = item.content.type;
  if (type instanceof Y.XmlFragment) mix(-5, -5, -5);
  else walkType(type);
}

const hex = (word: number) => (word >>> 0).toString(16).padStart(8, '0');

function boardIdOf(doc: Y.Doc): string | null {
  const boardId = roots(doc).meta.get('boardId');
  return typeof boardId === 'string' ? boardId : null;
}

/** Whether JSON gives the value back as it is: no undefined, no -0 (they are left out). */
function jsonFaithful(value: unknown): boolean {
  if (value === undefined || Object.is(value, -0)) return false;
  if (typeof value !== 'object' || value === null) return true;
  if (Array.isArray(value)) {
    for (const item of value) if (!jsonFaithful(item)) return false;
    return true;
  }
  for (const key in value) if (!jsonFaithful((value as Record<string, unknown>)[key])) return false;
  return true;
}

/**
 * Saves validated reads of a document's cards, by key: `element` is what `readElement` returns
 * for the card as it is now (null when it does not validate). Call it only with reads that are
 * current; `BoardStore` does. Cards whose read JSON would not give back unchanged are left out.
 */
export function encodeValidatedSnapshot(
  doc: Y.Doc,
  reads: Iterable<[key: string, element: Element | null]>,
  options: SnapshotBuild,
): string {
  const build = checkBuild(options);
  const random = crypto.getRandomValues(new Uint32Array(2));
  const key: FingerprintKey = [random[0]!, random[1]!];
  const { elements } = roots(doc);
  const lines: string[] = [];
  for (const [id, element] of reads) {
    const map = elements.get(id);
    if (!(map instanceof Y.Map) || (element && !jsonFaithful(element))) continue;
    lines.push(`${JSON.stringify(id)}\t${cardFingerprint(map, key)}\t${JSON.stringify(element)}`);
  }
  const header = [
    MAGIC,
    READER,
    build,
    schemaFingerprint(),
    boardIdOf(doc),
    hex(key[0]) + hex(key[1]),
    lines.length,
  ];
  return `${[JSON.stringify(header), ...lines].join('\n')}\n`;
}

export interface ValidatedSnapshot {
  /**
   * The validated read of a card if the snapshot holds one for its key and it is made of the same
   * items now; undefined when the card must be read normally. Each entry is used once.
   */
  take(key: string, map: Y.Map<unknown>): Element | null | undefined;
}

/** Opens a snapshot in one go: see openValidatedSnapshotSteps. */
export function openValidatedSnapshot(
  doc: Y.Doc,
  text: unknown,
  options: SnapshotBuild,
): ValidatedSnapshot | null {
  const steps = openValidatedSnapshotSteps(doc, text, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * Opens a snapshot for a document, one card per step, or null if it is not one this build (the
 * same build identity) wrote for this board, or if any line is malformed: a cut or altered text,
 * a repeated key, a count that differs, a card whose type this build does not know or whose id is
 * not an element id. Each card's validated read is parsed here; its fingerprint is compared when
 * it is taken.
 */
export function* openValidatedSnapshotSteps(
  doc: Y.Doc,
  text: unknown,
  options: SnapshotBuild,
): Generator<void, ValidatedSnapshot | null> {
  const build = checkBuild(options);
  if (typeof text !== 'string') return null;
  let at = text.indexOf('\n');
  if (at < 0) return null;
  const header = parse(text.slice(0, at));
  if (
    !Array.isArray(header) ||
    header.length !== 7 ||
    header[0] !== MAGIC ||
    header[1] !== READER ||
    header[2] !== build ||
    header[3] !== schemaFingerprint() ||
    header[4] !== boardIdOf(doc) ||
    typeof header[5] !== 'string' ||
    !HEX64.test(header[5]) ||
    !Number.isSafeInteger(header[6])
  )
    return null;
  const key: FingerprintKey = [
    Number.parseInt(header[5].slice(0, 8), 16),
    Number.parseInt(header[5].slice(8), 16),
  ];
  const cards = new Map<string, { fingerprint: string; element: Element | null }>();
  for (let start = at + 1; start < text.length; start = at + 1) {
    yield;
    at = text.indexOf('\n', start);
    if (at < 0) return null;
    const line = text.slice(start, at);
    const tab = line.indexOf('\t');
    const tab2 = tab < 0 ? -1 : line.indexOf('\t', tab + 1);
    if (tab2 < 0) return null;
    const id = parse(line.slice(0, tab));
    const fingerprint = line.slice(tab + 1, tab2);
    const element = parse(line.slice(tab2 + 1));
    if (typeof id !== 'string' || cards.has(id) || !HEX64.test(fingerprint)) return null;
    if (element !== null && !isCardShaped(element)) return null;
    cards.set(id, { fingerprint, element: element as Element | null });
  }
  if (cards.size !== header[6]) return null;
  return {
    take(id, map) {
      const card = cards.get(id);
      if (!card) return undefined;
      cards.delete(id);
      return card.fingerprint === cardFingerprint(map, key) ? card.element : undefined;
    },
  };
}

const INVALID = Symbol('invalid');

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return INVALID;
  }
}

/** Structure only: the content is what this build validated when it wrote the line. */
function isCardShaped(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { id, type } = value as { id?: unknown; type?: unknown };
  return ELEMENT_TYPE_SET.has(type) && ElementId.safeParse(id).success;
}
