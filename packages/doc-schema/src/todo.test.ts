// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addElement,
  createBoardDoc,
  migrateBoardDoc,
  readElement,
  roots,
  TodoElement,
  TodoItem,
  validateBoardDoc,
} from './index.ts';

it('upgrades v11 without assigning or dating existing items, preserves optional fields', () => {
  const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
  roots(doc).meta.set('schemaVersion', 11);
  const item = { id: 'test-item', text: 'Collect permits', done: false };
  expect(migrateBoardDoc(doc, '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10')).toEqual([12, 13, 14, 15]);
  expect(TodoItem.parse(item)).toEqual(item);
  const assigned = {
    ...item,
    assigneeId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
    dueDate: '2026-11-14',
  };
  const map = doc.getMap('test');
  map.set('item', assigned);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  expect(TodoItem.parse(copy.getMap('test').get('item'))).toEqual(assigned);
  expect(TodoItem.safeParse({ ...item, dueDate: '2026-02-30' }).success).toBe(false);
  copy.destroy();
  doc.destroy();
});

it('upgrades v12 to-do cards as ordinary lists and keeps a list kind and scene', () => {
  const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const doc = createBoardDoc(boardId);
  roots(doc).meta.set('schemaVersion', 12);
  const card = {
    id: 'todo-card-1',
    type: 'todo' as const,
    x: 0,
    y: 0,
    w: 240,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 0,
    items: [{ id: 'test-item', text: 'Towel', done: false }],
  };
  addElement(doc, card);
  expect(migrateBoardDoc(doc, boardId)).toEqual([13, 14, 15]);
  expect(TodoElement.parse(card).list).toBeUndefined();
  const live = roots(doc).elements.get(card.id);
  live?.set('list', 'wardrobe');
  live?.set('sceneId', 'scene-card-1');
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const map = roots(copy).elements.get(card.id);
  expect(map && readElement(map)).toMatchObject({ list: 'wardrobe', sceneId: 'scene-card-1' });
  expect(TodoElement.safeParse({ ...card, list: 'catering' }).success).toBe(false);
  expect(validateBoardDoc(copy)).toEqual([]);
  copy.destroy();
  doc.destroy();
});
