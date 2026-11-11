// SPDX-License-Identifier: MPL-2.0
import * as Y from 'yjs';
import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, roots } from './doc.ts';
import { ELEMENT_TYPES, Element } from './elements.ts';

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
const READER = 3;
const MAGIC = 'inkadra-validated-snapshot';
const ELEMENT_TYPE_SET: ReadonlySet<unknown> = new Set(ELEMENT_TYPES);
const HEX64 = /^[0-9a-f]{16}$/;
/** ElementId's pattern (elements.ts), without a Zod call per card. */
const ELEMENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

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
    start(0x9747b28c, 0x2b9e6b1f, T_SCHEMA);
    absorbString(json);
    schemaId = `${CURRENT_SCHEMA_VERSION}.${digest()}`;
  }
  return schemaId;
}

/** The secret of one snapshot: two 32-bit words seeding the fingerprints. */
export type FingerprintKey = readonly [number, number];

/*
 * The fingerprint hash. Inputs are encoded as a sequence of 32-bit words that can be read back
 * in one way only (decision 0106 lists it): every record starts with a tag that fixes how many
 * words follow, a number below 2^32 is one word and any other safe integer (Yjs ids go up to
 * 2^53) is its low and high halves under a tag of its own, a string is its length and then its
 * UTF-16 code units two per word, and a nested type is enclosed in begin and end tags. Every word
 * goes through both lanes, each a bijection of the word for a given state, seeded by the key.
 * The two lanes are not a standard PRF: see the decision.
 */
const T_CARD = 1;
const T_OWN = 2;
const T_NO_OWN = 3;
const T_BEGIN = 4;
const T_ENTRY = 5;
const T_ENTRY_WIDE = 6;
const T_LIST = 7;
const T_RUN = 8;
const T_RUN_WIDE = 9;
const T_NESTED = 10;
const T_NESTED_WIDE = 11;
const T_END = 12;
const T_PLAIN = 13;
const T_XML = 14;
const T_SCHEMA = 15;
const T_OWN_WIDE = 16;
const TWO_32 = 0x100000000;

let laneA = 0;
let laneB = 0;
/** A number that is not a non-negative safe integer: the card gets no fingerprint. */
let poisoned = false;

function start(a: number, b: number, tag: number) {
  laneA = a | 0;
  laneB = b | 0;
  poisoned = false;
  absorb(tag);
}

/** One 32-bit word into both lanes; for a given state each lane is a bijection of the word. */
function absorb(word: number) {
  laneA = Math.imul(laneA ^ word, 0xcc9e2d51);
  laneA = Math.imul(laneA ^ (laneA >>> 15), 0x1b873593);
  laneA ^= laneA >>> 13;
  laneB = Math.imul((laneB + word) | 0, 0x85ebca6b);
  laneB = Math.imul(laneB ^ (laneB >>> 16), 0x27d4eb2f);
  laneB ^= laneB >>> 15;
}

/**
 * A record of three numbers: under `tag` when all are integers below 2^32 (`n >>> 0 === n`),
 * else halves under `wide`. Inlined, with the steps of absorb(): this runs once per run of stroke
 * items, and without a JIT a function call costs more than the arithmetic.
 */
function record3(tag: number, wide: number, a: number, b: number, c: number) {
  if (a >>> 0 === a && b >>> 0 === b && c >>> 0 === c) {
    let A = laneA;
    let B = laneB;
    A = Math.imul(A ^ tag, 0xcc9e2d51);
    A = Math.imul(A ^ (A >>> 15), 0x1b873593);
    A ^= A >>> 13;
    B = Math.imul((B + tag) | 0, 0x85ebca6b);
    B = Math.imul(B ^ (B >>> 16), 0x27d4eb2f);
    B ^= B >>> 15;
    A = Math.imul(A ^ a, 0xcc9e2d51);
    A = Math.imul(A ^ (A >>> 15), 0x1b873593);
    A ^= A >>> 13;
    B = Math.imul((B + a) | 0, 0x85ebca6b);
    B = Math.imul(B ^ (B >>> 16), 0x27d4eb2f);
    B ^= B >>> 15;
    A = Math.imul(A ^ b, 0xcc9e2d51);
    A = Math.imul(A ^ (A >>> 15), 0x1b873593);
    A ^= A >>> 13;
    B = Math.imul((B + b) | 0, 0x85ebca6b);
    B = Math.imul(B ^ (B >>> 16), 0x27d4eb2f);
    B ^= B >>> 15;
    A = Math.imul(A ^ c, 0xcc9e2d51);
    A = Math.imul(A ^ (A >>> 15), 0x1b873593);
    A ^= A >>> 13;
    B = Math.imul((B + c) | 0, 0x85ebca6b);
    B = Math.imul(B ^ (B >>> 16), 0x27d4eb2f);
    B ^= B >>> 15;
    laneA = A;
    laneB = B;
    return;
  }
  recordWide(wide, [a, b, c]);
}

/** A record of two numbers, as record3. */
function record2(tag: number, wide: number, a: number, b: number) {
  if (a >>> 0 === a && b >>> 0 === b) {
    let A = laneA;
    let B = laneB;
    A = Math.imul(A ^ tag, 0xcc9e2d51);
    A = Math.imul(A ^ (A >>> 15), 0x1b873593);
    A ^= A >>> 13;
    B = Math.imul((B + tag) | 0, 0x85ebca6b);
    B = Math.imul(B ^ (B >>> 16), 0x27d4eb2f);
    B ^= B >>> 15;
    A = Math.imul(A ^ a, 0xcc9e2d51);
    A = Math.imul(A ^ (A >>> 15), 0x1b873593);
    A ^= A >>> 13;
    B = Math.imul((B + a) | 0, 0x85ebca6b);
    B = Math.imul(B ^ (B >>> 16), 0x27d4eb2f);
    B ^= B >>> 15;
    A = Math.imul(A ^ b, 0xcc9e2d51);
    A = Math.imul(A ^ (A >>> 15), 0x1b873593);
    A ^= A >>> 13;
    B = Math.imul((B + b) | 0, 0x85ebca6b);
    B = Math.imul(B ^ (B >>> 16), 0x27d4eb2f);
    B ^= B >>> 15;
    laneA = A;
    laneB = B;
    return;
  }
  recordWide(wide, [a, b]);
}

/** Numbers past 32 bits: low and high halves; anything but a non-negative safe integer poisons. */
function recordWide(wide: number, numbers: number[]) {
  for (const n of numbers) {
    if (!Number.isSafeInteger(n) || n < 0) {
      poisoned = true;
      return;
    }
  }
  absorb(wide);
  for (const n of numbers) {
    absorb(n >>> 0);
    absorb(Math.floor(n / TWO_32));
  }
}

function absorbString(text: string) {
  absorb(text.length);
  for (let i = 0; i < text.length; i += 2)
    absorb((text.charCodeAt(i) << 16) | (i + 1 < text.length ? text.charCodeAt(i + 1) : 0));
}

function digest(): string {
  const fold = (h: number) => {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0).toString(16).padStart(8, '0');
  };
  return fold(laneA ^ Math.imul(laneB, 0x9e3779b1)) + fold(laneB ^ Math.imul(laneA, 0x7feb352d));
}

/**
 * Fingerprint of what a card is made of, keyed by the snapshot's secret: the id of the item that
 * holds it, then the ids of the items it holds that are not deleted, through nested types,
 * without its rich text (reads leave it out). Map entries are taken in key order (two clients
 * adding keys make different orders live and after a reload); the key itself is not hashed, as
 * an item id fixes the key it was written under. Runs of consecutive clocks of one client count
 * as one, as Yjs merges and splits such items freely. Any edit adds items with new ids, so the
 * fingerprint changes. Null when an id is not a non-negative safe integer: such a card is never
 * taken from a snapshot.
 */
export function cardFingerprint(map: Y.Map<unknown>, key: FingerprintKey): string | null {
  start(key[0], key[1], T_CARD);
  const own = map._item?.id;
  if (own) record2(T_OWN, T_OWN_WIDE, own.client, own.clock);
  else absorb(T_NO_OWN);
  walkType(map);
  return poisoned ? null : digest();
}

/** The parts of a Yjs type a fingerprint walks: its map entries and its list. */
type Walked = Pick<Y.AbstractType<unknown>, '_map' | '_start'>;

function walkType(type: Walked) {
  absorb(T_BEGIN);
  const map = type._map;
  if (map.size > 0) {
    // The default sort compares UTF-16 code units, as `<` does, without calling back into JS.
    const keys = map.size === 1 ? map.keys() : [...map.keys()].sort();
    for (const key of keys) {
      const item = map.get(key)!;
      if (item.deleted) continue;
      record2(T_ENTRY, T_ENTRY_WIDE, item.id.client, item.id.clock);
      walkContent(item);
    }
  }
  absorb(T_LIST);
  let client = -1;
  let first = 0;
  let end = 0;
  for (let item = type._start; item; item = item.right) {
    if (item.deleted) continue;
    const id = item.id;
    const nested = item.content instanceof Y.ContentType;
    if (!nested && id.client === client && id.clock === end) {
      end += item.length;
      continue;
    }
    if (client !== -1) record3(T_RUN, T_RUN_WIDE, client, first, end);
    if (nested) {
      record2(T_NESTED, T_NESTED_WIDE, id.client, id.clock);
      client = -1;
      walkContent(item);
    } else {
      client = id.client;
      first = id.clock;
      end = id.clock + item.length;
    }
  }
  if (client !== -1) record3(T_RUN, T_RUN_WIDE, client, first, end);
  absorb(T_END);
}

function walkContent(item: Y.Item) {
  if (!(item.content instanceof Y.ContentType)) absorb(T_PLAIN);
  else if (item.content.type instanceof Y.XmlFragment) absorb(T_XML);
  else walkType(item.content.type);
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
    const fingerprint = cardFingerprint(map, key);
    if (fingerprint === null) continue;
    lines.push(`${JSON.stringify(id)}\t${fingerprint}\t${JSON.stringify(element)}`);
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
  return ELEMENT_TYPE_SET.has(type) && typeof id === 'string' && ELEMENT_ID.test(id);
}
