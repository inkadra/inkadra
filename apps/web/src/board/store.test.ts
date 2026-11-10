import { createElement, currentElements, listElements, updateElement } from '@inkadra/canvas-core';
import { roots } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL } from './store.ts';

const opts = { userId: null, origin: LOCAL };
const sorted = (doc: Y.Doc) =>
  currentElements(doc)
    .map((e) => JSON.stringify(e))
    .sort();
const fromDoc = (doc: Y.Doc) =>
  listElements(doc)
    .map((e) => JSON.stringify(e))
    .sort();

it('gives the helpers its snapshot only while it is current', () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  updateElement(doc, a.id, { x: 50 }, LOCAL);
  expect(sorted(doc)).toEqual(fromDoc(doc));
  expect(currentElements(doc)[0]).toBe(store.getSnapshot().byId.get(a.id));

  // Inside a transaction the snapshot is behind: the helpers read the document, so two cards
  // created in one step still stack.
  let inside: string[] = [];
  doc.transact(() => {
    const b = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const c = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    inside = [b.z, c.z];
    expect(currentElements(doc)).toHaveLength(3);
  }, LOCAL);
  expect(inside[1]! > inside[0]!).toBe(true);
  expect(sorted(doc)).toEqual(fromDoc(doc));

  // Remote edits arrive through applyUpdate like any other transaction.
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  createElement(other, 'note', { x: 0, y: 0 }, {}, { userId: null });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
  expect(sorted(doc)).toEqual(fromDoc(doc));

  store.destroy();
  expect(sorted(doc)).toEqual(fromDoc(doc));
});

it('reads the document when a card is stored under a key that is not its id', () => {
  const doc = new Y.Doc();
  const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  roots(doc).elements.set('notTheIdOfTheCard000', roots(doc).elements.get(a.id)!.clone());
  const store = new BoardStore(doc);
  // The snapshot holds the card once, the document twice.
  expect(store.getSnapshot().byId.size).toBe(1);
  expect(currentElements(doc)).toHaveLength(2);
  store.destroy();
});
