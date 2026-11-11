// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { readElement, readElementSteps, roots, tableRowMap } from './doc.ts';
import { Element, MAX_STROKES, MAX_TABLE_CELL } from './elements.ts';
import { generateReferenceBoard } from './reference-board.ts';

/** readElement as it was before lists were read item by item: the whole card through Zod. */
function wholeCard(map: Y.Map<unknown>): Element | null {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of map.entries()) {
    if (value instanceof Y.XmlFragment) continue;
    plain[key] = value instanceof Y.AbstractType ? value.toJSON() : value;
  }
  const result = Element.safeParse(plain);
  return result.success ? result.data : null;
}

/** Same result, same key order, read after read. */
const same = (map: Y.Map<unknown>) => {
  const expected = JSON.stringify(wholeCard(map));
  expect(JSON.stringify(readElement(map))).toBe(expected);
  expect(JSON.stringify(readElement(map))).toBe(expected);
  const steps = readElementSteps(map);
  let step = steps.next();
  while (!step.done) {
    expect(step.value).toBeUndefined();
    step = steps.next();
  }
  expect(JSON.stringify(step.value)).toBe(expected);
};

const stroke = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  tool: 'pencil',
  color: '#202020',
  width: 3,
  points: [1, 2, 3, 4],
  ...extra,
});
const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdBy: null, createdAt: 1 };

it('reads every card of the reference board as the whole-card parse does', {
  timeout: 30_000,
}, () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, generateReferenceBoard('small', 3).update);
  for (const map of roots(doc).elements.values()) same(map);
  // A board with a real history: about 4 s on a CI runner, past the default 5 s when it is busy.
});

it('follows strokes and rows as they change, bad items included', () => {
  const doc = new Y.Doc();
  const { elements } = roots(doc);
  const frame = new Y.Map<unknown>(
    Object.entries({ ...base, id: 'frame0000000000000000', type: 'frame' }),
  );
  const plan = new Y.Map<unknown>(
    Object.entries({ ...base, id: 'plan00000000000000000', type: 'plan' }),
  );
  const table = new Y.Map<unknown>(
    Object.entries({
      ...base,
      id: 'table0000000000000000',
      type: 'table',
      columns: Y.Array.from([new Y.Map<unknown>([['id', 'col000000000000000000']])]),
    }),
  );
  elements.set('frame0000000000000000', frame);
  elements.set('plan00000000000000000', plan);
  elements.set('table0000000000000000', table);
  const frameStrokes = new Y.Array<unknown>();
  const planStrokes = new Y.Array<unknown>();
  const rows = new Y.Array<Y.Map<unknown>>();
  frame.set('strokes', frameStrokes);
  plan.set('strokes', planStrokes);
  table.set('rows', rows);
  // Register before the cache's invalidation hook: reads in deep observers must be current.
  elements.observeDeep(() => same(table));
  doc.on('beforeObserverCalls', () => same(table));
  const check = () => {
    for (const map of [frame, plan, table]) same(map);
  };

  check();
  frameStrokes.push([
    stroke('s0000000000000000000a'),
    stroke('s0000000000000000000b', { layer: 'x' }),
  ]);
  planStrokes.push([stroke('s0000000000000000000c', { layer: 'set' })]);
  rows.push([
    tableRowMap({ id: 'row00000000000000000a', cells: { col000000000000000000: 'uno' } }),
  ]);
  check();
  // A bad stroke fails a frame but is left out of a plan.
  frameStrokes.push([stroke('s0000000000000000000d', { color: 'red' })]);
  planStrokes.push([stroke('s0000000000000000000e', { width: 0 }), 7, null]);
  check();
  expect(readElement(frame)).toBeNull();
  frameStrokes.delete(2, 1);
  check();
  expect(readElement(frame)).not.toBeNull();
  // Past the limit a frame fails and a plan is cut.
  const many = Array.from({ length: MAX_STROKES + 1 }, (_, i) =>
    stroke(`m${String(i).padStart(20, '0')}`),
  );
  frameStrokes.push(many);
  planStrokes.push(many);
  check();
  frameStrokes.delete(0, frameStrokes.length);
  planStrokes.delete(0, planStrokes.length);
  check();
  // A cell edited in place, too long, fixed, a key the schema does not know, the row removed.
  const cells = rows.get(0).get('cells') as Y.Map<string>;
  doc.transact(() => {
    cells.set('col000000000000000000', 'x'.repeat(MAX_TABLE_CELL + 1));
    expect(readElement(table)).toBeNull();
    cells.set('col000000000000000000', 'inside');
    same(table);
    cells.set('second', 'changed after an earlier cached read in the same transaction');
    same(table);
  });
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const remoteRows = roots(remote)
    .elements.get(table.get('id') as string)!
    .get('rows') as Y.Array<Y.Map<unknown>>;
  (remoteRows.get(0).get('cells') as Y.Map<string>).set('second', 'remote');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
  same(table);
  remote.destroy();
  cells.set('col000000000000000000', 'due');
  check();
  cells.set('col000000000000000000', 'x'.repeat(MAX_TABLE_CELL + 1));
  check();
  expect(readElement(table)).toBeNull();
  cells.set('col000000000000000000', 'tre');
  rows.get(0).set('extra', 1);
  check();
  rows.delete(0, 1);
  check();
});
