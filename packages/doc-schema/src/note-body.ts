// SPDX-License-Identifier: MPL-2.0
import * as Y from 'yjs';
import { NOTE_BODY_SCHEMA } from './strict.ts';

/**
 * Editing a note body without the web's editor (the mobile app's notes editor, decision 0116).
 *
 * A note body is a `Y.XmlFragment` holding ProseMirror nodes as y-prosemirror stores them: a
 * node is a `Y.XmlElement` named after it with its attributes, text is `Y.XmlText` with each
 * mark as a formatting attribute (`bold: {}`, `link: { href, … }`). The web's editor binds it
 * and **deletes** any element whose content does not fit its schema, so a client that writes a
 * body writes only trees that fit `NOTE_BODY_CONTENT`. Every operation here changes only the
 * nodes it names: everything else, attributes and marks it does not know included, stays as
 * it is. A body `checkNoteBody` finds foreign is not edited at all (decision 0101).
 */

export interface NoteNodeRule {
  /** ProseMirror content expression: names or groups, each with `+`, `*` or nothing. */
  readonly content: string;
  /** Groups, space separated. */
  readonly group: string;
  readonly inline: boolean;
  /** Marks the content may carry: absent for all, `''` for none. */
  readonly marks?: string;
}

/**
 * The content model of a note body, the editor's schema as the web's editor declares it (Tiptap
 * StarterKit and the additions of NOTE_BODY_FORMAT). A web test keeps it equal to the editor.
 */
export const NOTE_BODY_CONTENT = {
  doc: { content: 'block+', group: '', inline: false },
  text: { content: '', group: 'inline', inline: true },
  paragraph: { content: 'inline*', group: 'block', inline: false },
  heading: { content: 'inline*', group: 'block', inline: false },
  blockquote: { content: 'block+', group: 'block', inline: false },
  bulletList: { content: 'listItem+', group: 'block list', inline: false },
  orderedList: { content: 'listItem+', group: 'block list', inline: false },
  listItem: { content: 'paragraph block*', group: '', inline: false },
  codeBlock: { content: 'text*', group: 'block', inline: false, marks: '' },
  hardBreak: { content: '', group: 'inline', inline: true },
  horizontalRule: { content: '', group: 'block', inline: false },
  taskList: { content: 'taskItem+', group: 'block list', inline: false },
  taskItem: { content: 'paragraph block*', group: '', inline: false },
  mention: { content: '', group: 'inline', inline: true },
  noteImage: { content: '', group: 'block', inline: false },
} as const satisfies Record<string, NoteNodeRule>;

/** Marks that exclude others (`'_'`: every other mark); the rest exclude only themselves. */
export const NOTE_MARK_EXCLUDES: Readonly<Record<string, string>> = { code: '_' };

/** The attributes the web's editor stores for a mark when it is given only some of them. */
export const NOTE_MARK_DEFAULTS = {
  link: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null },
  noteInk: { color: null, highlight: null },
} as const;

const RULES: Readonly<Record<string, NoteNodeRule>> = NOTE_BODY_CONTENT;
const KNOWN_MARKS: ReadonlySet<string> = new Set(Object.keys(NOTE_BODY_SCHEMA.marks));
const ITEMS: ReadonlySet<string> = new Set(['listItem', 'taskItem']);
/** y-prosemirror stores overlapping marks of one type as `name--<8-character hash>`. */
const baseName = (key: string) => key.replace(/--[a-zA-Z0-9+/=]{8}$/, '');

function inGroup(name: string, term: string): boolean {
  return name === term || (RULES[name]?.group.split(' ').includes(term) ?? false);
}

/** Whether child node names fit a content expression of NOTE_BODY_CONTENT. */
export function fitsContent(expression: string, names: readonly string[]): boolean {
  let i = 0;
  for (const term of expression.split(' ').filter(Boolean)) {
    const q = /[+*?]$/.exec(term)?.[0] ?? '';
    const name = q ? term.slice(0, -1) : term;
    let n = 0;
    while (
      i < names.length &&
      inGroup(names[i] as string, name) &&
      (q === '+' || q === '*' || n < 1)
    ) {
      i++;
      n++;
    }
    if (n === 0 && (q === '' || q === '+')) return false;
  }
  return i === names.length;
}

type Parent = Y.XmlFragment | Y.XmlElement;
type Child = Y.XmlElement | Y.XmlText;

/** The name a child counts as in a content expression; null for an empty text (no node). */
function childName(child: unknown): string | null {
  if (child instanceof Y.XmlElement) return child.nodeName;
  if (child instanceof Y.XmlText) return child.length ? 'text' : null;
  return '#hook';
}

export interface NoteStructureIssue {
  /** Indexes of children from the body down to the node. */
  path: number[];
  node: string;
  reason: 'content' | 'marks';
}

/**
 * Where a body does not fit NOTE_BODY_CONTENT: what the web's editor would delete. Nodes it does
 * not know are the strict check's (`checkNoteBody`), not listed here. An empty body is a new
 * note, and fits.
 */
export function noteStructureIssues(body: Y.XmlFragment): NoteStructureIssue[] {
  const out: NoteStructureIssue[] = [];
  const walk = (node: Parent, name: string, path: number[]) => {
    const rule = RULES[name];
    if (!rule) return;
    const children = node.toArray();
    const names = children.map(childName).filter((n): n is string => n !== null);
    if (!(name === 'doc' && names.length === 0) && !fitsContent(rule.content, names))
      out.push({ path, node: name, reason: 'content' });
    children.forEach((child, i) => {
      if (child instanceof Y.XmlElement) walk(child, child.nodeName, [...path, i]);
      else if (child instanceof Y.XmlText && rule.marks === '' && hasMarks(child))
        out.push({ path: [...path, i], node: name, reason: 'marks' });
    });
  };
  walk(body, 'doc', []);
  return out;
}

type Op = { insert: unknown; attributes?: Record<string, unknown> };
const deltaOf = (text: Y.XmlText) => text.toDelta() as Op[];
const opLength = (op: Op) => (typeof op.insert === 'string' ? op.insert.length : 1);
const hasMarks = (text: Y.XmlText) =>
  deltaOf(text).some((op) => op.attributes && Object.keys(op.attributes).length > 0);

// ---------------------------------------------------------------------------------------------
// Text blocks and inline positions

/** A block that holds text: a paragraph, a heading or a code block. */
export function isTextBlock(node: unknown): node is Y.XmlElement {
  if (!(node instanceof Y.XmlElement)) return false;
  const content = RULES[node.nodeName]?.content;
  return content === 'inline*' || content === 'text*';
}

const lengthOf = (child: unknown) => (child instanceof Y.XmlText ? child.length : 1);

/** Positions inside a text block: each character is 1, each inline node (mention, break) 1. */
export function inlineLength(block: Y.XmlElement): number {
  let n = 0;
  for (const child of block.toArray()) n += lengthOf(child);
  return n;
}

/** Where the editor's caret goes after an operation that moves it to another block. */
export interface NoteCaret {
  block: Y.XmlElement;
  offset: number;
}

/** Marks as stored on text: mark name → its attributes (`{}` for bold, italic…). */
export type NoteMarks = Record<string, Record<string, unknown>>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------------------------
// Characters written as two UTF-16 units (an emoji): Yjs turns half of one into U+FFFD for
// everyone, so no operation ever cuts, formats or inserts between the two halves.

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The string of a text node (an embed, never in a known body, counts as one character). */
const plainOf = (text: Y.XmlText) =>
  deltaOf(text)
    .map((op) => (typeof op.insert === 'string' ? op.insert : '\uFFFC'))
    .join('');

/** A position of a text block moved off the middle of a two-unit character, `down` or `up`. */
function onCodePoint(block: Y.XmlElement, pos: number, dir: 'down' | 'up'): number {
  let start = 0;
  for (const child of block.toArray()) {
    const len = lengthOf(child);
    if (child instanceof Y.XmlText && pos > start && pos < start + len) {
      const s = plainOf(child);
      const k = pos - start;
      if (isHigh(s.charCodeAt(k - 1)) && isLow(s.charCodeAt(k)))
        return dir === 'down' ? pos - 1 : pos + 1;
      return pos;
    }
    start += len;
  }
  return pos;
}

/** The text between two positions of the same text node of a block ('' across nodes). */
function textBetween(block: Y.XmlElement, from: number, to: number): string {
  let start = 0;
  for (const child of block.toArray()) {
    const len = lengthOf(child);
    if (child instanceof Y.XmlText && from >= start && to <= start + len)
      return plainOf(child).slice(from - start, to - start);
    start += len;
  }
  return '';
}

/** Whether a string has no half of a two-unit character on its own. */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isHigh(c) && isLow(text.charCodeAt(i + 1))) i++;
    else if (isHigh(c) || isLow(c)) return false;
  }
  return true;
}

/** The string without halves of two-unit characters on their own. */
function wellFormed(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isHigh(c) && isLow(text.charCodeAt(i + 1))) out += text.slice(i, ++i + 1);
    else if (!isHigh(c) && !isLow(c)) out += text.charAt(i);
  }
  return out;
}

/**
 * A replacement of `[from, to)` by `text` on whole characters (every operation's offsets go
 * through it). A range edge inside a two-unit character takes the whole character, and the half
 * the edit did not mean to change goes back into the text, so an edit worked out unit by unit
 * (👍 → 👎 is "replace the second unit") replaces the emoji whole. What still holds a half on
 * its own (deleting one half, typing between the two) keeps whole characters only: the character
 * is deleted whole, or the typing goes before it.
 */
function onCharacters(
  block: Y.XmlElement,
  from: number,
  to: number,
  text = '',
): { from: number; to: number; text: string } {
  const a = onCodePoint(block, from, 'down');
  const b = onCodePoint(block, to, 'up');
  if (a === from && b === to) return { from, to, text: wellFormed(text) };
  const wrapped = textBetween(block, a, from) + text + textBetween(block, to, b);
  if (isWellFormed(wrapped)) return { from: a, to: b, text: wrapped };
  if (from === to) return { from: a, to: a, text: wellFormed(text) };
  return { from: a, to: b, text: wellFormed(wrapped) };
}

/** Marks that may be stored together: with `code` (it excludes the others) no other known mark. */
function together(marks: NoteMarks): NoteMarks {
  const only = Object.keys(marks).find((k) => NOTE_MARK_EXCLUDES[baseName(k)] === '_');
  if (!only) return marks;
  return Object.fromEntries(
    Object.entries(marks).filter(([k]) => k === only || !KNOWN_MARKS.has(baseName(k))),
  );
}

/**
 * Replaces the inline content between `from` and `to` with `text` carrying exactly `marks`
 * (none in a code block; with `code`, no other known mark, as `formatText`). An inline node in
 * the range goes whole, a two-unit character too (`onCharacters`); marks of the text around are
 * not touched.
 */
export function replaceText(
  block: Y.XmlElement,
  from: number,
  to: number,
  text: string,
  marks: NoteMarks = {},
): void {
  const length = inlineLength(block);
  const a = clamp(from, 0, length);
  const edit = onCharacters(block, a, clamp(to, a, length), text);
  if (edit.to > edit.from) deleteInline(block, edit.from, edit.to);
  if (edit.text)
    insertText(block, edit.from, edit.text, block.nodeName === 'codeBlock' ? {} : together(marks));
}

function deleteInline(block: Y.XmlElement, from: number, to: number): void {
  const nodes: number[] = [];
  let start = 0;
  block.toArray().forEach((child, i) => {
    const end = start + lengthOf(child);
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (b > a) {
      if (child instanceof Y.XmlText) child.delete(a - start, b - a);
      else nodes.push(i);
    }
    start = end;
  });
  for (const i of nodes.reverse()) block.delete(i, 1);
}

function insertText(block: Y.XmlElement, at: number, text: string, marks: NoteMarks): void {
  // Yjs fills the attributes object in: always a fresh copy.
  const attributes = () => Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, { ...v }]));
  const children = block.toArray();
  let start = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const end = start + lengthOf(child);
    if (child instanceof Y.XmlText && at >= start && at <= end) {
      child.insert(at - start, text, attributes());
      return;
    }
    if (at <= start) {
      block.insert(i, [newText(text, attributes())]);
      return;
    }
    start = end;
  }
  block.insert(children.length, [newText(text, attributes())]);
}

function newText(text: string, attributes: NoteMarks): Y.XmlText {
  const t = new Y.XmlText();
  t.insert(0, text, attributes);
  return t;
}

/**
 * Sets a mark on the text between `from` and `to` (`attrs`), or takes it away (`null`). As in
 * the web's editor, `code` excludes every other mark: setting it takes the other known marks
 * away, and no other mark is set on code. Marks this build does not know are never touched.
 */
export function formatText(
  block: Y.XmlElement,
  from: number,
  to: number,
  mark: string,
  attrs: Record<string, unknown> | null,
): void {
  if (block.nodeName === 'codeBlock' || !KNOWN_MARKS.has(mark)) return;
  const range = onCharacters(block, from, to);
  from = range.from;
  to = range.to;
  let start = 0;
  for (const child of block.toArray()) {
    const end = start + lengthOf(child);
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (child instanceof Y.XmlText && b > a) formatRuns(child, a - start, b - a, mark, attrs);
    start = end;
  }
}

function formatRuns(
  text: Y.XmlText,
  index: number,
  length: number,
  mark: string,
  attrs: Record<string, unknown> | null,
): void {
  let pos = 0;
  for (const op of deltaOf(text)) {
    const n = opLength(op);
    const a = Math.max(index, pos);
    const b = Math.min(index + length, pos + n);
    pos += n;
    if (b <= a) continue;
    const keys = Object.keys(op.attributes ?? {});
    const patch: Record<string, unknown> = {};
    if (attrs === null) {
      for (const k of keys) if (baseName(k) === mark) patch[k] = null;
    } else if (!keys.some((k) => baseName(k) !== mark && NOTE_MARK_EXCLUDES[baseName(k)] === '_')) {
      for (const k of keys) if (baseName(k) === mark && k !== mark) patch[k] = null;
      if (NOTE_MARK_EXCLUDES[mark] === '_')
        for (const k of keys)
          if (baseName(k) !== mark && KNOWN_MARKS.has(baseName(k))) patch[k] = null;
      patch[mark] = { ...attrs };
    }
    if (Object.keys(patch).length) text.format(a, b - a, patch);
  }
}

/** Inserts a mention (`{ id, label }`) or a line break at `at`; not in a code block. */
export function insertInline(
  block: Y.XmlElement,
  at: number,
  name: 'mention' | 'hardBreak',
  attrs: Record<string, string> = {},
): boolean {
  if (block.nodeName === 'codeBlock') return false;
  const node = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  const tail = cutInline(block, clamp(at, 0, inlineLength(block)));
  block.insert(block.length, [node, ...nodesOf(tail)]);
  return true;
}

/** Inline content taken out of a block: text as its runs, an inline node as a copy. */
type Cut = Op[] | Y.XmlElement;

/**
 * Takes the inline content from `from` to the end out of the block (from a whole character on),
 * text as runs, so where it goes it joins the text already there (`nodesOf`, `appendInline`).
 */
function cutInline(block: Y.XmlElement, from: number): Cut[] {
  const at = onCodePoint(block, from, 'down');
  const out: Cut[] = [];
  const children = block.toArray();
  let first = children.length;
  let start = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (start >= at) {
      first = i;
      break;
    }
    const len = lengthOf(child);
    if (child instanceof Y.XmlText && at < start + len) {
      const off = at - start;
      out.push(sliceDelta(deltaOf(child), off));
      child.delete(off, len - off);
    }
    start += len;
  }
  for (const child of children.slice(first))
    out.push(
      child instanceof Y.XmlText ? sliceDelta(deltaOf(child), 0) : (child as Y.XmlElement).clone(),
    );
  if (first < children.length) block.delete(first, children.length - first);
  return out;
}

/** Cut content as new nodes: neighbouring text in one text node, as the web's editor keeps it. */
function nodesOf(cut: Cut[]): Child[] {
  const out: Child[] = [];
  let runs: Op[] = [];
  const flush = () => {
    if (!runs.length) return;
    const text = new Y.XmlText();
    text.applyDelta(runs);
    out.push(text);
    runs = [];
  };
  for (const part of cut) {
    if (Array.isArray(part)) runs.push(...part);
    else {
      flush();
      out.push(part);
    }
  }
  flush();
  return out;
}

/** Puts cut content at the end of a block, its first text into the block's last text node. */
function appendInline(target: Y.XmlElement, cut: Cut[]): void {
  const last = target.length ? target.get(target.length - 1) : null;
  let rest = cut;
  if (last instanceof Y.XmlText) {
    let at = last.length;
    while (rest.length && Array.isArray(rest[0])) {
      for (const op of rest[0] as Op[])
        if (typeof op.insert === 'string') {
          // Given attributes are exactly the run's marks (Yjs clears those of the text before).
          last.insert(at, op.insert, copyMarks(op.attributes ?? {}));
          at += op.insert.length;
        }
      rest = rest.slice(1);
    }
  }
  const nodes = nodesOf(rest);
  if (nodes.length) target.insert(target.length, nodes);
}

function sliceDelta(delta: Op[], from: number): Op[] {
  const out: Op[] = [];
  let pos = 0;
  for (const op of delta) {
    const n = opLength(op);
    if (pos + n > from && typeof op.insert === 'string') {
      const insert = op.insert.slice(Math.max(0, from - pos));
      out.push(op.attributes ? { insert, attributes: copyMarks(op.attributes) } : { insert });
    }
    pos += n;
  }
  return out;
}

const copyMarks = (marks: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(marks).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v } : v]),
  );

// ---------------------------------------------------------------------------------------------
// Blocks

function indexIn(parent: Parent, node: unknown): number {
  return parent.toArray().indexOf(node as Child);
}

function parentOf(node: Y.XmlElement): Parent {
  const parent = node.parent;
  if (!(parent instanceof Y.XmlElement || parent instanceof Y.XmlFragment))
    throw new Error('the node is not in a note body');
  return parent;
}

function copyAttributes(from: Y.XmlElement, to: Y.XmlElement, only?: readonly string[]): void {
  for (const [k, v] of Object.entries(from.getAttributes()))
    if (!only || only.includes(k)) to.setAttribute(k, v as string);
}

const isItem = (node: unknown): node is Y.XmlElement =>
  node instanceof Y.XmlElement && ITEMS.has(node.nodeName);

function newItem(type: string): Y.XmlElement {
  const item = new Y.XmlElement(type);
  // y-prosemirror stores every attribute that is not null: a new task is `checked: false`.
  if (type === 'taskItem') item.setAttribute('checked', false as unknown as string);
  return item;
}

/** The last text block inside a node (itself if it is one), or null (a picture, a rule). */
function lastTextBlock(node: unknown): Y.XmlElement | null {
  if (isTextBlock(node)) return node;
  if (!(node instanceof Y.XmlElement)) return null;
  const children = node.toArray();
  for (let i = children.length - 1; i >= 0; i--) {
    const found = lastTextBlock(children[i]);
    if (found) return found;
  }
  return null;
}

function firstTextBlock(node: unknown): Y.XmlElement | null {
  if (isTextBlock(node)) return node;
  if (!(node instanceof Y.XmlElement)) return null;
  for (const child of node.toArray()) {
    const found = firstTextBlock(child);
    if (found) return found;
  }
  return null;
}

/**
 * Moves the children of `container` from `index` out of it, `replacement` taking the place of
 * the child at `index`: the children after it go to a copy of the container placed after.
 * An emptied container goes.
 */
function splitOut(container: Y.XmlElement, index: number, replacement: Child[]): void {
  const outer = parentOf(container);
  const at = indexIn(outer, container);
  const after = container
    .toArray()
    .slice(index + 1)
    .map((c) => (c as Child).clone());
  container.delete(index, container.length - index);
  const parts: Child[] = [...replacement];
  if (after.length) {
    const rest = new Y.XmlElement(container.nodeName);
    copyAttributes(container, rest);
    rest.insert(0, after);
    parts.push(rest);
  }
  outer.insert(at + 1, parts);
  if (container.length === 0) outer.delete(at, 1);
}

/**
 * Takes a list item out of its list, one level, as the web's editor does: from a nested list it
 * becomes an item of the list around it, after the item it was in, the items after it nested
 * under it; from a top list its blocks go where it was, the list split around it.
 */
function liftItem(item: Y.XmlElement, offset = 0): NoteCaret {
  const list = parentOf(item) as Y.XmlElement;
  const holder = list.parent;
  if (isItem(holder)) {
    const outer = parentOf(holder) as Y.XmlElement;
    const i = indexIn(list, item);
    const content = item.toArray().map((c) => (c as Child).clone());
    const after = list
      .toArray()
      .slice(i + 1)
      .map((c) => (c as Child).clone());
    if (after.length) {
      const rest = new Y.XmlElement(list.nodeName);
      copyAttributes(list, rest);
      rest.insert(0, after);
      content.push(rest);
    }
    const lifted = newItem(outer.nodeName === 'taskList' ? 'taskItem' : 'listItem');
    if (lifted.nodeName === 'taskItem' && item.nodeName === 'taskItem')
      lifted.setAttribute('checked', item.getAttribute('checked') as string);
    lifted.insert(0, content);
    list.delete(i, list.length - i);
    outer.insert(indexIn(outer, holder) + 1, [lifted]);
    if (list.length === 0) holder.delete(indexIn(holder, list), 1);
    return { block: firstTextBlock(content[0]) as Y.XmlElement, offset };
  }
  const moved = item.toArray().map((c) => (c as Child).clone());
  splitOut(list, indexIn(list, item), moved);
  return { block: firstTextBlock(moved[0]) as Y.XmlElement, offset };
}

/**
 * Enter at `at`: the text after it goes to a new block after this one (a new item in a list, a
 * paragraph after a heading's end). In an empty item, or an empty block in a quote, the block
 * leaves its container instead; in a code block it is a new line.
 */
export function splitBlock(block: Y.XmlElement, at: number): NoteCaret {
  if (block.nodeName === 'codeBlock') {
    replaceText(block, at, at, '\n');
    return { block, offset: at + 1 };
  }
  const parent = parentOf(block);
  const index = indexIn(parent, block);
  const length = inlineLength(block);
  const item = isItem(parent) && index === 0 ? parent : null;
  if (length === 0 && item && item.length === 1) return liftItem(item);
  if (length === 0 && parent instanceof Y.XmlElement && parent.nodeName === 'blockquote') {
    const empty = new Y.XmlElement('paragraph');
    splitOut(parent, index, [empty]);
    return { block: empty, offset: 0 };
  }
  const atEnd = at >= length;
  const type = block.nodeName === 'heading' && atEnd ? 'paragraph' : block.nodeName;
  const next = new Y.XmlElement(type);
  copyAttributes(block, next, type === block.nodeName ? undefined : ['textAlign']);
  const tail = cutInline(block, clamp(at, 0, length));
  if (tail.length) next.insert(0, nodesOf(tail));
  if (item) {
    const list = parentOf(item);
    const added = newItem(item.nodeName);
    added.insert(0, [next]);
    list.insert(indexIn(list, item) + 1, [added]);
  } else parent.insert(index + 1, [next]);
  return { block: next, offset: 0 };
}

/**
 * Backspace at the start of a block: it joins the text block before it, or, first in a list
 * item, the item before (the first item leaves the list); first in a quote, it leaves the quote.
 * Null when there is nothing to join (a picture or a rule before it, or the start of the body):
 * the editor decides.
 */
export function joinBackward(block: Y.XmlElement): NoteCaret | null {
  const parent = parentOf(block);
  const index = indexIn(parent, block);
  if (index === 0 && isItem(parent)) {
    const list = parentOf(parent);
    const i = indexIn(list, parent);
    if (i === 0) return liftItem(parent);
    const target = lastTextBlock(list.get(i - 1));
    if (!target || target.nodeName === 'codeBlock') return null;
    const offset = inlineLength(target);
    appendInline(target, cutInline(block, 0));
    const rest = parent
      .toArray()
      .slice(1)
      .map((c) => (c as Child).clone());
    const previous = list.get(i - 1) as Y.XmlElement;
    if (rest.length) previous.insert(previous.length, rest);
    list.delete(i, 1);
    return { block: target, offset };
  }
  if (index === 0 && parent instanceof Y.XmlElement && parent.nodeName === 'blockquote') {
    const copy = block.clone();
    splitOut(parent, 0, [copy]);
    return { block: copy, offset: 0 };
  }
  if (index === 0) return null;
  const target = lastTextBlock(parent.get(index - 1));
  if (!target) return null;
  const offset = inlineLength(target);
  if (target.nodeName === 'codeBlock') {
    // Code holds plain text only: an empty block goes, any other stays.
    if (inlineLength(block) > 0) return null;
  } else {
    appendInline(target, cutInline(block, 0));
  }
  parent.delete(index, 1);
  return { block: target, offset };
}

/**
 * Makes a text block a paragraph or a heading (`level` 1–3), keeping its text and alignment.
 * Null when the result would not fit: a heading first in a list item, a code block.
 */
export function setTextBlock(
  block: Y.XmlElement,
  type: 'paragraph' | 'heading',
  level = 1,
  offset = 0,
): NoteCaret | null {
  if (block.nodeName !== 'paragraph' && block.nodeName !== 'heading') return null;
  const parent = parentOf(block);
  const index = indexIn(parent, block);
  if (type === 'heading' && isItem(parent) && index === 0) return null;
  if (type === block.nodeName) {
    if (type === 'heading' && block.getAttribute('level') !== (level as unknown as string))
      block.setAttribute('level', level as unknown as string);
    return { block, offset };
  }
  const next = new Y.XmlElement(type);
  copyAttributes(block, next, ['textAlign']);
  if (type === 'heading') next.setAttribute('level', level as unknown as string);
  const content = nodesOf(cutInline(block, 0));
  if (content.length) next.insert(0, content);
  parent.insert(index + 1, [next]);
  parent.delete(index, 1);
  return { block: next, offset };
}

/**
 * The list button: a text block becomes an item of a `kind` list (joining a list of that kind
 * just before it); the first block of an item of that kind leaves the list; an item of another
 * kind of list turns the whole list into `kind`. Null for a code block.
 */
export function toggleList(
  block: Y.XmlElement,
  kind: 'bulletList' | 'taskList',
  offset = 0,
): NoteCaret | null {
  if (block.nodeName !== 'paragraph' && block.nodeName !== 'heading') return null;
  const itemType = kind === 'taskList' ? 'taskItem' : 'listItem';
  const parent = parentOf(block);
  const index = indexIn(parent, block);
  if (isItem(parent) && index === 0) {
    const list = parentOf(parent) as Y.XmlElement;
    if (list.nodeName === kind) return liftItem(parent, offset);
    const outer = parentOf(list);
    const next = new Y.XmlElement(kind);
    let caret = null as Y.XmlElement | null;
    const items = list.toArray().map((old) => {
      const item = newItem(itemType);
      const children = (old as Y.XmlElement).toArray().map((c) => (c as Child).clone());
      if (old === parent) caret = children[0] as Y.XmlElement;
      if (old instanceof Y.XmlElement && itemType === 'taskItem' && old.nodeName === 'taskItem')
        item.setAttribute('checked', old.getAttribute('checked') as string);
      item.insert(0, children);
      return item;
    });
    next.insert(0, items);
    const at = indexIn(outer, list);
    outer.insert(at + 1, [next]);
    outer.delete(at, 1);
    return caret ? { block: caret, offset } : null;
  }
  const paragraph = new Y.XmlElement('paragraph');
  copyAttributes(block, paragraph, ['textAlign']);
  const content = nodesOf(cutInline(block, 0));
  if (content.length) paragraph.insert(0, content);
  const item = newItem(itemType);
  item.insert(0, [paragraph]);
  const previous = index > 0 ? parent.get(index - 1) : null;
  parent.delete(index, 1);
  if (previous instanceof Y.XmlElement && previous.nodeName === kind)
    previous.insert(previous.length, [item]);
  else {
    const list = new Y.XmlElement(kind);
    list.insert(0, [item]);
    parent.insert(index, [list]);
  }
  return { block: paragraph, offset };
}

/** Ticks or unticks a task item. */
export function setTaskChecked(item: Y.XmlElement, checked: boolean): void {
  if (item.nodeName !== 'taskItem') throw new Error('only a task item is ticked');
  if (item.getAttribute('checked') !== (checked as unknown as string))
    item.setAttribute('checked', checked as unknown as string);
}

/** The task item a text block is the first paragraph of, if any. */
export function taskItemOf(block: Y.XmlElement): Y.XmlElement | null {
  const parent = block.parent;
  return parent instanceof Y.XmlElement &&
    parent.nodeName === 'taskItem' &&
    parent.toArray()[0] === block
    ? parent
    : null;
}

/**
 * Inserts a picture (`{ assetId, alt? }`) or a rule after `after` (an empty paragraph is
 * replaced), or at the end of the body; a text block follows it, for the caret.
 */
export function insertBlock(
  body: Y.XmlFragment,
  after: Y.XmlElement | null,
  name: 'noteImage' | 'horizontalRule',
  attrs: Record<string, string> = {},
): NoteCaret {
  const node = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  const parent = after ? parentOf(after) : body;
  let index = after ? indexIn(parent, after) + 1 : parent.length;
  const replaces =
    after?.nodeName === 'paragraph' &&
    inlineLength(after) === 0 &&
    !(isItem(parent) && index === 1);
  if (replaces) {
    parent.delete(index - 1, 1);
    index--;
  }
  parent.insert(index, [node]);
  const next = parent.get(index + 1);
  if (isTextBlock(next)) return { block: next, offset: 0 };
  const paragraph = new Y.XmlElement('paragraph');
  parent.insert(index + 1, [paragraph]);
  return { block: paragraph, offset: 0 };
}

/**
 * Removes a block (a picture, a rule, any block): a container left empty goes too, and an item
 * left without its first paragraph gets an empty one.
 */
export function removeNode(node: Y.XmlElement): void {
  let current = node;
  for (;;) {
    const parent = parentOf(current);
    parent.delete(indexIn(parent, current), 1);
    if (!(parent instanceof Y.XmlElement)) return;
    if (parent.length === 0) {
      current = parent;
      continue;
    }
    if (isItem(parent) && (parent.get(0) as Y.XmlElement).nodeName !== 'paragraph')
      parent.insert(0, [new Y.XmlElement('paragraph')]);
    return;
  }
}

/** A paragraph to type in at the end of the body: the last block if it is an empty one. */
export function appendParagraph(body: Y.XmlFragment): NoteCaret {
  const last = body.length ? body.get(body.length - 1) : null;
  if (last instanceof Y.XmlElement && last.nodeName === 'paragraph' && inlineLength(last) === 0)
    return { block: last, offset: 0 };
  const paragraph = new Y.XmlElement('paragraph');
  body.insert(body.length, [paragraph]);
  return { block: paragraph, offset: 0 };
}
