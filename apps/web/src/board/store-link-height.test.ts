import type { Element } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore } from './store.ts';

it('uses rendered link height instead of a stale persisted height for canvas hit testing', () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const link = {
    id: 'link',
    type: 'link',
    url: 'https://youtu.be/yMnFHFf43Qg',
    x: 0,
    y: 0,
    w: 240,
    h: 800,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 0,
  } as const;
  store.setHeight(link.id, 210);
  expect(store.heightOf(link)).toBe(210);
  store.destroy();
  doc.destroy();
});

it.each(['column', 'scene'] as const)(
  'uses measured %s content height over a persisted resize height',
  (type) => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc);
    const container = {
      id: 'container',
      number: '1',
      type,
      title: 'References',
      x: 0,
      y: 0,
      w: 264,
      h: 800,
      z: 'a0',
      parent: null,
      createdBy: null,
      createdAt: 0,
    } as const;
    store.setHeight(container.id, 210);
    expect(store.rectOf(container).h).toBe(210);
    store.destroy();
    doc.destroy();
  },
);

it('takes the taller of a to-do list stored height and its text (inkadra-feedback#23)', () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const list: Element = {
    id: 'list',
    type: 'todo',
    items: [],
    x: 0,
    y: 0,
    w: 160,
    h: 40,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 0,
  };
  // Resized shorter than its text: the card is as tall as the text.
  store.setHeight(list.id, 320);
  expect(store.heightOf(list)).toBe(320);
  // Stretched taller than its text: it keeps the empty space it was given.
  expect(store.heightOf({ ...list, h: 500 })).toBe(500);
  store.destroy();
  doc.destroy();
});
