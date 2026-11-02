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
