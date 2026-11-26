import { addTodoItem, createElement, removeTodoItem, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { boardRole, projectRole } from './access.ts';
import type { Database } from './db/client.ts';
import {
  assignedItems,
  dropRemovedAssignees,
  notifyAssignment,
  taskWrites,
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
/** The board lock and the moved-card lookup notify() makes for a card (0141): nothing moved. */
const tx = {
  insert: () => ({ values }),
  select: () => ({
    from: () => ({
      where: () => Object.assign(Promise.resolve([]), { for: () => Promise.resolve([]) }),
    }),
  }),
};
const db = {
  insert: () => ({ values }),
  select: () => ({ from: () => ({ where: preferences }) }),
  transaction: (work: (t: typeof tx) => Promise<unknown>) => work(tx),
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
  // Read from the update alone, without a copy of the board.
  expect(taskWrites(doc, update)).not.toBe('full');
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
/** A board on the server and a client in sync with it; `send` returns what the client sends. */
function boardWithItem() {
  const server = createBoardDoc(id);
  const todo = createElement(server, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
  const item = addTodoItem(server, todo, 'Permit')!;
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const send = (change: () => void) => {
    const before = Y.encodeStateVector(client);
    change();
    return Y.encodeStateAsUpdate(client, before);
  };
  return { server, client, todo, item, send };
}
it('refuses a due date or an assignee of the wrong format', async () => {
  const second = boardWithItem();
  const assignee = second.send(() =>
    updateTodoItem(second.client, second.todo, second.item, { assigneeId: 'someone' }),
  );
  expect(taskWrites(second.server, assignee)).not.toBe('full');
  await expect(validateTaskUpdate(db, id, 'actor', second.server, assignee)).rejects.toThrow();
  second.client.destroy();
  second.server.destroy();
  const { server, client, todo, item, send } = boardWithItem();
  const valid = send(() => updateTodoItem(client, todo, item, { dueDate: '2026-11-30' }));
  expect(taskWrites(server, valid)).not.toBe('full');
  await expect(validateTaskUpdate(db, id, undefined, server, valid)).resolves.toBeUndefined();
  Y.applyUpdate(server, valid);
  const invalid = send(() => updateTodoItem(client, todo, item, { dueDate: 'soon' }));
  await expect(validateTaskUpdate(db, id, undefined, server, invalid)).rejects.toThrow();
  client.destroy();
  server.destroy();
});
it('checks an assignment delivered before the update it follows, when it gets in', async () => {
  const { server, client, todo, item, send } = boardWithItem();
  const card = client.getMap('elements').get(todo) as Y.Map<unknown>;
  const move = send(() => card.set('x', 40));
  const assign = send(() => updateTodoItem(client, todo, item, { assigneeId: id }));
  // An editor's assignment arrives first: held back, then let in by the move.
  await expect(validateTaskUpdate(db, id, 'actor', server, assign)).resolves.toBeUndefined();
  Y.applyUpdate(server, assign);
  expect(server.store.pendingStructs).not.toBeNull();
  vi.mocked(boardRole).mockClear();
  await expect(validateTaskUpdate(db, id, 'actor', server, move)).resolves.toBeUndefined();
  expect(boardRole).toHaveBeenCalledOnce();
  Y.applyUpdate(server, move);
  expect(assignedItems(server).get(`${todo}:${item}`)?.assigneeId).toBe(id);
  client.destroy();
  server.destroy();
});
it('reads nothing new in an offline session sent again', async () => {
  const { server, client, todo, item, send } = boardWithItem();
  const offline = send(() => {
    updateTodoItem(client, todo, item, { assigneeId: other, dueDate: '2026-12-01' });
    updateTodoItem(client, todo, item, { assigneeId: id });
    addTodoItem(client, todo, 'Call the location');
  });
  expect(taskWrites(server, offline)).not.toBe('full');
  await expect(validateTaskUpdate(db, id, undefined, server, offline)).rejects.toThrow('Guests');
  await expect(validateTaskUpdate(db, id, 'actor', server, offline)).resolves.toBeUndefined();
  Y.applyUpdate(server, offline);
  // The connection dropped before the acknowledgement: the client sends it all again.
  vi.mocked(boardRole).mockClear();
  expect(taskWrites(server, offline)).toEqual(new Map());
  await expect(validateTaskUpdate(db, id, undefined, server, offline)).resolves.toBeUndefined();
  expect(boardRole).not.toHaveBeenCalled();
  client.destroy();
  server.destroy();
});
it('checks an undone and a redone assignment like any other', async () => {
  const { server, client, todo, item, send } = boardWithItem();
  const undo = new Y.UndoManager(client.getMap('elements'));
  const sendApplied = async (change: () => void, actor?: string) => {
    const update = send(change);
    expect(taskWrites(server, update)).not.toBe('full');
    await validateTaskUpdate(db, id, actor, server, update);
    Y.applyUpdate(server, update);
    return update;
  };
  await sendApplied(() => updateTodoItem(client, todo, item, { assigneeId: other }), 'actor');
  undo.stopCapturing();
  await sendApplied(() => updateTodoItem(client, todo, item, { assigneeId: id }), 'actor');
  // Back to the first assignee: an assignment, which a guest may not make.
  const back = send(() => undo.undo());
  expect(taskWrites(server, back)).not.toBe('full');
  await expect(validateTaskUpdate(db, id, undefined, server, back)).rejects.toThrow('Guests');
  await validateTaskUpdate(db, id, 'actor', server, back);
  Y.applyUpdate(server, back);
  expect(assignedItems(server).get(`${todo}:${item}`)?.assigneeId).toBe(other);
  // Undoing the first assignment too assigns nobody.
  await sendApplied(() => undo.undo());
  expect(assignedItems(server).size).toBe(0);
  const redo = send(() => undo.redo());
  await expect(validateTaskUpdate(db, id, undefined, server, redo)).rejects.toThrow('Guests');
  vi.mocked(boardRole).mockResolvedValueOnce({ role: 'viewer', projectId: id });
  await expect(validateTaskUpdate(db, id, 'actor', server, redo)).rejects.toThrow('editor');
  await validateTaskUpdate(db, id, 'actor', server, redo);
  Y.applyUpdate(server, redo);
  expect(assignedItems(server).get(`${todo}:${item}`)?.assigneeId).toBe(other);
  undo.destroy();
  client.destroy();
  server.destroy();
});
it('checks an assigned item brought back by undo on a copy of the board', async () => {
  const { server, client, todo, item, send } = boardWithItem();
  const undo = new Y.UndoManager(client.getMap('elements'));
  Y.applyUpdate(
    server,
    send(() => updateTodoItem(client, todo, item, { assigneeId: id })),
  );
  undo.clear();
  Y.applyUpdate(
    server,
    send(() => removeTodoItem(client, todo, item)),
  );
  const restore = send(() => undo.undo());
  expect(taskWrites(server, restore)).toBe('full');
  await expect(validateTaskUpdate(db, id, undefined, server, restore)).rejects.toThrow('Guests');
  await expect(validateTaskUpdate(db, id, 'actor', server, restore)).resolves.toBeUndefined();
  undo.destroy();
  client.destroy();
  server.destroy();
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
