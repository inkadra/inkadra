import { addTodoItem, createElement, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { boardRole } from './access.ts';
import { openTasks } from './board-preview.ts';
import type { Database } from './db/client.ts';
import {
  assignedItems,
  changesTasks,
  mayTouchTasks,
  tasksInDoc,
  trackAssignments,
  validateTaskUpdate,
} from './tasks.ts';

vi.mock('./access.ts', async (original) => ({
  ...(await original<typeof import('./access.ts')>()),
  boardRole: vi.fn(),
}));

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

it('checks a deletion that shows another assignee for a shared id at least as main did', async () => {
  const a = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
  const b = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a12';
  const db = {} as Database;
  const who = { guest: undefined, viewer: 'viewer', editor: 'editor' } as const;
  vi.mocked(boardRole).mockImplementation(async (_db, actor) => ({
    role: actor.id as 'viewer' | 'editor',
    projectId: a,
  }));
  /** Two items with one id: by key, the later one's assignee is the one shown. */
  const setup = (pending: boolean) => {
    const doc = createBoardDoc(a);
    const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
    const card = doc.getMap('elements').get(todo) as Y.Map<unknown>;
    const items = card.get('items') as Y.Array<Y.Map<unknown>>;
    for (const assigneeId of [a, b])
      items.push([
        new Y.Map<unknown>([
          ['id', 'dup'],
          ['text', 'Permit'],
          ['assigneeId', assigneeId],
        ]),
      ]);
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    if (pending) {
      const gapped = new Y.Doc();
      Y.applyUpdate(gapped, Y.encodeStateAsUpdate(server));
      gapped.getMap('meta').set('a', 1);
      const sv = Y.encodeStateVector(gapped);
      gapped.getMap('meta').set('b', 1);
      Y.applyUpdate(server, Y.encodeStateAsUpdate(gapped, sv));
      expect(server.store.pendingStructs).not.toBeNull();
    }
    const sv = Y.encodeStateVector(doc);
    return { doc, server, items, todo, sent: () => Y.encodeStateAsUpdate(doc, sv) };
  };
  /**
   * What main decided for a deletion: with structs held back, the full check by key; without,
   * none (its quick test passed every update without structs).
   */
  const mainRefuses = (server: Y.Doc, update: Uint8Array, actor: string | undefined) => {
    expect(Y.decodeUpdate(update).structs).toEqual([]);
    if (!server.store.pendingStructs) return false;
    const candidate = new Y.Doc();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(candidate, update);
    const shown = assignedItems(server);
    const assigns = [...assignedItems(candidate)].some(
      ([key, item]) => shown.get(key)?.assigneeId !== item.assigneeId,
    );
    return assigns && actor !== 'editor';
  };
  const deletions = {
    'the item shown': (s: ReturnType<typeof setup>) => s.items.delete(1),
    'the assignee shown': (s: ReturnType<typeof setup>) => s.items.get(1).delete('assigneeId'),
    'the item hidden': (s: ReturnType<typeof setup>) => s.items.delete(0),
    'the whole card': (s: ReturnType<typeof setup>) => s.doc.getMap('elements').delete(s.todo),
  };
  const refused: string[] = [];
  for (const pending of [false, true])
    for (const [name, remove] of Object.entries(deletions))
      for (const [role, actor] of Object.entries(who)) {
        const s = setup(pending);
        remove(s);
        const update = s.sent();
        const main = mainRefuses(s.server, update, actor);
        const pr = await validateTaskUpdate(db, a, actor, s.server, update).then(
          () => false,
          () => true,
        );
        // Never more permissive than main.
        if (main) expect(pr, `${name}, ${role}, pending ${pending}`).toBe(true);
        if (pr) refused.push(`${name}, ${role}, pending ${pending}`);
      }
  // Only deleting the item shown makes another assignee show, with or without held-back structs.
  expect(refused).toEqual([
    'the item shown, guest, pending false',
    'the item shown, viewer, pending false',
    'the item shown, guest, pending true',
    'the item shown, viewer, pending true',
  ]);
});

it('checks removing or replacing a card that shares its id with another', async () => {
  const a = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
  const b = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a12';
  const db = {} as Database;
  const refused: string[] = [];
  for (const pending of [false, true])
    for (const action of ['remove', 'replace', 'concurrent'] as const) {
      const doc = createBoardDoc(a);
      const elements = doc.getMap('elements');
      const cards: string[] = [];
      // Two cards with one id and one item id: by key, the later card's item is the one shown.
      for (const assigneeId of [a, b]) {
        const key = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
        const card = elements.get(key) as Y.Map<unknown>;
        card.set('id', 'shared');
        (card.get('items') as Y.Array<Y.Map<unknown>>).push([
          new Y.Map<unknown>([
            ['id', 'one'],
            ['text', 'Permit'],
            ['assigneeId', assigneeId],
          ]),
        ]);
        cards.push(key);
      }
      const server = new Y.Doc();
      Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
      if (pending) {
        const gapped = new Y.Doc();
        gapped.getMap('meta').set('a', 1);
        const sv = Y.encodeStateVector(gapped);
        gapped.getMap('meta').set('b', 1);
        Y.applyUpdate(server, Y.encodeStateAsUpdate(gapped, sv));
      }
      expect([...assignedItems(server).values()].map((i) => i.assigneeId)).toEqual([b]);
      const sv = Y.encodeStateVector(doc);
      if (action === 'remove') elements.delete(cards[1]!);
      else if (action === 'replace') elements.set(cards[1]!, new Y.Map());
      // A client that never saw the card writes its key: it wins by client id, implicitly
      // replacing the card, with no deletion in the update.
      const writer = new Y.Doc();
      writer.clientID = 0xfffffff0;
      if (action === 'concurrent') writer.getMap('elements').set(cards[1]!, new Y.Map());
      const update =
        action === 'concurrent' ? Y.encodeStateAsUpdate(writer) : Y.encodeStateAsUpdate(doc, sv);
      if (action === 'concurrent') expect(Y.decodeUpdate(update).ds.clients.size).toBe(0);
      // Main ran its full check, by key, on every update while structs were held back.
      const candidate = new Y.Doc();
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(server));
      Y.applyUpdate(candidate, update);
      expect([...assignedItems(candidate).values()].map((i) => i.assigneeId)).toEqual([a]);
      const pr = await validateTaskUpdate(db, a, undefined, server, update).then(
        () => false,
        () => true,
      );
      if (pr) refused.push(`${action}, pending ${pending}`);
    }
  // Another assignee shows for the shared id: refused for a guest, as main did with held-back structs.
  expect(refused).toEqual([
    'remove, pending false',
    'replace, pending false',
    'concurrent, pending false',
    'remove, pending true',
    'replace, pending true',
    'concurrent, pending true',
  ]);
});

/**
 * An update of one item, encoded by hand: Yjs's API never writes an item with no content, or one
 * that names both a parent and clocks the receiver already holds.
 */
function itemUpdate(item: {
  client: number;
  clock?: number;
  origin?: Y.ID;
  parent?: string | Y.ID;
  key?: string;
  content: { any: Array<string | null> } | { text: string };
}) {
  const bytes: number[] = [];
  const varUint = (n: number) => {
    while (n > 0x7f) {
      bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(n);
  };
  const string = (s: string) => {
    const utf8 = new TextEncoder().encode(s);
    varUint(utf8.length);
    bytes.push(...utf8);
  };
  // One client, one struct.
  for (const n of [1, 1, item.client, item.clock ?? 0]) varUint(n);
  const ref = 'any' in item.content ? 8 : 4;
  bytes.push(ref | (item.origin ? 0x80 : 0) | (!item.origin && item.key ? 0x20 : 0));
  if (item.origin) {
    varUint(item.origin.client);
    varUint(item.origin.clock);
  } else if (typeof item.parent === 'string') {
    varUint(1);
    string(item.parent);
  } else if (item.parent) {
    varUint(0);
    varUint(item.parent.client);
    varUint(item.parent.clock);
  }
  if (!item.origin && item.key) string(item.key);
  if ('any' in item.content) {
    varUint(item.content.any.length);
    // lib0's writeAny: 126 for null, 119 then the string.
    for (const v of item.content.any)
      if (v === null) bytes.push(126);
      else {
        bytes.push(119);
        string(v);
      }
  } else string(item.content.text);
  varUint(0);
  return new Uint8Array(bytes);
}

it('checks an item with no content, which Yjs integrates at the end of what it holds', async () => {
  const { id, server, items } = boardWithTask();
  const db = {} as Database;
  for (const key of ['id', 'assigneeId']) {
    const entry = items(server).get(0)._map.get(key)!;
    const update = itemUpdate({ client: 777, origin: entry.id, content: { any: [] } });
    expect(Y.decodeUpdate(update).structs[0]?.length).toBe(0);
    expect(mayTouchTasks(server, update)).toBe(true);
    if (key === 'id')
      await expect(validateTaskUpdate(db, id, undefined, server, update)).rejects.toThrow(
        'Guests cannot assign tasks',
      );
  }
});

/** Each to-do item's id, assignee and due date. */
const todoView = (doc: Y.Doc) =>
  [...doc.getMap<Y.Map<unknown>>('elements').values()].flatMap((card) =>
    card.get('items') instanceof Y.Array
      ? (card.get('items') as Y.Array<Y.Map<unknown>>)
          .map((item) => [item.get('id'), item.get('assigneeId'), item.get('dueDate')])
          .map((values) => values.map((v) => (v === undefined ? null : String(v))))
      : [],
  );

/** A board as the server holds it and as a copy of what it stores (and sends) reads it. */
function heldAndStored(memory: Y.Doc) {
  const stored = new Y.Doc();
  Y.applyUpdate(stored, Y.encodeStateAsUpdate(memory));
  return { memory: todoView(memory), stored: todoView(stored) };
}

/** The same after an update, applied to a copy of the board. */
function heldAndStoredAfter(server: Y.Doc, update: Uint8Array) {
  const memory = new Y.Doc();
  Y.applyUpdate(memory, Y.encodeStateAsUpdate(server));
  Y.applyUpdate(memory, update);
  return heldAndStored(memory);
}

it('refuses an item that overlaps stored clocks and names another place than Yjs writes it to', async () => {
  const victim = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a13';
  const db = {} as Database;
  /** The guest's legal write at clock 0, then a second value at clock 1 sent as part of one item. */
  const cases: Record<
    string,
    (b: ReturnType<typeof boardWithTask>, g: Y.Doc) => [unknown, string]
  > = {
    assigneeId: (b, g) => [b.items(g).get(0).set('assigneeId', b.id), victim],
    dueDate: (b, g) => [b.items(g).get(0).set('dueDate', '2026-11-20'), '2026-11-21'],
    id: (b, g) => [b.items(g).get(0).set('id', b.item), 'other'],
  };
  for (const pending of [false, true])
    for (const [name, write] of Object.entries(cases)) {
      const b = boardWithTask();
      const label = `${name}, pending ${pending}`;
      if (pending) b.holdBack();
      const guest = b.other();
      guest.clientID = 555;
      let second = '';
      const legal = b.at(guest, () => {
        second = write(b, guest)[1];
      });
      await validateTaskUpdate(db, b.id, undefined, b.server, legal);
      Y.applyUpdate(b.server, legal);
      const forged = itemUpdate({
        client: 555,
        parent: 'decoy',
        key: 'x',
        content: { any: [null, second] },
      });
      // Applied, the server would hold one thing and store (and send) another.
      const { memory, stored } = heldAndStoredAfter(b.server, forged);
      expect(stored, label).not.toEqual(memory);
      expect(mayTouchTasks(b.server, forged), label).toBe(true);
      await expect(
        validateTaskUpdate(db, b.id, undefined, b.server, forged),
        label,
      ).rejects.toThrow('places items elsewhere than it stores them');
    }
});

it('checks an item that overlaps stored clocks inside an id kept in a Y.Text', async () => {
  const b = boardWithTask();
  const db = {} as Database;
  const text = new Y.Text('t1');
  Y.applyUpdate(
    b.server,
    b.at(b.doc, () => b.items(b.doc).get(0).set('id', text)),
  );
  const guest = b.other();
  guest.clientID = 555;
  // Typing a letter and removing it again leaves the id as it was.
  const legal = b.at(guest, () =>
    guest.transact(() => {
      const t = b.items(guest).get(0).get('id') as Y.Text;
      t.insert(0, 'x');
      t.delete(0, 1);
    }),
  );
  await validateTaskUpdate(db, b.id, undefined, b.server, legal);
  Y.applyUpdate(b.server, legal);
  // Named under another root, the second letter still goes into the id after the first.
  const forged = itemUpdate({ client: 555, parent: 'decoy', content: { text: 'xy' } });
  const { stored } = heldAndStoredAfter(b.server, forged);
  expect(stored.map(([itemId]) => itemId)).toEqual(['yt1']);
  expect(mayTouchTasks(b.server, forged)).toBe(true);
  await expect(validateTaskUpdate(db, b.id, undefined, b.server, forged)).rejects.toThrow(
    'places items elsewhere than it stores them',
  );
});

it('refuses held-back structs that overlap stored clocks, on arrival or once released', async () => {
  const victim = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a13';
  const db = {} as Database;
  // Waiting for a map another client writes later, and overlapping what the guest wrote: refused
  // on arrival.
  {
    const b = boardWithTask();
    const guest = b.other();
    guest.clientID = 555;
    const legal = b.at(guest, () => b.items(guest).get(0).set('assigneeId', b.id));
    Y.applyUpdate(b.server, legal);
    const forged = itemUpdate({
      client: 555,
      parent: Y.createID(888, 1),
      key: 'x',
      content: { any: [null, victim] },
    });
    expect(mayTouchTasks(b.server, forged)).toBe(true);
    await expect(validateTaskUpdate(db, b.id, undefined, b.server, forged)).rejects.toThrow(
      'places items elsewhere than it stores them',
    );
  }
  // Sent before the guest's own writes it overlaps: held back, then released by them.
  const b = boardWithTask();
  const guest = b.other();
  guest.clientID = 555;
  const legal = b.at(guest, () => {
    b.items(guest).get(0).set('dueDate', '2026-11-20');
    b.items(guest).get(0).set('assigneeId', b.id);
  });
  const forged = itemUpdate({
    client: 555,
    clock: 1,
    parent: 'decoy',
    key: 'x',
    content: { any: [null, victim] },
  });
  await validateTaskUpdate(db, b.id, undefined, b.server, forged);
  Y.applyUpdate(b.server, forged);
  expect(b.server.store.pendingStructs).not.toBeNull();
  expect(mayTouchTasks(b.server, legal)).toBe(true);
  await expect(validateTaskUpdate(db, b.id, undefined, b.server, legal)).rejects.toThrow(
    'places items elsewhere than it stores them',
  );
  // Applied anyway, the server would hold one thing and store (and send) another.
  Y.applyUpdate(b.server, legal);
  const { memory, stored } = heldAndStored(b.server);
  expect(stored).not.toEqual(memory);
});
