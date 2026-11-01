// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots, UNSORTED, validateBoardDoc } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addTodoItem,
  bringToFront,
  canvasElements,
  childrenOf,
  copyElements,
  createElement,
  deleteElements,
  duplicateElements,
  listElements,
  moveIntoParent,
  moveToCanvas,
  pasteElements,
  sectionMembers,
  updateElement,
  updateTodoItem,
} from './board.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const opts = { userId: null };
const setup = () => createBoardDoc(boardId);
const ids = (els: { id: string }[]) => els.map((e) => e.id);

describe('board operations', () => {
  it('creates elements on top, with defaults', () => {
    const doc = setup();
    const a = createElement(doc, 'note', { x: 10.4, y: 20 }, {}, opts);
    const b = createElement(doc, 'column', { x: 300, y: 0 }, { title: 'Location' }, opts);
    expect(a.w).toBe(240);
    expect(a.x).toBe(10);
    expect(b.z > a.z).toBe(true);
    expect(roots(doc).elements.get(a.id)?.get('body')).toBeInstanceOf(Y.XmlFragment);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('orders cards inside a column and moves them back to the canvas', () => {
    const doc = setup();
    const col = createElement(doc, 'column', { x: 0, y: 0 }, { title: 'A' }, opts);
    const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const b = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const c = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    moveIntoParent(doc, [a.id, b.id], col.id, 0);
    moveIntoParent(doc, [c.id], col.id, 1);
    expect(ids(childrenOf(listElements(doc), col.id))).toEqual([a.id, c.id, b.id]);
    // Move the first card to the end of its own column.
    moveIntoParent(doc, [a.id], col.id, 3);
    expect(ids(childrenOf(listElements(doc), col.id))).toEqual([c.id, b.id, a.id]);
    moveToCanvas(doc, [{ id: b.id, x: 500, y: 40 }]);
    const after = listElements(doc);
    expect(ids(childrenOf(after, col.id))).toEqual([c.id, a.id]);
    expect(canvasElements(after).at(-1)?.id).toBe(b.id);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('never nests a column in a column', () => {
    const doc = setup();
    const a = createElement(doc, 'column', { x: 0, y: 0 }, { title: 'A' }, opts);
    const b = createElement(doc, 'column', { x: 0, y: 0 }, { title: 'B' }, opts);
    moveIntoParent(doc, [b.id], a.id, 0);
    expect(childrenOf(listElements(doc), a.id)).toEqual([]);
  });

  it('deletes a column with its cards', () => {
    const doc = setup();
    const col = createElement(doc, 'column', { x: 0, y: 0 }, { title: 'A' }, opts);
    const card = createElement(doc, 'note', { x: 0, y: 0 }, { parent: col.id }, opts);
    const other = createElement(doc, 'note', { x: 0, y: 0 }, { parent: UNSORTED }, opts);
    deleteElements(doc, [col.id]);
    expect(ids(listElements(doc))).toEqual([other.id]);
    expect(card.parent).toBe(col.id);
  });

  it('undoes a multi-element edit in one step', () => {
    const doc = setup();
    const origin = Symbol('local');
    const undo = new Y.UndoManager(roots(doc).elements, { trackedOrigins: new Set([origin]) });
    const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, { ...opts, origin });
    const b = createElement(doc, 'note', { x: 0, y: 0 }, {}, { ...opts, origin });
    undo.stopCapturing();
    moveToCanvas(
      doc,
      [
        { id: a.id, x: 100, y: 100 },
        { id: b.id, x: 200, y: 200 },
      ],
      origin,
    );
    undo.undo();
    expect(listElements(doc).map((e) => e.x)).toEqual([0, 0]);
  });

  it('brings elements to the front', () => {
    const doc = setup();
    const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    bringToFront(doc, [a.id]);
    expect(canvasElements(listElements(doc)).at(-1)?.id).toBe(a.id);
  });

  it('duplicates columns with their cards and note bodies', () => {
    const doc = setup();
    const col = createElement(doc, 'column', { x: 0, y: 0 }, { title: 'A' }, opts);
    const note = createElement(doc, 'note', { x: 0, y: 0 }, { parent: col.id }, opts);
    const body = roots(doc).elements.get(note.id)?.get('body') as Y.XmlFragment;
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Logline')]);
    body.insert(0, [p]);
    const [copy] = duplicateElements(doc, [col.id], { x: 20, y: 20 }, opts);
    const all = listElements(doc);
    const kids = childrenOf(all, copy!);
    expect(kids).toHaveLength(1);
    const copiedBody = roots(doc).elements.get(kids[0]!.id)?.get('body') as Y.XmlFragment;
    expect(copiedBody.toString()).toContain('Logline');
    expect(all.find((e) => e.id === copy)?.x).toBe(20);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('copies and pastes across documents', () => {
    const doc = setup();
    const a = createElement(doc, 'todo', { x: 100, y: 100 }, { items: [] }, opts);
    addTodoItem(doc, a.id, 'Sopralluogo');
    const data = JSON.parse(JSON.stringify(copyElements(doc, [a.id])));
    const other = setup();
    const [pasted] = pasteElements(other, data, { x: 0, y: 0 }, opts);
    const el = listElements(other)[0]!;
    expect(el.id).toBe(pasted);
    expect(el.x).toBe(0);
    expect(el.type === 'todo' && el.items[0]?.text).toBe('Sopralluogo');
  });

  it('keeps cards hidden from guests hidden through duplicate, copy and cut', () => {
    const doc = setup();
    const col = createElement(doc, 'column', { x: 0, y: 0 }, { title: 'Interno' }, opts);
    updateElement(doc, col.id, { guestHidden: true });
    const note = createElement(doc, 'note', { x: 0, y: 0 }, { parent: col.id }, opts);
    updateElement(doc, note.id, { guestHidden: true });
    const hidden = (d: Y.Doc) => listElements(d).filter((e) => e.guestHidden === true);
    duplicateElements(doc, [col.id], { x: 20, y: 20 }, opts);
    expect(hidden(doc)).toHaveLength(4);
    const data = JSON.parse(JSON.stringify(copyElements(doc, [col.id])));
    deleteElements(doc, [col.id, note.id]);
    const other = setup();
    pasteElements(other, data, { x: 0, y: 0 }, opts);
    expect(hidden(other)).toHaveLength(2);
    expect(validateBoardDoc(other)).toEqual([]);
  });

  it('edits to-do items', () => {
    const doc = setup();
    const a = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, opts);
    const item = addTodoItem(doc, a.id, 'Casting')!;
    updateTodoItem(doc, a.id, item, { done: true });
    updateElement(doc, a.id, { title: 'Prima del 22' });
    const el = listElements(doc)[0]!;
    expect(el.type === 'todo' && el.items[0]?.done).toBe(true);
    expect(el.type === 'todo' && el.title).toBe('Prima del 22');
  });
});

describe('section headings', () => {
  it('move the cards under them, up to the next heading and within their width', () => {
    const doc = setup();
    const head = createElement(doc, 'section', { x: 0, y: 0 }, { title: 'Sequenza 1' }, opts);
    const under = createElement(doc, 'note', { x: 20, y: 60 }, {}, opts);
    const column = createElement(doc, 'column', { x: 300, y: 60 }, { title: 'Da fare' }, opts);
    const aside = createElement(doc, 'note', { x: 700, y: 60 }, {}, opts);
    const locked = createElement(doc, 'note', { x: 20, y: 200 }, { locked: true }, opts);
    const next = createElement(doc, 'section', { x: 100, y: 400 }, { title: 'Sequenza 2' }, opts);
    const below = createElement(doc, 'note', { x: 20, y: 460 }, {}, opts);
    const rectOf = (el: { x: number; y: number; w: number }) => ({ ...el, h: 40 });
    const canvas = canvasElements(listElements(doc));
    expect(sectionMembers(head, canvas, rectOf).sort()).toEqual([under.id, column.id].sort());
    expect(sectionMembers(next, canvas, rectOf)).toEqual([below.id]);
    expect(
      ids([aside, locked]).some((id) => sectionMembers(head, canvas, rectOf).includes(id)),
    ).toBe(false);
  });
});
