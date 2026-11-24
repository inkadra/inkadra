import {
  addElement,
  createBoardDoc,
  preparePlanLists,
  readElement,
  roots,
} from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { writeVersionOver } from './versions.ts';

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

  it('drops nothing: odd entries stay, a list that cannot be promoted stays as it is', () => {
    const doc = createBoardDoc(BOARD);
    const map = plan(doc);
    // Strokes: an entry that does not read stays where it is, in the new Y.Array.
    const strokes = [legacy.strokes[0], null, 7, [1, 2]];
    map.set('strokes', strokes);
    // Icons: an entry that is no object cannot become a Y.Map: the list is left as it is.
    const icons = [legacy.icons[0], null];
    map.set('icons', icons);
    const before = Y.encodeStateAsUpdate(doc);
    expect(preparePlanLists(doc)).toBe(1);
    expect((map.get('strokes') as Y.Array<unknown>).toJSON()).toEqual(strokes);
    expect(map.get('icons')).toEqual(icons);
    // What a client reads of the plan is the same, through an encoded round trip.
    const read = (update: Uint8Array) => {
      const d = new Y.Doc();
      Y.applyUpdate(d, update);
      return readElement(roots(d).elements.get(PLAN)!);
    };
    expect(read(Y.encodeStateAsUpdate(doc))).toEqual(read(before));
  });

  it('a value Yjs would refuse in a Y.Map leaves that list as it is, the board still served', () => {
    const doc = createBoardDoc(BOARD);
    const map = plan(doc);
    // A value Yjs cannot put in a Y.Map (here a function: the scratch try in preparePlanLists).
    const odd = { ...legacy.icons[0], hook: () => 1 };
    map.set('icons', [odd]);
    expect(() => preparePlanLists(doc)).not.toThrow();
    expect(Array.isArray(map.get('icons'))).toBe(true);
  });

  it('an identical version restored over the prepared board changes nothing', () => {
    const live = createBoardDoc(BOARD);
    plan(live).set('icons', legacy.icons);
    const saved = Y.encodeStateAsUpdate(live);
    preparePlanLists(live);
    const icons = roots(live).elements.get(PLAN)!.get('icons');
    const version = new Y.Doc();
    Y.applyUpdate(version, saved);
    preparePlanLists(version);
    expect(writeVersionOver(live, version)).toBeNull();
    expect(roots(live).elements.get(PLAN)!.get('icons')).toBe(icons);
  });

  it('a large plan: bounded growth and time', () => {
    const doc = createBoardDoc(BOARD);
    const map = plan(doc);
    map.set(
      'icons',
      Array.from({ length: 300 }, (_, i) => ({
        ...legacy.icons[0],
        id: `lamp${String(i).padStart(9, 'A')}`,
      })),
    );
    map.set(
      'strokes',
      Array.from({ length: 2000 }, (_, i) => ({
        ...legacy.strokes[0],
        id: `line${String(i).padStart(9, 'A')}`,
      })),
    );
    const before = Y.encodeStateAsUpdate(doc).byteLength;
    const started = performance.now();
    preparePlanLists(doc);
    const took = performance.now() - started;
    const after = Y.encodeStateAsUpdate(doc).byteLength;
    // The converted lists are written next to the old values Yjs keeps as deleted: at most about
    // twice the plan's lists. Measured here so a change in that cost is seen.
    expect(after).toBeLessThan(before * 2.5);
    expect(took).toBeLessThan(2000);
  });
});
