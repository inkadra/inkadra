import { createElement, addTodoItem, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { tasksInDoc } from './tasks.ts';
it('returns only open items assigned to this person with their card link and date', () => {
  const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const doc = createBoardDoc(id);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null });
  const item = addTodoItem(doc, todo.id, 'Permit')!;
  updateTodoItem(doc, todo.id, item, { assigneeId: id, dueDate: '2026-11-14' });
  const place = { projectId: id, projectName: 'Aurora', boardId: id, boardTitle: 'Plan' };
  expect(tasksInDoc(doc, id, place)).toEqual([{ ...place, elementId: todo.id, itemId: item, text: 'Permit', dueDate: '2026-11-14' }]);
  expect(tasksInDoc(doc, 'someone-else', place)).toEqual([]);
  updateTodoItem(doc, todo.id, item, { done: true });
  expect(tasksInDoc(doc, id, place)).toEqual([]);
  doc.destroy();
});
