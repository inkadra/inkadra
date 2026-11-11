import * as core from '@inkadra/canvas-core';
import { createElement, currentElements, listElements, updateElement } from '@inkadra/canvas-core';
import * as schema from '@inkadra/doc-schema';
import { addElement, roots, UNSORTED } from '@inkadra/doc-schema';
import { generateReferenceBoard } from '@inkadra/doc-schema/reference-board';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL } from './store.ts';

const opts = { userId: null, origin: LOCAL };
const sorted = (doc: Y.Doc) =>
  currentElements(doc)
    .map((e) => JSON.stringify(e))
    .sort();
const fromDoc = (doc: Y.Doc) =>
  listElements(doc)
    .map((e) => JSON.stringify(e))
    .sort();

it('matches a full index through the reference generator gestures and remote syncs', () => {
  let checked = 0;
  generateReferenceBoard('small', 19, (doc) => {
    const store = new BoardStore(doc);
    doc.on('afterTransaction', () => {
      const all = listElements(doc);
      const snapshot = store.getSnapshot();
      expect([...snapshot.byId.values()]).toEqual(all);
      expect(snapshot.canvas).toEqual(core.canvasElements(all));
      expect(snapshot.unsorted).toEqual(core.childrenOf(all, UNSORTED));
      expect([...snapshot.columns]).toEqual(
        all.filter(core.isContainer).map((el) => [el.id, core.childrenOf(all, el.id)]),
      );
      checked++;
    });
  });
  expect(checked).toBeGreaterThan(1000);
}, 120_000);

it('sorts only the affected container, and never sorts content edits', () => {
  const doc = new Y.Doc();
  const column = createElement(doc, 'column', { x: 0, y: 0 }, { title: '' }, opts);
  const note = createElement(doc, 'note', { x: 0, y: 0 }, { parent: column.id }, opts);
  const store = new BoardStore(doc);
  const before = store.getSnapshot();
  const canvas = vi.spyOn(core, 'canvasElements');
  const children = vi.spyOn(core, 'childrenOf');
  updateElement(doc, note.id, { x: 10 }, LOCAL);
  expect(canvas).not.toHaveBeenCalled();
  expect(children).not.toHaveBeenCalled();
  expect(store.getSnapshot().canvas).toBe(before.canvas);
  expect(store.getSnapshot().byId.get(column.id)).toBe(before.byId.get(column.id));
  expect(before.columns.get(column.id)?.[0]).toBe(before.byId.get(note.id));
  expect(before.byId.get(note.id)?.x).toBe(0);
  expect(store.getSnapshot().columns.get(column.id)?.[0]).toBe(
    store.getSnapshot().byId.get(note.id),
  );
  updateElement(doc, note.id, { z: 'a9' }, LOCAL);
  expect(canvas).not.toHaveBeenCalled();
  expect(children).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
  store.destroy();
});

it('keeps the full rebuild tie-break when a batch changes order and containers', () => {
  const doc = new Y.Doc();
  const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  const b = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  const store = new BoardStore(doc);
  doc.transact(() => {
    updateElement(doc, a.id, { z: 'a0' }, LOCAL);
    updateElement(doc, b.id, { z: 'a0' }, LOCAL);
  }, LOCAL);
  expect(store.getSnapshot().canvas).toEqual(core.canvasElements(listElements(doc)));
  doc.transact(() => {
    updateElement(doc, a.id, { parent: UNSORTED }, LOCAL);
    updateElement(doc, b.id, { parent: UNSORTED }, LOCAL);
  }, LOCAL);
  expect(store.getSnapshot().canvas).toEqual([]);
  expect(store.getSnapshot().unsorted).toEqual(core.childrenOf(listElements(doc), UNSORTED));
  store.destroy();
});

it('keeps element identity when list items are replaced with equal JSON', () => {
  const doc = new Y.Doc();
  const frame = createElement(doc, 'frame', { x: 0, y: 0 }, {}, opts);
  core.addStroke(
    doc,
    frame.id,
    {
      tool: 'pencil',
      color: '#202020',
      width: 4,
      points: [1, 2, 3, 4],
    },
    LOCAL,
  );
  const store = new BoardStore(doc);
  const before = store.getSnapshot();
  const map = roots(doc).elements.get(frame.id)!;
  const strokes = map.get('strokes') as Y.Array<unknown>;
  map.set('strokes', Y.Array.from(JSON.parse(JSON.stringify(strokes.toArray()))));
  expect(store.getSnapshot()).toBe(before);
  core.addStroke(
    doc,
    frame.id,
    {
      tool: 'pencil',
      color: '#202020',
      width: 4,
      points: [5, 6, 7, 8],
    },
    LOCAL,
  );
  expect(store.getSnapshot().byId.get(frame.id)).not.toBe(before.byId.get(frame.id));
  store.destroy();
});

it('indexes orphaned children when their container appears and removes invalid cards', () => {
  const doc = new Y.Doc();
  const container = 'container000000000000';
  const note = createElement(doc, 'note', { x: 0, y: 0 }, { parent: container }, opts);
  const store = new BoardStore(doc);
  const column = createElement(doc, 'column', { x: 0, y: 0 }, { title: '' }, opts);
  addElement(doc, { ...column, id: container });
  expect(
    store
      .getSnapshot()
      .columns.get(container)
      ?.map((el) => el.id),
  ).toEqual([note.id]);
  updateElement(doc, note.id, { parent: column.id }, LOCAL);
  expect(
    store
      .getSnapshot()
      .columns.get(column.id)
      ?.map((el) => el.id),
  ).toEqual([note.id]);
  updateElement(doc, note.id, { parent: UNSORTED }, LOCAL);
  expect(store.getSnapshot().unsorted.map((el) => el.id)).toEqual([note.id]);
  roots(doc).elements.get(note.id)!.set('w', 'invalid');
  expect(store.getSnapshot().byId.has(note.id)).toBe(false);
  expect(store.getSnapshot().unsorted).toEqual([]);
  roots(doc).elements.get(note.id)!.set('w', 200);
  expect(store.getSnapshot().unsorted.map((el) => el.id)).toEqual([note.id]);
  store.destroy();
});

it('gives the helpers its snapshot only while it is current', () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  updateElement(doc, a.id, { x: 50 }, LOCAL);
  expect(sorted(doc)).toEqual(fromDoc(doc));
  expect(currentElements(doc)[0]).toBe(store.getSnapshot().byId.get(a.id));

  // Inside a transaction the snapshot is behind: the helpers read the document, so two cards
  // created in one step still stack.
  let inside: string[] = [];
  doc.transact(() => {
    const b = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const c = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    inside = [b.z, c.z];
    expect(currentElements(doc)).toHaveLength(3);
  }, LOCAL);
  expect(inside[1]! > inside[0]!).toBe(true);
  expect(sorted(doc)).toEqual(fromDoc(doc));

  // Remote edits arrive through applyUpdate like any other transaction.
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  createElement(other, 'note', { x: 0, y: 0 }, {}, { userId: null });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
  expect(sorted(doc)).toEqual(fromDoc(doc));

  store.destroy();
  expect(sorted(doc)).toEqual(fromDoc(doc));
});

it('reads the document when a card is stored under a key that is not its id', () => {
  const doc = new Y.Doc();
  const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  roots(doc).elements.set('notTheIdOfTheCard000', roots(doc).elements.get(a.id)!.clone());
  const store = new BoardStore(doc);
  // The snapshot holds the card once, the document twice.
  expect(store.getSnapshot().byId.size).toBe(1);
  expect(currentElements(doc)).toHaveLength(2);
  updateElement(doc, a.id, { x: 20 }, LOCAL);
  expect(store.getSnapshot().canvas).toEqual(
    core.canvasElements([...store.getSnapshot().byId.values()]),
  );
  store.destroy();
});

// The reference board build alone takes about 4 s on a CI runner, near the 5 s default.
it('hydrates cooperatively without exposing partial elements, and rereads cards changed by local and remote edits', {
  timeout: 30_000,
}, async () => {
  const { update } = generateReferenceBoard('small', 7);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const store = BoardStore.hydrate(doc, { budgetMs: 0.1 });
  try {
    const listener = vi.fn();
    store.subscribe(listener);
    await vi.advanceTimersToNextTimerAsync();
    expect(store.hydrating).toBe(true);
    expect(store.getSnapshot().byId.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    const a = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const b = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    expect(b.z > a.z).toBe(true); // Helpers fall back to validated reads while loading.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    roots(remote).elements.get(a.id)!.set('w', 'invalid');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
    await vi.advanceTimersToNextTimerAsync();
    roots(remote).elements.get(b.id)!.set('x', 87);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
    await vi.runAllTimersAsync();
    await store.whenHydrated;
    expect(store.hydrating).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().byId.has(a.id)).toBe(false);
    expect(store.getSnapshot().byId.get(b.id)?.x).toBe(87);
    expect(sorted(doc)).toEqual(fromDoc(doc));
    const all = listElements(doc);
    expect(store.getSnapshot().canvas).toEqual(core.canvasElements(all));
    expect([...store.getSnapshot().columns]).toEqual(
      all.filter(core.isContainer).map((el) => [el.id, core.childrenOf(all, el.id)]),
    );
    updateElement(doc, b.id, { x: 90 }, LOCAL);
    expect(store.getSnapshot().byId.get(b.id)?.x).toBe(90);
    remote.destroy();
  } finally {
    store.destroy();
    vi.useRealTimers();
  }
});

it('fails closed when hydration throws: nothing published, the error exposed', async () => {
  const { update } = generateReferenceBoard('small', 7);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const failure = new Error('read failed');
  vi.spyOn(schema, 'readElementSteps').mockImplementation(() => {
    throw failure;
  });
  const store = BoardStore.hydrate(doc);
  const listener = vi.fn();
  store.subscribe(listener);
  await expect(store.whenHydrated).rejects.toBe(failure);
  expect(store.hydrationError).toBe(failure);
  expect(store.hydrating).toBe(true);
  expect(store.getSnapshot().byId.size).toBe(0);
  expect(listener).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  store.destroy();
}, 30_000);

it('cancels hydration on destroy and rejects invalid budgets', async () => {
  const doc = new Y.Doc();
  for (const budgetMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => BoardStore.hydrate(doc, { budgetMs })).toThrow(RangeError);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const store = BoardStore.hydrate(doc);
  const listener = vi.fn();
  store.subscribe(listener);
  store.destroy();
  await vi.runAllTimersAsync();
  await store.whenHydrated;
  expect(listener).not.toHaveBeenCalled();
  expect(store.getSnapshot().byId.size).toBe(0);
  vi.useRealTimers();
});

/** Counts calls and visited entries on each transaction's `changed` map. */
function countChangedReads(doc: Y.Doc) {
  const count = { reads: 0 };
  doc.on('beforeTransaction', (transaction: Y.Transaction) => {
    const changed = transaction.changed;
    const { has, get, forEach } = changed;
    changed.has = (key) => {
      count.reads++;
      return has.call(changed, key);
    };
    changed.get = (key) => {
      count.reads++;
      return get.call(changed, key);
    };
    changed.forEach = (fn, thisArg) =>
      forEach.call(changed, (value, key, map) => {
        count.reads++;
        fn.call(thisArg, value, key, map);
      });
    const loose = changed as unknown as Record<PropertyKey, () => Iterator<unknown>>;
    for (const name of ['keys', 'values', 'entries', Symbol.iterator]) {
      const original = loose[name]!;
      loose[name] = function* () {
        const it = original.call(changed);
        for (let step = it.next(); !step.done; step = it.next()) {
          count.reads++;
          yield step.value;
        }
      };
    }
  });
  return count;
}

it('reads a large remote move in time linear in the number of cards', () => {
  const run = (n: number) => {
    const doc = new Y.Doc();
    const ids: string[] = [];
    doc.transact(() => {
      for (let i = 0; i < n; i++) {
        const at = { x: i, y: 0 };
        const el =
          i % 2 === 0
            ? createElement(doc, 'table', at, core.newTable(2, 2), opts)
            : createElement(doc, 'note', at, {}, opts);
        ids.push(el.id);
      }
    }, LOCAL);
    const store = new BoardStore(doc);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.transact(() => {
      for (const id of ids) roots(remote).elements.get(id)!.set('x', 5000);
    });
    const count = countChangedReads(doc);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
    expect([...store.getSnapshot().byId.values()].every((el) => el.x === 5000)).toBe(true);
    expect(store.getSnapshot().canvas).toEqual(core.canvasElements(listElements(doc)));
    store.destroy();
    remote.destroy();
    // At least one read per card: the counter is really on the observed transaction.
    expect(count.reads).toBeGreaterThanOrEqual(n);
    return count.reads;
  };
  const small = run(250);
  const large = run(2000);
  // Linear: 8x the cards costs about 8x the reads. Quadratic would be about 64x.
  expect(large / small).toBeLessThan(12);
}, 60_000);

it('finishes hydrating while one card is edited at every pause, rereading only what changed', {
  timeout: 30_000,
}, async () => {
  const { update } = generateReferenceBoard('small', 3);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const all = listElements(doc);
  const table = all
    .filter((el) => el.type === 'table')
    .sort((a, b) => b.rows.length - a.rows.length)[0]!;
  const note = all.find((el) => el.type === 'note')!;
  const [row] = table.rows;
  const [column] = table.columns;
  const steps = vi.spyOn(schema, 'readElementSteps');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const store = BoardStore.hydrate(doc, { budgetMs: 0.05 });
  try {
    let edits = 0;
    while (store.hydrating && edits < 20_000) {
      // Typing: the same cell of the largest table, and a note that moves.
      core.setTableCell(doc, table.id, row!.id, column!.id, `typed ${edits}`);
      updateElement(doc, note.id, { x: edits }, LOCAL);
      edits++;
      await vi.advanceTimersToNextTimerAsync();
    }
    await store.whenHydrated;
    expect(store.hydrating).toBe(false);
    expect(edits).toBeGreaterThan(10);
    // Each element is read cooperatively once; only the edited ones again.
    expect(steps.mock.calls.length).toBeLessThan(all.length + 2 * edits);
    const fresh = new BoardStore(doc);
    expect([...store.getSnapshot().byId]).toEqual([...fresh.getSnapshot().byId]);
    expect(store.getSnapshot().canvas).toEqual(fresh.getSnapshot().canvas);
    expect([...store.getSnapshot().columns]).toEqual([...fresh.getSnapshot().columns]);
    expect(store.getSnapshot().unsorted).toEqual(fresh.getSnapshot().unsorted);
    expect(store.getSnapshot().byId.get(note.id)?.x).toBe(edits - 1);
    fresh.destroy();
  } finally {
    store.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

it('edits a cell of a table made in this session without going through every row', () => {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  // Its rows are first read by the store's observer, while the transaction cleans up.
  const content = core.newTable(3, 300);
  const table = createElement(doc, 'table', { x: 0, y: 0 }, content, opts);
  const row = content.rows[150]!;
  const column = content.columns[0]!;
  const entries = vi.spyOn(Y.Map.prototype, 'entries');
  const values = vi.spyOn(Y.Map.prototype, 'values');
  core.setTableCell(doc, table.id, row.id, column.id, 'edited');
  const el = store.getSnapshot().byId.get(table.id);
  expect(el?.type === 'table' && el.rows[150]?.cells[column.id]).toBe('edited');
  // Content compares and walks of unchanged rows would be 300 or more.
  expect(entries.mock.calls.length + values.mock.calls.length).toBeLessThan(30);
  vi.restoreAllMocks();
  store.destroy();
});

/** A scheduler the test steps by hand: each slice starts when `step()` resolves the last call. */
function manualScheduler() {
  const waiting: Array<() => void> = [];
  return {
    calls: 0,
    schedule() {
      this.calls++;
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
    async step() {
      for (const resolve of waiting.splice(0)) resolve();
      // Let the hydration task run up to its next pause.
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

/** Everything the store shows is the current, validated read of its card. */
function expectValidatedView(store: BoardStore, doc: Y.Doc) {
  for (const [id, el] of store.getSnapshot().byId) {
    const map = roots(doc).elements.get(id);
    expect(map).toBeDefined();
    expect(el).toEqual(schema.readElement(map!));
  }
}

/** The cards with the columns and scenes that hold them, as the progressive view reads them. */
function withContainers(all: readonly schema.Element[], ids: readonly string[]) {
  const byId = new Map(all.map((el) => [el.id, el]));
  const out = new Set<string>();
  for (const id of ids) {
    let at: string | null | undefined = id;
    while (at && byId.has(at) && !out.has(at)) {
      out.add(at);
      at = byId.get(at)!.parent;
    }
  }
  return out;
}

function expectSameAsFresh(store: BoardStore, doc: Y.Doc) {
  const fresh = new BoardStore(doc);
  expect([...store.getSnapshot().byId]).toEqual([...fresh.getSnapshot().byId]);
  expect(store.getSnapshot().canvas).toEqual(fresh.getSnapshot().canvas);
  expect([...store.getSnapshot().columns]).toEqual([...fresh.getSnapshot().columns]);
  expect(store.getSnapshot().unsorted).toEqual(fresh.getSnapshot().unsorted);
  fresh.destroy();
}

it('hydrates with the scheduler it is given, never a timer', { timeout: 30_000 }, async () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, generateReferenceBoard('small', 7).update);
  const timers = vi.spyOn(globalThis, 'setTimeout');
  let calls = 0;
  const store = BoardStore.hydrate(doc, {
    budgetMs: 1,
    schedule: () => {
      calls++;
      return new Promise((resolve) => setImmediate(resolve));
    },
  });
  await store.whenHydrated;
  expect(calls).toBeGreaterThan(2);
  expect(timers).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  expectSameAsFresh(store, doc);
  store.destroy();
});

it('reads priority cards first and shows only them, validated and current, until it is done', {
  timeout: 30_000,
}, async () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, generateReferenceBoard('small', 11).update);
  const all = listElements(doc);
  const frames = all.filter((el) => el.type === 'frame').map((el) => el.id);
  const [shown, other] = [frames.slice(0, 3), all.find((el) => el.type === 'note')!];
  // The frames' scenes or columns are shown with them.
  const expected = withContainers(all, shown);
  const scheduler = manualScheduler();
  const store = BoardStore.hydrate(doc, {
    budgetMs: 0.01,
    schedule: () => scheduler.schedule(),
    priority: [shown[0]!, 'missing-key', shown[1]!, shown[2]!],
    progressive: true,
  });
  const views: Array<Set<string>> = [];
  store.subscribe(() => {
    expectValidatedView(store, doc);
    views.push(new Set(store.getSnapshot().byId.keys()));
  });
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const sync = () => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
  let edits = 0;
  let checked = 0;
  while (store.hydrating && edits < 100_000) {
    await scheduler.step();
    expectValidatedView(store, doc);
    // This step may have finished hydrating: the complete snapshot is then shown.
    if (!store.hydrating) break;
    for (const id of store.getSnapshot().byId.keys()) expect(expected.has(id)).toBe(true);
    if (views.length > 0 && edits % 7 === 0) {
      // A shown card moves, another becomes invalid then valid again; a hidden card moves.
      roots(remote).elements.get(shown[0]!)!.set('x', edits);
      roots(remote)
        .elements.get(shown[1]!)!
        .set('w', edits % 2 ? 'invalid' : 300);
      roots(remote).elements.get(other.id)!.set('x', edits);
      sync();
      expectValidatedView(store, doc);
      expect(store.getSnapshot().byId.get(shown[0]!)?.x).toBe(edits);
      expect(store.getSnapshot().byId.has(other.id)).toBe(false);
      checked++;
    }
    edits++;
  }
  await store.whenHydrated;
  expect(store.hydrating).toBe(false);
  // The first view held the priority cards only; the last one is the complete snapshot.
  expect(views[0]).toEqual(expected);
  expect(checked).toBeGreaterThan(0);
  expect(views.length).toBeGreaterThan(2);
  expect(views.at(-1)!.size).toBe(store.getSnapshot().byId.size);
  expectSameAsFresh(store, doc);
  remote.destroy();
  store.destroy();
});

it('reads first the cards a priority test picks', { timeout: 30_000 }, async () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, generateReferenceBoard('small', 11).update);
  const types: string[] = [];
  const original = schema.readElementSteps;
  vi.spyOn(schema, 'readElementSteps').mockImplementation((map, cooperative) => {
    types.push(map.get('type') as string);
    return original(map, cooperative);
  });
  const store = BoardStore.hydrate(doc, { priority: (_key, map) => map.get('type') === 'table' });
  await store.whenHydrated;
  vi.restoreAllMocks();
  const tables = listElements(doc).filter((el) => el.type === 'table').length;
  expect(tables).toBeGreaterThan(0);
  expect(types.slice(0, tables)).toEqual(Array(tables).fill('table'));
  expect(types.slice(tables)).not.toContain('table');
  store.destroy();
});

it('finishes a progressive hydration under continuous edits', {
  timeout: 30_000,
}, async () => {
  const { update } = generateReferenceBoard('small', 3);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const all = listElements(doc);
  const note = all.find((el) => el.type === 'note')!;
  const table = all.find((el) => el.type === 'table') as Extract<schema.Element, { type: 'table' }>;
  const scheduler = manualScheduler();
  const store = BoardStore.hydrate(doc, {
    budgetMs: 0.02,
    schedule: () => scheduler.schedule(),
    priority: [note.id, table.id],
    progressive: true,
  });
  store.subscribe(() => expectValidatedView(store, doc));
  let edits = 0;
  while (store.hydrating && edits < 20_000) {
    core.setTableCell(doc, table.id, table.rows[0]!.id, table.columns[0]!.id, `typed ${edits}`);
    updateElement(doc, note.id, { x: edits }, LOCAL);
    edits++;
    await scheduler.step();
  }
  await store.whenHydrated;
  expect(store.hydrating).toBe(false);
  expectSameAsFresh(store, doc);
  expect(store.getSnapshot().byId.get(note.id)?.x).toBe(edits - 1);
  store.destroy();
});

it('withdraws the progressive view when hydration fails after showing it', {
  timeout: 30_000,
}, async () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, generateReferenceBoard('small', 11).update);
  const all = listElements(doc);
  const shown = all.filter((el) => el.type === 'note' && el.parent === null).slice(0, 2);
  const failing = all.find((el) => el.type === 'frame')!;
  const failure = new Error('read failed');
  const original = schema.readElementSteps;
  vi.spyOn(schema, 'readElementSteps').mockImplementation((map, cooperative) => {
    if (map.get('id') === failing.id) throw failure;
    return original(map, cooperative);
  });
  const scheduler = manualScheduler();
  const store = BoardStore.hydrate(doc, {
    budgetMs: 0.01,
    schedule: () => scheduler.schedule(),
    priority: shown.map((el) => el.id),
    progressive: true,
  });
  const views: number[] = [];
  store.subscribe(() => views.push(store.getSnapshot().byId.size));
  try {
    while (!store.hydrationError && scheduler.calls < 100_000) await scheduler.step();
    await expect(store.whenHydrated).rejects.toBe(failure);
    expect(store.hydrationError).toBe(failure);
    // Shown, then withdrawn: nothing stays on screen that hydration no longer keeps current.
    expect(views[0]).toBe(shown.length);
    expect(views.at(-1)).toBe(0);
    expect(store.getSnapshot().byId.size).toBe(0);
    // No longer kept: an edit of a card that was shown publishes nothing.
    const before = views.length;
    updateElement(doc, shown[0]!.id, { x: 5 }, LOCAL);
    expect(views.length).toBe(before);
    expect(store.getSnapshot().byId.size).toBe(0);
  } finally {
    vi.restoreAllMocks();
    store.destroy();
  }
});

it('ends hydration with a rejecting scheduler, never with an unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const settle = async () => {
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  try {
    // Mid-way: hydration ends with the scheduler's error.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, generateReferenceBoard('small', 7).update);
    const failure = new Error('no more frames');
    let calls = 0;
    const store = BoardStore.hydrate(doc, {
      budgetMs: 0.01,
      schedule: () => (++calls > 3 ? Promise.reject(failure) : Promise.resolve()),
    });
    await expect(store.whenHydrated).rejects.toBe(failure);
    expect(store.hydrationError).toBe(failure);
    expect(store.getSnapshot().byId.size).toBe(0);
    store.destroy();
    // At the end: a small board finishes before the turn it queued is awaited.
    const small = new Y.Doc();
    createElement(small, 'note', { x: 0, y: 0 }, {}, opts);
    let n = 0;
    const done = BoardStore.hydrate(small, {
      schedule: () => (++n === 1 ? Promise.resolve() : Promise.reject(new Error('late'))),
    });
    await done.whenHydrated;
    expect(done.getSnapshot().byId.size).toBe(1);
    done.destroy();
    await settle();
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}, 30_000);

it('settles hydration on destroy while the scheduler never resolves', async () => {
  const doc = new Y.Doc();
  createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  const store = BoardStore.hydrate(doc, { schedule: () => new Promise<void>(() => {}) });
  store.destroy();
  await expect(store.whenHydrated).resolves.toBeUndefined();
  expect(store.getSnapshot().byId.size).toBe(0);
});

it('draws a priority card inside its column, read with it', async () => {
  const doc = new Y.Doc();
  const column = createElement(doc, 'column', { x: 0, y: 0 }, { title: '' }, opts);
  const inside = createElement(doc, 'note', { x: 0, y: 0 }, { parent: column.id }, opts);
  createElement(doc, 'note', { x: 0, y: 0 }, { parent: column.id }, opts);
  for (let i = 0; i < 50; i++) createElement(doc, 'note', { x: i, y: 0 }, {}, opts);
  const scheduler = manualScheduler();
  const store = BoardStore.hydrate(doc, {
    budgetMs: 0.01,
    schedule: () => scheduler.schedule(),
    priority: [inside.id],
    progressive: true,
  });
  let first: ReturnType<BoardStore['getSnapshot']> | null = null;
  store.subscribe(() => {
    first ??= store.getSnapshot();
  });
  while (!first && store.hydrating) await scheduler.step();
  // The column comes with the card, holding only it for now.
  expect([...first!.byId.keys()].sort()).toEqual([column.id, inside.id].sort());
  expect(first!.columns.get(column.id)?.map((el) => el.id)).toEqual([inside.id]);
  expect(store.hydrating).toBe(true);
  while (store.hydrating) await scheduler.step();
  expectSameAsFresh(store, doc);
  store.destroy();
});

it('costs about the same with every card a priority card', { timeout: 60_000 }, async () => {
  // Whether every priority card is read is a counter: thousands of them stay linear.
  const doc = new Y.Doc();
  doc.transact(() => {
    for (let i = 0; i < 4000; i++) createElement(doc, 'note', { x: i, y: 0 }, {}, opts);
  }, LOCAL);
  const keys = [...roots(doc).elements.keys()];
  const time = async (options: Parameters<typeof BoardStore.hydrate>[1]) => {
    const start = performance.now();
    const store = BoardStore.hydrate(doc, {
      ...options,
      schedule: () => new Promise((resolve) => setImmediate(resolve)),
    });
    await store.whenHydrated;
    store.destroy();
    return performance.now() - start;
  };
  await time({});
  const plain = Math.min(await time({}), await time({}));
  const prioritised = Math.min(
    await time({ priority: keys, progressive: true }),
    await time({ priority: keys, progressive: true }),
  );
  expect(prioritised / plain).toBeLessThan(2.5);
});

/** The host's build identity, as an app passes it to export and open snapshots. */
const BUILD = 'web 1.0.0 (abc1234)';

it('opens from a validated snapshot without validating the cards it holds', {
  timeout: 60_000,
}, async () => {
  const { update } = generateReferenceBoard('small', 13);
  const first = new Y.Doc();
  Y.applyUpdate(first, update);
  const exporter = new BoardStore(first);
  const snapshot = exporter.exportValidatedSnapshot(BUILD)!;
  expect(snapshot).toBeTypeOf('string');
  // Not while a transaction is open.
  first.transact(() => expect(exporter.exportValidatedSnapshot(BUILD)).toBeNull());
  exporter.destroy();

  // The store's own reads: whole cards (synchronous) and step by step (hydration).
  const { readElement, readElementSteps } = schema;
  let reads = 0;
  vi.spyOn(schema, 'readElementSteps').mockImplementation((map, cooperative) => {
    reads++;
    return readElementSteps(map, cooperative);
  });
  vi.spyOn(schema, 'readElement').mockImplementation((map) => {
    reads++;
    return readElement(map);
  });
  let opened = 0;
  const open = async (doc: Y.Doc, text: string, hydrate: boolean, build = BUILD) => {
    reads = 0;
    const store = hydrate
      ? BoardStore.hydrate(doc, {
          snapshot: { text, build },
          schedule: () => new Promise((resolve) => setImmediate(resolve)),
        })
      : new BoardStore(doc, { snapshot: { text, build } });
    await store.whenHydrated;
    opened = reads;
    expectSameAsFresh(store, doc);
    return store;
  };
  try {
    for (const hydrate of [false, true]) {
      // The same document: no card is validated again.
      const same = new Y.Doc();
      Y.applyUpdate(same, update);
      const store = await open(same, snapshot, hydrate);
      expect(opened).toBe(0);
      // Edits after the open read as usual, strokes and rows included.
      const { frameId, tableId } = findBench(same);
      core.addStroke(
        same,
        frameId,
        { tool: 'pencil', color: '#202020', width: 4, points: [1, 2, 3, 4] },
        LOCAL,
      );
      const table = store.getSnapshot().byId.get(tableId) as Extract<
        schema.Element,
        { type: 'table' }
      >;
      core.setTableCell(same, tableId, table.rows[0]!.id, table.columns[0]!.id, 'after', LOCAL);
      expectSameAsFresh(store, same);
      expectValidatedView(store, same);
      store.destroy();

      // Changed since: only the changed cards are read.
      const changed = new Y.Doc();
      Y.applyUpdate(changed, update);
      const [a, b] = [...roots(changed).elements.keys()];
      roots(changed).elements.get(a!)!.set('x', 12345);
      roots(changed).elements.get(b!)!.set('w', 'invalid');
      (await open(changed, snapshot, hydrate)).destroy();
      expect(opened).toBe(2);

      // Corrupted, of another build or of another board: ignored whole, every card is read.
      for (const [text, build] of [
        [snapshot.slice(0, snapshot.length / 2), BUILD],
        [snapshot.replace('\t', ' '), BUILD],
        ['x', BUILD],
        [snapshot, 'app 1.0.1 (def5678)'],
      ] as const) {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, update);
        (await open(doc, text, hydrate, build)).destroy();
        expect(opened).toBe(roots(doc).elements.size);
      }
      const other = new Y.Doc();
      Y.applyUpdate(other, update);
      roots(other).meta.set('boardId', 'another-board');
      (await open(other, snapshot, hydrate)).destroy();
      expect(opened).toBe(roots(other).elements.size);
    }
  } finally {
    vi.restoreAllMocks();
  }
});

it('reads the live document, never the snapshot, for every edit after opening from one', () => {
  // A line whose read differs from the stored card with the same items: what a peer rewriting
  // Yjs history could make a snapshot hold. The store shows it until the card changes, then
  // reads the document; no write copies it back.
  const doc = new Y.Doc();
  const note = createElement(doc, 'note', { x: 10, y: 20 }, {}, opts);
  createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  const exporter = new BoardStore(doc);
  const text = exporter.exportValidatedSnapshot(BUILD)!.replace('"x":10,', '"x":999,');
  exporter.destroy();
  const store = new BoardStore(doc, { snapshot: { text, build: BUILD } });
  expect(store.getSnapshot().byId.get(note.id)?.x).toBe(999);
  // A helper that orders by the view writes only the order, and the card is read again.
  core.bringToFront(doc, [note.id], LOCAL);
  expect(roots(doc).elements.get(note.id)!.get('x')).toBe(10);
  expect(store.getSnapshot().byId.get(note.id)?.x).toBe(10);
  updateElement(doc, note.id, { y: 30 }, LOCAL);
  expect(store.getSnapshot().byId.get(note.id)).toMatchObject({ x: 10, y: 30 });
  expectSameAsFresh(store, doc);
  store.destroy();
});

it('finishes a progressive hydration from a snapshot under continuous edits', {
  timeout: 30_000,
}, async () => {
  const { update } = generateReferenceBoard('small', 3);
  const first = new Y.Doc();
  Y.applyUpdate(first, update);
  const exporter = new BoardStore(first);
  const text = exporter.exportValidatedSnapshot(BUILD)!;
  exporter.destroy();
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const all = listElements(doc);
  const note = all.find((el) => el.type === 'note')!;
  const table = all.find((el) => el.type === 'table') as Extract<schema.Element, { type: 'table' }>;
  const scheduler = manualScheduler();
  const store = BoardStore.hydrate(doc, {
    budgetMs: 0.02,
    schedule: () => scheduler.schedule(),
    snapshot: { text, build: BUILD },
    priority: [note.id, table.id],
    progressive: true,
  });
  store.subscribe(() => expectValidatedView(store, doc));
  let edits = 0;
  while (store.hydrating && edits < 20_000) {
    core.setTableCell(doc, table.id, table.rows[0]!.id, table.columns[0]!.id, `typed ${edits}`);
    updateElement(doc, note.id, { x: edits }, LOCAL);
    edits++;
    await scheduler.step();
  }
  await store.whenHydrated;
  expect(store.hydrating).toBe(false);
  expectSameAsFresh(store, doc);
  expect(store.getSnapshot().byId.get(note.id)?.x).toBe(edits - 1);
  store.destroy();
});

function findBench(doc: Y.Doc) {
  const all = listElements(doc);
  const frame = all
    .filter((el) => el.type === 'frame')
    .sort((a, b) => (b.strokes?.length ?? 0) - (a.strokes?.length ?? 0))[0]!;
  const table = all.find((el) => el.type === 'table')!;
  return { frameId: frame.id, tableId: table.id };
}
