import { addTodoItem, createElement, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Database } from './db/client.ts';
import { mayTouchTasks, tasksInDoc, validateTaskUpdate } from './tasks.ts';

it('returns only open items assigned to this person with their card link and date', () => {
  const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const doc = createBoardDoc(id);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null });
  const item = addTodoItem(doc, todo.id, 'Permit')!;
  updateTodoItem(doc, todo.id, item, { assigneeId: id, dueDate: '2026-11-14' });
  const place = { projectId: id, projectName: 'Aurora', boardId: id, boardTitle: 'Plan' };
  expect(tasksInDoc(doc, id, place)).toEqual([
    { ...place, elementId: todo.id, itemId: item, text: 'Permit', dueDate: '2026-11-14' },
  ]);
  expect(tasksInDoc(doc, 'someone-else', place)).toEqual([]);
  updateTodoItem(doc, todo.id, item, { done: true });
  expect(tasksInDoc(doc, id, place)).toEqual([]);
  doc.destroy();
});

it('runs the full task check only for updates that can assign a task or set a due date', () => {
  const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const doc = createBoardDoc(id);
  const server = new Y.Doc();
  const sent = (change: () => void) => {
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(doc);
    change();
    return Y.encodeStateAsUpdate(doc, before);
  };
  let todo = '';
  // A new todo card (with its first item) is checked.
  expect(
    mayTouchTasks(
      server,
      sent(() => {
        todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
      }),
    ),
  ).toBe(true);
  const item = addTodoItem(doc, todo, 'Permit')!;
  const card = doc.getMap('elements').get(todo) as Y.Map<unknown>;
  // Moving the card or ticking the item is not.
  expect(
    mayTouchTasks(
      server,
      sent(() => card.set('x', 40)),
    ),
  ).toBe(false);
  expect(
    mayTouchTasks(
      server,
      sent(() => updateTodoItem(doc, todo, item, { done: true })),
    ),
  ).toBe(false);
  // A first assignee, then a new one: the second write names only the value it replaces.
  expect(
    mayTouchTasks(
      server,
      sent(() => updateTodoItem(doc, todo, item, { assigneeId: id })),
    ),
  ).toBe(true);
  expect(
    mayTouchTasks(
      server,
      sent(() => updateTodoItem(doc, todo, item, { assigneeId: 'other' })),
    ),
  ).toBe(true);
  expect(
    mayTouchTasks(
      server,
      sent(() => updateTodoItem(doc, todo, item, { dueDate: '2026-11-20' })),
    ),
  ).toBe(true);
  // Edits made offline arrive merged: a later assignee replaces one in the same update.
  Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
  const offline = Y.encodeStateVector(doc);
  card.set('x', 80);
  updateTodoItem(doc, todo, item, { assigneeId: id });
  updateTodoItem(doc, todo, item, { assigneeId: 'third' });
  const merged = Y.encodeStateAsUpdate(doc, offline);
  expect(mayTouchTasks(server, merged)).toBe(true);
  const moves = sent(() => {
    card.set('x', 1);
    card.set('x', 2);
  });
  expect(mayTouchTasks(server, moves)).toBe(false);
  doc.destroy();
  server.destroy();
});

it('checks an update that fills a gap, which integrates an assignment held back before', async () => {
  const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const doc = createBoardDoc(id);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
  const item = addTodoItem(doc, todo, 'Permit')!;
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
  const card = doc.getMap('elements').get(todo) as Y.Map<unknown>;
  const at = (change: () => void) => {
    const before = Y.encodeStateVector(doc);
    change();
    return Y.encodeStateAsUpdate(doc, before);
  };
  const move = at(() => card.set('x', 40));
  const assign = at(() => updateTodoItem(doc, todo, item, { assigneeId: id }));
  // A guest sends the assignment first: it can't be read yet, so it is held back unchecked.
  const db = {} as Database;
  await validateTaskUpdate(db, id, undefined, server, assign);
  Y.applyUpdate(server, assign);
  expect(server.store.pendingStructs).not.toBeNull();
  // The move fills the gap and would bring the assignment in with it.
  expect(mayTouchTasks(server, move)).toBe(true);
  await expect(validateTaskUpdate(db, id, undefined, server, move)).rejects.toThrow(
    'Guests cannot assign tasks',
  );
  doc.destroy();
  server.destroy();
});

it('reads a long chain of map writes in bounded time', () => {
  const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const server = createBoardDoc(id);
  const todo = createElement(server, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
  // Without garbage collection every replaced value stays an item whose origin is the one before;
  // a number then bytes keeps Yjs from merging the neighbours into one item.
  const client = new Y.Doc({ gc: false });
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const card = client.getMap('elements').get(todo) as Y.Map<unknown>;
  const before = Y.encodeStateVector(client);
  client.transact(() => {
    for (let i = 0; i < 50_000; i += 1) card.set('x', i % 2 ? i : new Uint8Array([1]));
  });
  const chained = Y.encodeStateAsUpdate(client, before);
  const started = performance.now();
  expect(mayTouchTasks(server, chained)).toBe(false);
  // Linear: well under a second here; the quadratic-or-worse walk took minutes.
  expect(performance.now() - started).toBeLessThan(5000);
  client.destroy();
  server.destroy();
});
