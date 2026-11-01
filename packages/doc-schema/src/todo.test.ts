// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { createBoardDoc, migrateBoardDoc, roots, TodoItem } from './index.ts';
it('upgrades v11 without assigning or dating existing items, preserves optional fields', () => {
  const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
  roots(doc).meta.set('schemaVersion', 11);
  const item = { id: 'test-item', text: 'Collect permits', done: false };
  expect(migrateBoardDoc(doc, '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10')).toEqual([12]);
  expect(TodoItem.parse(item)).toEqual(item);
  const assigned = { ...item, assigneeId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10', dueDate: '2026-11-14' };
  const map = doc.getMap('test'); map.set('item', assigned);
  const copy = new Y.Doc(); Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  expect(TodoItem.parse(copy.getMap('test').get('item'))).toEqual(assigned);
  expect(TodoItem.safeParse({ ...item, dueDate: '2026-02-30' }).success).toBe(false);
  copy.destroy(); doc.destroy();
});
