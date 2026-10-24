import {
  AspectRatio,
  addElement,
  Element,
  initBoardDoc,
  roots,
  setBoardAspect,
} from '@inkadra/doc-schema';
import type { GuestElement } from '@inkadra/shared';
import * as Y from 'yjs';

/**
 * The guest page draws a snapshot with the board's own canvas, which reads a Y.Doc. This doc
 * lives only in the page: it has no provider, is never sent anywhere, and is rewritten from
 * each new snapshot. Elements that did not change keep their Y.Map, so the canvas keeps its
 * measured sizes and redraws only what moved.
 */

type PmNode = {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  marks?: unknown;
  content?: unknown;
};

/** Rich text of a note, as ProseMirror JSON, written the way y-prosemirror stores it. */
export function fillFromProseMirror(fragment: Y.XmlFragment, json: unknown) {
  const doc = json as PmNode | null;
  const nodes = Array.isArray(doc?.content) ? (doc.content as PmNode[]) : [];
  fragment.insert(0, toYNodes(nodes));
}

function toYNodes(nodes: PmNode[]): Array<Y.XmlElement | Y.XmlText> {
  const out: Array<Y.XmlElement | Y.XmlText> = [];
  let text: Y.XmlText | null = null;
  // A text not yet in a doc reports length 0 and applies its edits later: count ourselves.
  let offset = 0;
  for (const node of nodes) {
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.text === '') continue;
      if (!text) {
        text = new Y.XmlText();
        offset = 0;
        out.push(text);
      }
      text.insert(offset, node.text, marksOf(node.marks));
      offset += node.text.length;
      continue;
    }
    text = null;
    if (typeof node.type !== 'string') continue;
    const el = new Y.XmlElement(node.type);
    if (node.attrs && typeof node.attrs === 'object') {
      for (const [key, value] of Object.entries(node.attrs)) {
        if (value !== null && value !== undefined) el.setAttribute(key, value as string);
      }
    }
    const children = Array.isArray(node.content) ? toYNodes(node.content as PmNode[]) : [];
    if (children.length > 0) el.insert(0, children);
    out.push(el);
  }
  return out;
}

function marksOf(marks: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(marks)) return out;
  for (const m of marks as Array<{ type?: unknown; attrs?: unknown }>) {
    if (typeof m.type === 'string')
      out[m.type] = m.attrs && typeof m.attrs === 'object' ? m.attrs : {};
  }
  return out;
}

/** A doc for the guest page, empty until the first snapshot. */
export function createGuestDoc(boardId: string): Y.Doc {
  const doc = new Y.Doc();
  initBoardDoc(doc, boardId);
  return doc;
}

/** What a guest element looked like when it was written, to skip unchanged ones next time. */
const written = new WeakMap<Y.Map<unknown>, string>();

/**
 * Makes the doc show exactly the elements of a snapshot. Elements that do not parse (a type
 * this build does not know) are left out rather than breaking the board.
 */
export function syncGuestDoc(doc: Y.Doc, elements: readonly GuestElement[], aspect: string | null) {
  const { elements: map } = roots(doc);
  doc.transact(() => {
    const parsedAspect = AspectRatio.safeParse(aspect);
    setBoardAspect(doc, parsedAspect.success ? parsedAspect.data : null);
    const keep = new Set<string>();
    for (const raw of elements) {
      const { body, ...fields } = raw;
      const parsed = Element.safeParse(fields);
      if (!parsed.success) continue;
      const key = JSON.stringify(raw);
      keep.add(parsed.data.id);
      const existing = map.get(parsed.data.id);
      if (existing && written.get(existing) === key) continue;
      if (existing) map.delete(parsed.data.id);
      const created = addElement(doc, parsed.data);
      written.set(created, key);
      const fragment = created.get('body');
      if (body && fragment instanceof Y.XmlFragment) fillFromProseMirror(fragment, body);
    }
    for (const id of [...map.keys()]) if (!keep.has(id)) map.delete(id);
  });
}
