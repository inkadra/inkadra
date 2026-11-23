import { addElement, createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { preparePlanLists } from './plan-lists.ts';

const BOARD = 'boardAAAAAAAA';
const PLAN = 'planAAAAAAAAA';

function plan(doc: Y.Doc, id = PLAN) {
  addElement(doc, {
    id,
    type: 'plan',
    x: 0,
    y: 0,
    w: 480,
    z: 'a0',
    parent: null,
    createdAt: 0,
    createdBy: null,
  });
  return roots(doc).elements.get(id) as Y.Map<unknown>;
}

const legacy = {
  icons: [{ id: 'lampAAAAAAAAA', kind: 'fresnel', color: '#FFFFFF', x: 100, y: 100 }],
  walls: [{ id: 'wallAAAAAAAAA', points: [0, 0, 1000, 0], thickness: 15 }],
  openings: [{ id: 'doorAAAAAAAAA', wall: 'wallAAAAAAAAA', kind: 'door', at: 200, width: 90 }],
  circuits: [{ id: 'circAAAAAAAAA', name: 'A', amps: 16 }],
  strokes: [
    { id: 'lineAAAAAAAAA', tool: 'pencil', color: '#1C1C1E', width: 4, points: [1, 1, 9, 9] },
  ],
  shapes: [
    {
      id: 'textAAAAAAAAA',
      kind: 'text',
      color: '#1C1C1E',
      width: 2,
      x0: 1,
      y0: 1,
      x1: 9,
      y1: 9,
      text: 'Exit',
    },
  ],
} as const;

describe('preparePlanLists', () => {
  it.each(Object.keys(legacy) as Array<keyof typeof legacy>)(
    'turns a plain JSON %s list into a Y.Array, every item kept',
    (key) => {
      const doc = createBoardDoc(BOARD);
      const map = plan(doc);
      map.set(key, legacy[key]);
      expect(preparePlanLists(doc)).toBe(1);
      const list = map.get(key) as Y.Array<unknown>;
      expect(list).toBeInstanceOf(Y.Array);
      expect(list.toJSON()).toEqual(legacy[key]);
      const maps = ['icons', 'walls', 'openings', 'circuits'].includes(key);
      expect(list.toArray().every((i) => i instanceof Y.Map === maps)).toBe(true);
    },
  );

  it('makes the missing lists of a plan, in one transaction', () => {
    const doc = createBoardDoc(BOARD);
    const map = plan(doc);
    for (const key of Object.keys(legacy)) map.delete(key);
    let transactions = 0;
    doc.on('afterTransaction', () => transactions++);
    expect(preparePlanLists(doc)).toBe(6);
    expect(transactions).toBe(1);
    for (const key of Object.keys(legacy)) expect(map.get(key)).toBeInstanceOf(Y.Array);
  });

  it('leaves a board already in shape untouched, and converts only once', () => {
    const doc = createBoardDoc(BOARD);
    const map = plan(doc);
    map.set('icons', legacy.icons);
    expect(preparePlanLists(doc)).toBe(1);
    const icons = map.get('icons');
    let updates = 0;
    doc.on('update', () => updates++);
    expect(preparePlanLists(doc)).toBe(0);
    expect(updates).toBe(0);
    expect(map.get('icons')).toBe(icons);
  });

  it('keeps a value that is no list for a newer build, and touches no other card', () => {
    const doc = createBoardDoc(BOARD);
    const map = plan(doc);
    map.set('shapes', 'from a newer build');
    expect(preparePlanLists(doc)).toBe(0);
    expect(map.get('shapes')).toBe('from a newer build');
  });

  it('what the server serves converges: a client that syncs afterwards edits the same list', () => {
    const server = createBoardDoc(BOARD);
    plan(server).set('icons', legacy.icons);
    preparePlanLists(server);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(server));
    const add = (d: Y.Doc, id: string) =>
      (roots(d).elements.get(PLAN)!.get('icons') as Y.Array<unknown>).push([
        new Y.Map(Object.entries({ id, kind: 'chair', color: '#1C1C1E', x: 1, y: 1 })),
      ]);
    add(a, 'chairAAAAAAAA');
    add(b, 'chairBBBBBBBB');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ids = (d: Y.Doc) =>
      (roots(d).elements.get(PLAN)!.get('icons') as Y.Array<Y.Map<unknown>>)
        .toArray()
        .map((m) => m.get('id'));
    expect(ids(a).sort()).toEqual(['chairAAAAAAAA', 'chairBBBBBBBB', 'lampAAAAAAAAA']);
    expect(ids(b)).toEqual(ids(a));
  });
});
