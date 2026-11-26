// SPDX-License-Identifier: MPL-2.0
import { roots } from '@inkadra/doc-schema';
import * as Y from 'yjs';

/**
 * Edits that reach cards just removed from a board (decision 0140): a colleague's change still
 * on its way when the cards left. Yjs takes it in, into the removed card, and drops it; read in
 * time, it can follow the card to where it went.
 */
export interface LateEdit {
  /** The card written to: a removed card, or one inside it. */
  cardId: string;
  /** The removed card it is or is in (its scene, plan or list). */
  topId: string;
  /** Plain fields set on it, as the colleague left them. */
  fields: Record<string, unknown>;
  /** Plain items added to its lists (strokes, shapes), by list. */
  appended: Record<string, unknown[]>;
  /** Something that cannot be carried over (a new nested list, an item of a list of maps). */
  lost: boolean;
}

export interface RemovalWatch {
  /** Stops watching and lets Yjs collect the removed cards. */
  stop: () => void;
}

/** Where a card sits on its board: never carried to the other board, where it means nothing. */
const PLACE_KEYS = new Set(['x', 'y', 'z', 'parent']);

const isNew = (item: Y.Item, doc: Y.Doc, before: Map<number, number>) =>
  item.id.client !== doc.clientID && item.id.clock >= (before.get(item.id.client) ?? 0);

/** New items of a remote transaction in a list (strokes, shapes, items). */
function listEdits(list: Y.Array<unknown>, doc: Y.Doc, before: Map<number, number>) {
  const added: unknown[] = [];
  let lost = false;
  for (let item = list._start; item !== null; item = item.right) {
    if (!isNew(item, doc, before)) continue;
    if (item.content instanceof Y.ContentType) lost = true;
    else added.push(...item.content.getContent());
  }
  return { added, lost };
}

/**
 * Watches cards about to be removed with `origin` (their ids; what is inside them comes too) and
 * calls `onLate` with what a colleague's update writes into them once removed, and with the cards
 * a colleague adds inside them (a frame in a removed scene), which would be lost from sight.
 * Call it before the removal: it keeps the removed cards from being collected until `stop`.
 * shortcut: reads Yjs internals (`_map`, `_start`), pinned by the tests of late-edits.test.ts.
 */
export function watchRemoval(
  doc: Y.Doc,
  ids: readonly string[],
  origin: unknown,
  onLate: (edits: LateEdit[], orphans: Array<{ id: string; topId: string }>) => void,
): RemovalWatch {
  const elements = roots(doc).elements;
  const top = new Set(ids);
  const cards = new Map<Y.Map<unknown>, { id: string; topId: string }>();
  for (const [id, map] of elements.entries()) {
    const parent = map.get('parent') as string;
    if (top.has(id)) cards.set(map, { id, topId: id });
    else if (top.has(parent)) cards.set(map, { id, topId: parent });
  }
  // Kept from being collected: a late write lands in them and can be read.
  const keep = new Y.UndoManager(elements, { trackedOrigins: new Set([origin]) });
  const seen = new Set<string>();
  const onTransaction = (tr: Y.Transaction) => {
    if (tr.local || tr.origin === origin) return;
    const before = tr.beforeState;
    const edits: LateEdit[] = [];
    for (const [map, { id: cardId, topId }] of cards) {
      if (!map._item?.deleted) continue;
      const edit: LateEdit = { cardId, topId, fields: {}, appended: {}, lost: false };
      let touched = false;
      for (const [key, item] of map._map) {
        if (isNew(item, doc, before)) {
          touched = true;
          if (item.content instanceof Y.ContentType) edit.lost = true;
          else if (!PLACE_KEYS.has(key)) {
            const [value] = item.content.getContent().slice(-1);
            if (value !== undefined) edit.fields[key] = value;
          }
        } else if (item.content instanceof Y.ContentType && item.content.type instanceof Y.Array) {
          const { added, lost } = listEdits(item.content.type, doc, before);
          if (added.length || lost) touched = true;
          if (added.length) edit.appended[key] = added;
          if (lost) edit.lost = true;
        }
      }
      if (touched) edits.push(edit);
    }
    // Cards a colleague put inside a removed card: here, but in nothing anyone can see.
    const orphans: Array<{ id: string; topId: string }> = [];
    for (const [id, map] of elements.entries()) {
      const parent = map.get('parent');
      if (typeof parent === 'string' && top.has(parent) && !elements.has(parent) && !seen.has(id)) {
        seen.add(id);
        orphans.push({ id, topId: parent });
      }
    }
    if (edits.length || orphans.length) onLate(edits, orphans);
  };
  doc.on('afterTransaction', onTransaction);
  return {
    stop: () => {
      doc.off('afterTransaction', onTransaction);
      keep.destroy();
    },
  };
}

/**
 * Writes late edits on the cards where they went (same ids). Resolves with how many could not
 * be carried over: a card that is not there, or an edit marked `lost`.
 */
export function applyLateEdits(doc: Y.Doc, edits: readonly LateEdit[], origin?: unknown): number {
  const elements = roots(doc).elements;
  let lost = 0;
  doc.transact(() => {
    for (const edit of edits) {
      const map = elements.get(edit.cardId);
      if (!map) {
        lost += 1;
        continue;
      }
      for (const [key, value] of Object.entries(edit.fields)) map.set(key, value);
      for (const [key, items] of Object.entries(edit.appended)) {
        const list = map.get(key);
        if (list instanceof Y.Array) list.push(items);
        else edit.lost = true;
      }
      if (edit.lost) lost += 1;
    }
  }, origin);
  return lost;
}
