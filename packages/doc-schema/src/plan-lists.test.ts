// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElement, createBoardDoc, roots } from './doc.ts';
import { planListsState, preparePlanLists, preparePlanListsOf } from './plan-lists.ts';

const PLAN = 'planAAAAAAAAA';
function plan(doc: Y.Doc) {
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
  return roots(doc).elements.get(PLAN) as Y.Map<unknown>;
}
const stroke = {
  id: 'lineAAAAAAAAA',
  tool: 'pencil',
  color: '#1C1C1E',
  width: 4,
  points: [1, 1, 9, 9],
};
const shape = {
  id: 'boxAAAAAAAAAA',
  kind: 'rect',
  color: '#1C1C1E',
  width: 2,
  x0: 1,
  y0: 1,
  x1: 9,
  y1: 9,
};

describe('plan lists Yjs refuses', () => {
  it.each([
    ['strokes', [stroke, undefined]],
    ['shapes', [shape, 10n]],
  ] as const)(
    'a %s list with an entry Yjs refuses is left as it is, nothing thrown',
    (key, items) => {
      const doc = createBoardDoc('boardAAAAAAAA');
      const map = plan(doc);
      // A value lib0 can decode but a Y.Array refuses: set on the map as an older writer left it.
      let stored = true;
      try {
        map.set(key, items as unknown as unknown[]);
      } catch {
        stored = false;
      }
      const before = map.get(key);
      expect(() => preparePlanLists(doc)).not.toThrow();
      expect(map.get(key)).toBe(before);
      if (stored) expect(planListsState(map)).toBe('stuck');
    },
  );
});

describe('planListsState', () => {
  it('ready, pending or stuck', () => {
    const doc = createBoardDoc('boardAAAAAAAA');
    const map = plan(doc);
    expect(planListsState(map)).toBe('ready');
    map.set('icons', [{ id: 'lampAAAAAAAAA', kind: 'fresnel', color: '#FFFFFF', x: 1, y: 1 }]);
    expect(planListsState(map)).toBe('pending');
    map.set('walls', 'from a newer build');
    expect(planListsState(map)).toBe('stuck');
  });

  it('a new card is prepared in the transaction that adds it', () => {
    const doc = createBoardDoc('boardAAAAAAAA');
    let changed = 0;
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      roots(doc).elements.set(PLAN, map);
      map.set('type', 'plan');
      map.set('strokes', [stroke]);
      changed = preparePlanListsOf(map);
    });
    expect(changed).toBe(6);
    const map = roots(doc).elements.get(PLAN)!;
    expect((map.get('strokes') as Y.Array<unknown>).toJSON()).toEqual([stroke]);
    expect(planListsState(map)).toBe('ready');
  });
});
