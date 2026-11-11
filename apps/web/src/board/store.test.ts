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

it('hydrates cooperatively without exposing partial elements, and rereads cards changed by local and remote edits', async () => {
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
    return count.reads;
  };
  const small = run(250);
  const large = run(2000);
  // Linear: 8x the cards costs about 8x the reads. Quadratic would be about 64x.
  expect(large / small).toBeLessThan(12);
}, 60_000);

it('finishes hydrating while one card is edited at every pause, rereading only what changed', async () => {
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
