// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots, UNSORTED } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  type ClipboardData,
  copyElements,
  createElement,
  deleteElements,
  listElements,
  RestoreRefusedError,
  restoreElements,
} from './board.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const opts = { userId: 'u1' };
const at = { x: 500, y: 300 };
const through = (data: unknown): ClipboardData => JSON.parse(JSON.stringify(data));

/** A board with a column holding a note with text, and a free note; copied, then deleted. */
function deletedCards() {
  const doc = createBoardDoc(boardId);
  const column = createElement(doc, 'column', { x: 10, y: 20 }, { title: 'Refs' }, opts).id;
  const inside = createElement(doc, 'note', { x: 0, y: 0 }, { parent: column }, opts).id;
  const body = roots(doc).elements.get(inside)?.get('body') as Y.XmlFragment;
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('kept text')]);
  body.insert(0, [paragraph]);
  const free = createElement(doc, 'note', { x: 40, y: 50 }, {}, opts).id;
  const before = new Map(listElements(doc).map((e) => [e.id, e]));
  const copy = through(copyElements(doc, [column, free]));
  deleteElements(doc, [column, free]);
  return { doc, column, inside, free, before, copy };
}

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (err) {
    if (err instanceof RestoreRefusedError) return { reason: err.reason, present: err.present };
    throw err;
  }
  return null;
};

describe('restoreElements', () => {
  it('puts the cards back under their own ids, with their fields, parent and text', () => {
    const { doc, column, inside, free, before, copy } = deletedCards();
    expect(roots(doc).elements.size).toBe(0);
    const result = restoreElements(doc, copy, at);
    expect(result.ids.sort()).toEqual([column, free].sort());
    expect(result.outside).toEqual([]);
    expect(result.own.sort()).toEqual([column, inside, free].sort());
    for (const el of listElements(doc)) expect(el).toEqual(before.get(el.id));
    const body = roots(doc).elements.get(inside)?.get('body') as Y.XmlFragment;
    expect(body.toString()).toContain('kept text');
  });

  it('refuses the whole copy when one of its cards is on the board, and writes nothing', () => {
    const { doc, free, copy } = deletedCards();
    // Someone else put the free note back meanwhile.
    restoreElements(doc, { ...copy, elements: copy.elements.filter((e) => e.id === free) }, at);
    const state = Y.encodeStateVector(doc);
    expect(refusal(() => restoreElements(doc, copy, at))).toEqual({
      reason: 'present',
      present: [free],
    });
    expect(Y.encodeStateVector(doc)).toEqual(state);
  });

  it('puts a card whose column is gone on the canvas at the point, on top', () => {
    const { doc, inside, copy } = deletedCards();
    const only = { ...copy, elements: copy.elements.filter((e) => e.id === inside) };
    const other = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const result = restoreElements(doc, only, at);
    expect(result).toEqual({ ids: [inside], outside: [inside], own: [inside], parents: [] });
    const card = listElements(doc).find((e) => e.id === inside);
    expect(card).toMatchObject({ parent: null, x: at.x, y: at.y });
    expect((card?.z ?? '') > other.z).toBe(true);
  });

  it('keeps a card inside a column or scene of the board, or among the unsorted', () => {
    const { doc, column, inside, copy } = deletedCards();
    // The column alone came back first; then the note inside it.
    restoreElements(doc, { ...copy, elements: copy.elements.filter((e) => e.id === column) }, at);
    const result = restoreElements(
      doc,
      { ...copy, elements: copy.elements.filter((e) => e.id === inside) },
      at,
    );
    expect(result.outside).toEqual([]);
    expect(result.parents).toEqual([column]);
    expect(listElements(doc).find((e) => e.id === inside)?.parent).toBe(column);
    const unsorted = createBoardDoc(boardId);
    const loose = createElement(unsorted, 'note', at, { parent: UNSORTED }, opts).id;
    const copied = through(copyElements(unsorted, [loose]));
    deleteElements(unsorted, [loose]);
    expect(restoreElements(unsorted, copied, at).outside).toEqual([]);
  });

  it('refuses a copy with a card that does not validate, instead of leaving it out', () => {
    const { doc, free, copy } = deletedCards();
    const broken = through(copy);
    const note = broken.elements.find((e) => e.id === free) as unknown as Record<string, unknown>;
    note.x = 'left';
    expect(refusal(() => restoreElements(doc, broken, at))?.reason).toBe('invalid');
    expect(refusal(() => restoreElements(doc, { ...copy, elements: [] }, at))?.reason).toBe(
      'invalid',
    );
    expect(refusal(() => restoreElements(doc, null as unknown as ClipboardData, at))?.reason).toBe(
      'invalid',
    );
    expect(roots(doc).elements.size).toBe(0);
  });

  it('refuses content of a newer schema it does not know', () => {
    const { doc, free, copy } = deletedCards();
    const newer = through(copy);
    newer.source = { boardId, schemaVersion: 999 };
    const note = newer.elements.find((e) => e.id === free) as unknown as Record<string, unknown>;
    note.unknownField = 1;
    note.type = 'hologram';
    expect(refusal(() => restoreElements(doc, newer, at))?.reason).toBe('newer');
  });

  it('writes in one transaction tagged with the origin', () => {
    const { doc, copy } = deletedCards();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    restoreElements(doc, copy, at, { origin: 'restore' });
    expect(origins).toEqual(['restore']);
  });
});
