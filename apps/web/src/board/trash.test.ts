import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL } from './store.ts';
import { collectTrash, restoreTrashItem, type TrashItem } from './trash.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const version = { createdAt: new Date().toISOString() } as BoardVersion;

describe('snapshot trash', () => {
  it('keeps the newest state per id and restores rich text, privacy, id and parent in a separate undo step', () => {
    const doc = createBoardDoc(boardId);
    const store = new BoardStore(doc);
    const column = createElement(
      doc,
      'column',
      { x: 0, y: 0 },
      { title: 'Container' },
      { userId: null },
    );
    const note = createElement(
      doc,
      'note',
      { x: 10, y: 20 },
      { parent: column.id },
      { userId: null },
    );
    const map = store.map(note.id)!;
    map.set('guestHidden', true);
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('Keep this content')]);
    (map.get('body') as Y.XmlFragment).insert(0, [paragraph]);
    const found = new Map<string, TrashItem>();
    collectTrash(found, version, Y.encodeStateAsUpdate(doc), boardId);
    map.set('x', 999);
    collectTrash(found, version, Y.encodeStateAsUpdate(doc), boardId);
    expect(found.get(note.id)!.element.x).toBe(10);
    roots(doc).elements.delete(note.id);
    doc.transact(() => store.map(column.id)!.set('title', 'Edited'), LOCAL);
    const item = found.get(note.id)!;
    expect(restoreTrashItem(store, item, boardId)).toBe(true);
    expect(store.getSnapshot().byId.get(note.id)).toMatchObject({
      id: note.id,
      x: 10,
      parent: column.id,
      guestHidden: true,
    });
    expect((store.map(note.id)!.get('body') as Y.XmlFragment).toString()).toContain(
      'Keep this content',
    );
    expect(restoreTrashItem(store, item, boardId)).toBe(false);
    store.undo.undo();
    expect(store.map(note.id)).toBeUndefined();
    expect(store.map(column.id)!.get('title')).toBe('Edited');
    store.undo.redo();
    expect(store.map(note.id)).toBeDefined();
    store.destroy();
    doc.destroy();
  });

  it('places a child on the canvas when its original container is missing or no longer a container', () => {
    const doc = createBoardDoc(boardId);
    const store = new BoardStore(doc);
    const note = createElement(
      doc,
      'note',
      { x: 10, y: 20 },
      { parent: 'missing-parent' },
      { userId: null },
    );
    const found = new Map<string, TrashItem>();
    collectTrash(found, version, Y.encodeStateAsUpdate(doc), boardId);
    roots(doc).elements.delete(note.id);
    restoreTrashItem(store, found.get(note.id)!, boardId);
    expect(store.getSnapshot().byId.get(note.id)?.parent).toBeNull();
    store.destroy();
    doc.destroy();
  });

  it('preserves nested to-do items and frame strokes rather than retaining shared CRDT types', () => {
    const doc = createBoardDoc(boardId);
    const store = new BoardStore(doc);
    const todo = createElement(
      doc,
      'todo',
      { x: 0, y: 0 },
      { items: [{ id: 'todoitem123', text: 'Keep', done: true }] },
      { userId: null },
    );
    const frame = createElement(
      doc,
      'frame',
      { x: 0, y: 0 },
      {
        strokes: [
          { id: 'stroke123', tool: 'pencil', color: '#FFFFFF', width: 10, points: [0, 0, 10, 10] },
        ],
      },
      { userId: null },
    );
    const found = new Map<string, TrashItem>();
    collectTrash(found, version, Y.encodeStateAsUpdate(doc), boardId);
    for (const element of [todo, frame]) {
      roots(doc).elements.delete(element.id);
      restoreTrashItem(store, found.get(element.id)!, boardId);
      expect(store.getSnapshot().byId.get(element.id)).toEqual(element);
    }
    store.destroy();
    doc.destroy();
  });
});
