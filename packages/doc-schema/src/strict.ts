// SPDX-License-Identifier: MPL-2.0
import * as Y from 'yjs';
import type { z } from 'zod';
import { cachedPerMap, readElement } from './doc.ts';
import { Element, lenientListOf } from './elements.ts';

/**
 * The strict check of a card (decision 0101): does this build understand everything stored in
 * it? Reads keep stripping what they do not know (Zod's default), so a card written by a newer
 * schema reads fine and loses its new fields the moment this build writes it back. A client that
 * writes asks `checkCard` first and leaves `foreign` cards read-only.
 */

/** Where in the card: keys of maps and objects, indexes of lists and of note body children. */
export type CardPath = Array<string | number>;

export type ForeignIssue =
  /** A field this build does not know, at any depth. */
  | { kind: 'key'; path: CardPath }
  /** A value of an enumeration (an element type, an icon kind…) this build does not know. */
  | { kind: 'value'; path: CardPath; value: string | number | boolean }
  /** A node or a mark of a note body, or an attribute of one, this build does not know. */
  | { kind: 'node' | 'mark' | 'attribute'; path: CardPath; name: string }
  /** Something this build cannot validate: the whole card, or items a list leaves out. */
  | { kind: 'invalid'; path: CardPath };

export type CardCompat =
  | { status: 'known' }
  /** `readable`: the card validates, so it is shown; it must not be edited by this build. */
  | { status: 'foreign'; readable: boolean; issues: ForeignIssue[] };

/** At most this many issues are listed per card; the status does not depend on it. */
export const MAX_FOREIGN_ISSUES = 20;

/**
 * Nodes and marks a note body may hold, with the attributes each stores: the Tiptap schema of the
 * web app's note editor (StarterKit and the additions of NOTE_BODY_FORMAT). y-prosemirror drops
 * any other node, mark or attribute the next time it writes the note. A web test keeps this list
 * equal to the editor's schema.
 */
export const NOTE_BODY_SCHEMA = {
  nodes: {
    paragraph: ['textAlign'],
    heading: ['level', 'textAlign'],
    blockquote: [],
    bulletList: [],
    orderedList: ['start', 'type'],
    listItem: [],
    codeBlock: ['language'],
    hardBreak: [],
    horizontalRule: [],
    taskList: [],
    taskItem: ['checked'],
    mention: ['id', 'label'],
    noteImage: ['assetId', 'alt'],
  },
  marks: {
    bold: [],
    italic: [],
    strike: [],
    code: [],
    underline: [],
    link: ['href', 'target', 'rel', 'class', 'title'],
    noteInk: ['color', 'highlight'],
  },
} as const satisfies Record<'nodes' | 'marks', Record<string, readonly string[]>>;

/** Checks a card; the result is kept until the card or anything inside it changes. */
export const checkCard: (map: Y.Map<unknown>) => CardCompat = cachedPerMap((map) =>
  checkNow(
    map.get('type'),
    map.entries(),
    (key) => map.get(key),
    () => readElement(map),
  ),
);

/**
 * Checks a card given as plain JSON, as the clipboard carries it, with its note body if any;
 * not cached. Lists are plain arrays here, so only their items are walked.
 */
export function checkElement(element: Record<string, unknown>, body?: Y.XmlFragment): CardCompat {
  const entries: Array<[string, unknown]> = Object.entries(element);
  if (body) entries.push(['body', body]);
  return checkNow(
    element.type,
    entries,
    (key) => element[key],
    () => {
      const parsed = Element.safeParse(element);
      return parsed.success ? parsed.data : null;
    },
  );
}

export function isForeignCard(map: Y.Map<unknown>): boolean {
  return checkCard(map).status === 'foreign';
}

/** Checks a note body on its own, for clients that open notes outside of a board. */
export function checkNoteBody(body: Y.XmlFragment): ForeignIssue[] {
  const issues: ForeignIssue[] = [];
  walkBody(body, [], issues);
  return issues.slice(0, MAX_FOREIGN_ISSUES);
}

type Def = {
  type: string;
  innerType?: z.ZodType;
  in?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  valueType?: z.ZodType;
  options?: z.ZodType[];
  discriminator?: string;
  entries?: Record<string, unknown>;
  values?: unknown[];
};
const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Element schemas by type. */
const ELEMENTS = new Map<unknown, Record<string, z.ZodType>>(
  Element.options.map((option) => [
    option.shape.type.value,
    option.shape as unknown as Record<string, z.ZodType>,
  ]),
);

function checkNow(
  type: unknown,
  entries: Iterable<[string, unknown]>,
  get: (key: string) => unknown,
  read: () => Element | null,
): CardCompat {
  const issues: ForeignIssue[] = [];
  const shape = ELEMENTS.get(type);
  if (!shape) {
    if (typeof type === 'string') issues.push({ kind: 'value', path: ['type'], value: type });
    return { status: 'foreign', readable: false, issues: [...issues, invalid([])] };
  }
  for (const [key, value] of entries) {
    if (key === 'body' && type === 'note' && value instanceof Y.XmlFragment) {
      walkBody(value, ['body'], issues);
      continue;
    }
    const field = shape[key];
    if (!field) issues.push({ kind: 'key', path: [key] });
    else walk(field, value, [key], issues);
  }
  const element = read() as Record<string, unknown> | null;
  if (!element) issues.push(invalid([]));
  else {
    // Lists that leave out the items they cannot read: the card validates without them.
    for (const [key, field] of Object.entries(shape)) {
      const lenient = lenientListOf(unwrap(field));
      const raw = lenient && itemsOf(get(key));
      if (!lenient || !raw) continue;
      const kept = (element[key] as unknown[] | undefined)?.length ?? 0;
      if (kept < Math.min(raw.length, lenient.max) && !issues.some((i) => i.path[0] === key))
        issues.push(invalid([key]));
    }
  }
  if (issues.length === 0) return KNOWN;
  return {
    status: 'foreign',
    readable: element !== null,
    issues: issues.slice(0, MAX_FOREIGN_ISSUES),
  };
}

const KNOWN: CardCompat = { status: 'known' };
const invalid = (path: CardPath): ForeignIssue => ({ kind: 'invalid', path });

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let def = defOf(current); def.innerType; def = defOf(current)) current = def.innerType;
  return current;
}

function itemsOf(value: unknown): unknown[] | null {
  if (value instanceof Y.Array) return value.toArray();
  return Array.isArray(value) ? value : null;
}

function entriesOf(value: unknown): Iterable<[string, unknown]> | null {
  if (value instanceof Y.Map) return value.entries();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (value instanceof Y.AbstractType) return null;
  return Object.entries(value);
}

/** Whether a value of this schema can hold anything this build would not know: keys or enums. */
const canHide = new WeakMap<z.ZodType, boolean>();
function mayHide(schema: z.ZodType): boolean {
  let known = canHide.get(schema);
  if (known !== undefined) return known;
  const def = defOf(schema);
  const lenient = lenientListOf(schema);
  known = lenient
    ? mayHide(lenient.item)
    : def.innerType
      ? mayHide(def.innerType)
      : def.type === 'pipe' && def.in
        ? mayHide(def.in)
        : def.type === 'array' && def.element
          ? mayHide(def.element)
          : def.type === 'record' && def.valueType
            ? mayHide(def.valueType)
            : ['object', 'union', 'enum', 'literal'].includes(def.type);
  canHide.set(schema, known);
  return known;
}

/**
 * Plain list items (strokes, shapes) by identity: Yjs hands out the stored object for as long as
 * the item lives and an edit stores a new one, so each is walked once (as doc.ts parses them).
 */
const walkedItems = new WeakMap<z.ZodType, WeakMap<object, ForeignIssue[]>>();

function walkItems(item: z.ZodType, items: unknown[], path: CardPath, out: ForeignIssue[]) {
  if (!mayHide(item)) return;
  let walked = walkedItems.get(item);
  if (!walked) {
    walked = new WeakMap();
    walkedItems.set(item, walked);
  }
  for (let i = 0; i < items.length; i++) {
    const value = items[i];
    if (typeof value !== 'object' || value === null || value instanceof Y.AbstractType) {
      walk(item, value, [...path, i], out);
      continue;
    }
    let found = walked.get(value);
    if (!found) {
      found = [];
      walk(item, value, [], found);
      walked.set(value, found);
    }
    for (const issue of found) out.push({ ...issue, path: [...path, i, ...issue.path] });
  }
}

function walk(schema: z.ZodType, value: unknown, path: CardPath, out: ForeignIssue[]): void {
  if (out.length >= MAX_FOREIGN_ISSUES || !mayHide(schema)) return;
  const def = defOf(schema);
  const lenient = lenientListOf(schema);
  if (lenient) {
    const items = itemsOf(value);
    if (items) walkItems(lenient.item, items, path, out);
    return;
  }
  if (def.innerType) {
    if (value !== undefined && value !== null) walk(def.innerType, value, path, out);
    return;
  }
  switch (def.type) {
    case 'pipe':
      if (def.in) walk(def.in, value, path, out);
      return;
    case 'object': {
      const entries = entriesOf(value);
      if (!entries || !def.shape) return;
      for (const [key, v] of entries) {
        const field = def.shape[key];
        if (!field) out.push({ kind: 'key', path: [...path, key] });
        else walk(field, v, [...path, key], out);
      }
      return;
    }
    case 'union': {
      const disc = def.discriminator;
      const tag = disc ? new Map(entriesOf(value) ?? []).get(disc) : undefined;
      const option = disc
        ? def.options?.find((o) => {
            const field = defOf(o).shape?.[disc];
            return field && defOf(field).values?.includes(tag);
          })
        : def.options?.find((o) => o.safeParse(value).success);
      if (option) walk(option, value, path, out);
      else if (disc && isPrimitive(tag))
        out.push({ kind: 'value', path: [...path, disc], value: tag });
      return;
    }
    case 'enum':
      if (isPrimitive(value) && !Object.values(def.entries ?? {}).includes(value))
        out.push({ kind: 'value', path, value });
      return;
    case 'literal':
      if (isPrimitive(value) && !def.values?.includes(value))
        out.push({ kind: 'value', path, value });
      return;
    case 'array': {
      const items = itemsOf(value);
      if (items && def.element) walkItems(def.element, items, path, out);
      return;
    }
    case 'record': {
      const entries = entriesOf(value);
      if (entries && def.valueType)
        for (const [key, v] of entries) walk(def.valueType, v, [...path, key], out);
      return;
    }
  }
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

const NODES: Readonly<Record<string, readonly string[]>> = NOTE_BODY_SCHEMA.nodes;
const MARKS: Readonly<Record<string, readonly string[]>> = NOTE_BODY_SCHEMA.marks;
/** y-prosemirror stores overlapping marks of one type as `name--<8-character hash>`. */
const HASHED_MARK = /(.*)(--[a-zA-Z0-9+/=]{8})$/;

function walkBody(node: Y.XmlFragment, path: CardPath, out: ForeignIssue[]): void {
  node.toArray().forEach((child, i) => {
    if (out.length >= MAX_FOREIGN_ISSUES) return;
    const at = [...path, i];
    if (child instanceof Y.XmlElement) {
      const attributes = NODES[child.nodeName];
      if (!attributes) {
        out.push({ kind: 'node', path: at, name: child.nodeName });
        return;
      }
      for (const name of Object.keys(child.getAttributes()))
        if (!attributes.includes(name))
          out.push({ kind: 'attribute', path: at, name: `${child.nodeName}.${name}` });
      walkBody(child, at, out);
    } else if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as Array<{ insert: unknown; attributes?: object }>) {
        if (typeof op.insert !== 'string') out.push({ kind: 'node', path: at, name: 'embed' });
        for (const [key, attrs] of Object.entries(op.attributes ?? {})) {
          const name = HASHED_MARK.exec(key)?.[1] ?? key;
          const known = MARKS[name];
          if (!known) out.push({ kind: 'mark', path: at, name });
          else if (typeof attrs === 'object' && attrs !== null)
            for (const attr of Object.keys(attrs))
              if (!known.includes(attr))
                out.push({ kind: 'attribute', path: at, name: `${name}.${attr}` });
        }
      }
    } else out.push({ kind: 'node', path: at, name: 'hook' });
  });
}
