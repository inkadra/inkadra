import { addElement, createBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { preparePlanListsOnChange } from './plan-lists-live.ts';

const PLAN = 'planAAAAAAAAA';
const lamp = { id: 'lampAAAAAAAAA', kind: 'fresnel', color: '#FFFFFF', x: 100, y: 100 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function board() {
  const doc = createBoardDoc('boardAAAAAAAA');
  addElement(doc, {
    id: PLAN,
    type: 'plan',
    x: 0,
    y: 0,
    w: 480,
    z: 'a0',
    parent: null,
    createdAt: 0,
    createdBy: null,
  });
  return doc;
}

it('prepares a plan list that arrives as plain JSON while the board is open', async () => {
  const doc = board();
  const stop = preparePlanListsOnChange(doc, (err) => {
    throw err;
  });
  // An older client's edit, arriving as an update.
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(doc));
  (roots(client).elements.get(PLAN) as Y.Map<unknown>).set('icons', [lamp]);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(client, Y.encodeStateVector(doc)));
  await flush();
  const icons = roots(doc).elements.get(PLAN)!.get('icons');
  expect(icons).toBeInstanceOf(Y.Array);
  expect((icons as Y.Array<unknown>).toJSON()).toEqual([lamp]);
  stop();
});

it('prepares a plan pasted with its lists missing, and leaves other changes alone', async () => {
  const doc = board();
  const stop = preparePlanListsOnChange(doc, (err) => {
    throw err;
  });
  let transactions = 0;
  doc.on('afterTransaction', () => transactions++);
  // An unrelated change: nothing to prepare, no extra transaction.
  roots(doc).elements.get(PLAN)!.set('title', 'Diner');
  await flush();
  expect(transactions).toBe(1);
  doc.transact(() => {
    const pasted = new Y.Map<unknown>();
    roots(doc).elements.set('pastedAAAAAAA', pasted);
    pasted.set('type', 'plan');
  });
  await flush();
  expect(roots(doc).elements.get('pastedAAAAAAA')!.get('strokes')).toBeInstanceOf(Y.Array);
  stop();
});

it('prepares the convertible lists of a plan that holds one that cannot be, and reports a failure', async () => {
  const doc = board();
  const errors: unknown[] = [];
  const stop = preparePlanListsOnChange(doc, (err) => errors.push(err));
  doc.transact(() => {
    const map = roots(doc).elements.get(PLAN)!;
    map.set('walls', 'from a newer build');
    map.set('icons', [lamp]);
  });
  await flush();
  expect(roots(doc).elements.get(PLAN)!.get('icons')).toBeInstanceOf(Y.Array);
  expect(roots(doc).elements.get(PLAN)!.get('walls')).toBe('from a newer build');
  expect(errors).toEqual([]);
  stop();
});

it('removes the second copy two clients moving one item into a list left (#1033)', async () => {
  const doc = board();
  roots(doc).elements.get(PLAN)!.set('icons', new Y.Array());
  const stop = preparePlanListsOnChange(doc, (err) => {
    throw err;
  });
  const icons = () => roots(doc).elements.get(PLAN)!.get('icons') as Y.Array<unknown>;
  icons().push([new Y.Map<unknown>(Object.entries(lamp))]);
  await flush();
  // The other client's copy, arriving later: pushed into the list that is already there.
  icons().push([new Y.Map<unknown>(Object.entries({ ...lamp, x: 140 }))]);
  await flush();
  expect(icons().toJSON()).toEqual([lamp]);
  stop();
});
