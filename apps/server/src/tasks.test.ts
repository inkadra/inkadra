import { addTodoItem, createElement, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { openTasks } from './board-preview.ts';
import type { Database } from './db/client.ts';
import {
  changesTasks,
  mayTouchTasks,
  tasksInDoc,
  trackAssignments,
  validateTaskUpdate,
} from './tasks.ts';

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
  // What the index stores for every assignee (#803).
  expect(openTasks(doc)).toEqual([
    { elementId: todo.id, itemId: item, text: 'Permit', assigneeId: id, dueDate: '2026-11-14' },
  ]);
  updateTodoItem(doc, todo.id, item, { done: true });
  expect(tasksInDoc(doc, id, place)).toEqual([]);
  expect(openTasks(doc)).toEqual([]);
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
  updateTodoItem(doc, todo, item, { assigneeId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a12' });
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

it('tells which transactions can change who is assigned', () => {
  const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const doc = createBoardDoc(id);
  const seen: boolean[] = [];
  doc.on('afterTransaction', (tr: Y.Transaction) => seen.push(changesTasks(tr)));
  const changes = (change: () => void) => {
    seen.length = 0;
    change();
    return seen.some(Boolean);
  };
  let todo = '';
  expect(
    changes(() => {
      todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
    }),
  ).toBe(true);
  let item = '';
  expect(
    changes(() => {
      item = addTodoItem(doc, todo, 'Permit')!;
    }),
  ).toBe(true);
  const card = doc.getMap('elements').get(todo) as Y.Map<unknown>;
  expect(changes(() => card.set('x', 40))).toBe(false);
  expect(changes(() => updateTodoItem(doc, todo, item, { done: true }))).toBe(false);
  expect(changes(() => updateTodoItem(doc, todo, item, { assigneeId: id }))).toBe(true);
  expect(changes(() => (card.get('items') as Y.Array<unknown>).delete(0))).toBe(true);
  expect(changes(() => doc.getMap('elements').delete(todo))).toBe(true);
  doc.destroy();
});

it('keeps the assignments until they can change, and reads shared-type ids every time', () => {
  const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const doc = createBoardDoc(id);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
  const item = addTodoItem(doc, todo, 'Permit')!;
  updateTodoItem(doc, todo, item, { assigneeId: id });
  const now = trackAssignments(doc);
  const first = now();
  const card = doc.getMap('elements').get(todo) as Y.Map<unknown>;
  card.set('x', 40);
  // Nothing a reader of assignments sees changed: the same map, not read again.
  expect(now()).toBe(first);
  updateTodoItem(doc, todo, item, { assigneeId: 'other' });
  expect([...now().values()].map((a) => a.assigneeId)).toEqual(['other']);
  // An item id held in a Y.Text: editing the text moves the assignment, with no write under id.
  const stored = (card.get('items') as Y.Array<Y.Map<unknown>>).get(0);
  const text = new Y.Text('t1');
  stored.set('id', text);
  expect([...now().keys()]).toEqual([`${todo}:t1`]);
  text.insert(2, 'x');
  expect([...now().keys()]).toEqual([`${todo}:t1x`]);
  doc.destroy();
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

/** A board with one assigned to-do item and one note, on a client and on the server. */
function boardWithTask() {
  const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
  const doc = createBoardDoc(id);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
  const item = addTodoItem(doc, todo, 'Permit')!;
  updateTodoItem(doc, todo, item, { assigneeId: id });
  const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null }).id;
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
  const at = (client: Y.Doc, change: () => void) => {
    const before = Y.encodeStateVector(client);
    change();
    return Y.encodeStateAsUpdate(client, before);
  };
  /** A second client in sync with the server, as another person on the board. */
  const other = () => {
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    return client;
  };
  const card = (client: Y.Doc, key: string) => client.getMap('elements').get(key) as Y.Map<unknown>;
  const items = (client: Y.Doc) => card(client, todo).get('items') as Y.Array<Y.Map<unknown>>;
  /** Leaves a due date held back on the server: an edit sent before the one it follows. */
  const holdBack = () => {
    const client = other();
    at(client, () => card(client, note).set('x', 1));
    const later = at(client, () => items(client).get(0).set('dueDate', '2026-11-20'));
    Y.applyUpdate(server, later);
    expect(server.store.pendingStructs).not.toBeNull();
    return client;
  };
  return { id, doc, server, todo, item, note, at, other, card, items, holdBack };
}

it('reads held-back structs only with the update that releases them, and skips removed cards', () => {
  const { server, todo, item, note, at, other, card, items, holdBack } = boardWithTask();
  const gapped = holdBack();
  // The sender past the gap goes on editing: still held back, nothing to read yet.
  expect(
    mayTouchTasks(
      server,
      at(gapped, () => updateTodoItem(gapped, todo, item, { done: true })),
    ),
  ).toBe(false);
  const client = other();
  // Edits that leave the held-back structs where they are don't copy the board any more.
  expect(
    mayTouchTasks(
      server,
      at(client, () => card(client, note).set('x', 40)),
    ),
  ).toBe(false);
  // Removing a whole card or a whole item removes its id and type with it: nothing to check.
  expect(
    mayTouchTasks(
      server,
      at(client, () => client.getMap('elements').delete(note)),
    ),
  ).toBe(false);
  expect(
    mayTouchTasks(
      server,
      at(client, () => items(client).delete(0)),
    ),
  ).toBe(false);
  expect(
    mayTouchTasks(
      server,
      at(client, () => client.getMap('elements').delete(todo)),
    ),
  ).toBe(false);
  // Removing a field of an item that stays is checked.
  const fresh = other();
  expect(
    mayTouchTasks(
      server,
      at(fresh, () => items(fresh).get(0).delete('assigneeId')),
    ),
  ).toBe(true);
});

it('checks edits inside an id kept in a shared type, with and without held-back structs', async () => {
  const { id, doc, server, todo, at, card, items, holdBack } = boardWithTask();
  const text = new Y.Text('t1');
  const label = new Y.Text('label');
  Y.applyUpdate(
    server,
    at(doc, () => {
      items(doc).get(0).set('id', text);
      card(doc, todo).set('label', label);
    }),
  );
  const db = {} as Database;
  for (const pending of [false, true]) {
    if (pending) holdBack();
    for (const edit of [() => text.insert(2, 'x'), () => text.delete(0, 1)]) {
      const update = at(doc, edit);
      expect(mayTouchTasks(server, update)).toBe(true);
      // The assigned item moves to a new key: an assignment the guest may not make.
      await expect(validateTaskUpdate(db, id, undefined, server, update)).rejects.toThrow(
        'Guests cannot assign tasks',
      );
      Y.applyUpdate(server, update);
    }
    const unrelated = at(doc, () => label.insert(0, 'a'));
    expect(mayTouchTasks(server, unrelated)).toBe(false);
    Y.applyUpdate(server, unrelated);
  }
});

it('checks an assignment that replaces a held-back value once the gap is filled', async () => {
  const { id, doc, server, todo, item, at, card } = boardWithTask();
  const db = {} as Database;
  const move = at(doc, () => card(doc, todo).set('x', 40));
  // Each replaces the value before it: they carry no key, only the value they replace.
  const second = at(doc, () =>
    updateTodoItem(doc, todo, item, { assigneeId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11' }),
  );
  const third = at(doc, () =>
    updateTodoItem(doc, todo, item, { assigneeId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a12' }),
  );
  // Neither can be applied yet: nothing to refuse, and both are held back.
  for (const update of [second, third]) {
    await validateTaskUpdate(db, id, undefined, server, update);
    Y.applyUpdate(server, update);
  }
  // Sent again, the replacement whose origin is held back is held back too: nothing to read yet.
  expect(mayTouchTasks(server, third)).toBe(false);
  // The move brings both in.
  expect(mayTouchTasks(server, move)).toBe(true);
  await expect(validateTaskUpdate(db, id, undefined, server, move)).rejects.toThrow(
    'Guests cannot assign tasks',
  );
});

it('checks a new item that shares its id with an assigned one', async () => {
  const { id, doc, server, items, at } = boardWithTask();
  const db = {} as Database;
  const shared = items(doc).get(0).get('id');
  // By key alone, the new item hides the old one, which has the same assignee.
  const copy = at(doc, () =>
    items(doc).push([
      new Y.Map<unknown>([
        ['id', shared],
        ['text', 'Copy'],
        ['done', false],
        ['assigneeId', id],
      ]),
    ]),
  );
  await expect(validateTaskUpdate(db, id, undefined, server, copy)).rejects.toThrow(
    'Guests cannot assign tasks',
  );
});

it('checks held-back structs that the server’s own write lets in with the next update', async () => {
  const { id, doc, server, at, other, card, items, todo } = boardWithTask();
  const db = {} as Database;
  const client = other();
  // A client that guesses the server's next write and writes into it: held back until it exists.
  const replica = other();
  replica.clientID = server.clientID;
  items(replica).push([new Y.Map()]);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica));
  const assign = at(doc, () => items(doc).get(1).set('assigneeId', id));
  expect(Y.decodeUpdate(assign).ds.clients.size).toBe(0);
  await validateTaskUpdate(db, id, undefined, server, assign);
  Y.applyUpdate(server, assign);
  expect(server.store.pendingStructs).not.toBeNull();
  // The server writes it; Yjs retries held-back structs only with the next update.
  items(server).push([new Y.Map()]);
  const move = at(client, () => card(client, todo).set('x', 40));
  expect(mayTouchTasks(server, move)).toBe(true);
  await expect(validateTaskUpdate(db, id, undefined, server, move)).rejects.toThrow(
    'Guests cannot assign tasks',
  );
  Y.applyUpdate(server, move);
  expect(items(server).get(1).get('assigneeId')).toBe(id);
});

it('reads a deletion held back for the server’s own write when it applies', () => {
  const { doc, server, at, other, card, items, todo } = boardWithTask();
  const client = other();
  const replica = other();
  replica.clientID = server.clientID;
  items(replica).get(0).set('assigneeId', '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica));
  const remove = at(doc, () => items(doc).get(0).delete('assigneeId'));
  expect(Y.decodeUpdate(remove).structs.length).toBe(0);
  Y.applyUpdate(server, remove);
  expect(server.store.pendingDs).not.toBeNull();
  items(server).get(0).set('assigneeId', '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11');
  // Yjs applies the held-back deletion with the next update, whatever that update holds.
  expect(
    mayTouchTasks(
      server,
      at(client, () => card(client, todo).set('x', 40)),
    ),
  ).toBe(true);
});
