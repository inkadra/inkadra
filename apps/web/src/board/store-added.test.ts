import { createElement } from '@inkadra/canvas-core';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL } from './store.ts';

const opts = { userId: null, origin: LOCAL };

it('pops in a card added here once, not the cards of a board as it loads', () => {
  const source = new Y.Doc();
  createElement(source, 'note', { x: 0, y: 0 }, {}, opts);
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  // The board arrives from the server: a remote update into an empty store.
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
  const [loaded] = store.getSnapshot().canvas;
  expect(loaded && store.takeAdded(loaded.id)).toBe(false);

  const note = createElement(doc, 'note', { x: 300, y: 0 }, {}, opts);
  expect(store.takeAdded(note.id)).toBe(true);
  expect(store.takeAdded(note.id)).toBe(false);
  store.destroy();
  doc.destroy();
  source.destroy();
});
