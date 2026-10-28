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
