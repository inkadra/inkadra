import { addTodoItem, createElement, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { boardRole, projectRole } from './access.ts';
import type { Database } from './db/client.ts';
import {
  assignedItems,
  dropRemovedAssignees,
  notifyAssignment,
  validateTaskUpdate,
} from './tasks.ts';

vi.mock('./access.ts', async (original) => ({
  ...(await original<typeof import('./access.ts')>()),
  boardRole: vi.fn(),
  projectRole: vi.fn(),
  boardRolesForPeople: vi
    .fn()
    .mockResolvedValue(new Map([['0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10', 'viewer']])),
}));
const values = vi.fn().mockResolvedValue([]);
/** The notification preferences notify() reads: who turned which types off in the Inbox. */
const preferences = vi.fn().mockResolvedValue([]);
const db = {
  insert: () => ({ values }),
  select: () => ({ from: () => ({ where: preferences }) }),
} as unknown as Database;
const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const other = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(boardRole).mockResolvedValue({ role: 'editor', projectId: id });
  vi.mocked(projectRole).mockResolvedValue('viewer');
});
it('creates an assignment notification only for a current member and an authorized account', async () => {
  expect(await notifyAssignment(db, id, 'element-id', id, 'actor')).toBe(true);
  expect(values).toHaveBeenCalledOnce();
  // Emailed as the notification matrix says (#302), not marked as sent.
  expect(values.mock.calls[0]?.[0][0]).toMatchObject({ type: 'task_assigned', userId: id });
  expect(values.mock.calls[0]?.[0][0].emailedAt).toBeUndefined();
  vi.mocked(projectRole).mockResolvedValue(null);
  expect(await notifyAssignment(db, id, 'element-id', id, 'actor')).toBe(false);
  expect(values).toHaveBeenCalledOnce();
  vi.mocked(boardRole).mockResolvedValue({ role: 'viewer', projectId: id });
  expect(await notifyAssignment(db, id, 'element-id', id, 'actor')).toBe(false);
});
it('writes no assignment notification for a person who turned them off in the Inbox', async () => {
  preferences.mockResolvedValueOnce([{ userId: id, off: ['task_assigned'] }]);
  expect(await notifyAssignment(db, id, 'element-id', id, 'actor')).toBe(true);
  expect(values).not.toHaveBeenCalled();
});
it('rejects guest and viewer CRDT assignments before changing the live document', async () => {
  const doc = createBoardDoc(id);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null });
  const item = addTodoItem(doc, todo.id, 'Permit')!;
  const next = new Y.Doc();
  Y.applyUpdate(next, Y.encodeStateAsUpdate(doc));
  updateTodoItem(next, todo.id, item, { assigneeId: id });
  const update = Y.encodeStateAsUpdate(next, Y.encodeStateVector(doc));
  await expect(validateTaskUpdate(db, id, undefined, doc, update)).rejects.toThrow('Guests');
  vi.mocked(boardRole).mockResolvedValueOnce({ role: 'viewer', projectId: id });
  await expect(validateTaskUpdate(db, id, 'actor', doc, update)).rejects.toThrow('editor');
  // A person who left doesn't refuse the update: dropRemovedAssignees corrects it once applied.
  vi.mocked(projectRole).mockResolvedValue(null);
  await expect(validateTaskUpdate(db, id, 'actor', doc, update)).resolves.toBeUndefined();
  next.destroy();
  doc.destroy();
});
it('lets nobody be blocked by a stored item that no longer fits the schema', async () => {
  const doc = createBoardDoc(id);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null });
  const bad = addTodoItem(doc, todo.id, 'Stored long ago')!;
  updateTodoItem(doc, todo.id, bad, { assigneeId: id, dueDate: 'soon' });
  const next = new Y.Doc();
  Y.applyUpdate(next, Y.encodeStateAsUpdate(doc));
  addTodoItem(next, todo.id, 'Unrelated');
  const update = Y.encodeStateAsUpdate(next, Y.encodeStateVector(doc));
  await expect(validateTaskUpdate(db, id, undefined, doc, update)).resolves.toBeUndefined();
  // A value this update writes is still checked.
  updateTodoItem(next, todo.id, bad, { dueDate: 'later' });
  const invalid = Y.encodeStateAsUpdate(next, Y.encodeStateVector(doc));
  await expect(validateTaskUpdate(db, id, 'actor', doc, invalid)).rejects.toThrow();
  next.destroy();
  doc.destroy();
});
it('clears an assignee who left instead of restoring one who left too', async () => {
  const doc = createBoardDoc(id);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null });
  const item = addTodoItem(doc, todo.id, 'Permit')!;
  updateTodoItem(doc, todo.id, item, { assigneeId: id });
  const before = assignedItems(doc);
  updateTodoItem(doc, todo.id, item, { assigneeId: other });
  preferences.mockResolvedValueOnce([{ projectId: id }]);
  vi.mocked(projectRole).mockResolvedValue(null);
  await dropRemovedAssignees(db, id, doc, before, assignedItems(doc));
  expect(assignedItems(doc).size).toBe(0);
  doc.destroy();
});
