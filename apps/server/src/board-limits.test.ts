import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { admitBoardUpdate, type BoardSize } from './collab.ts';

const limits = { stateBytes: 64 * 1024 * 1024, elements: 20_000, maxPayload: 16 * 1024 * 1024 };
function update(doc: Y.Doc, change: () => void) {
  const vector = Y.encodeStateVector(doc);
  change();
  return Y.encodeStateAsUpdate(doc, vector);
}
/** Admission of one update, the board's size measured afresh. */
const admit = (doc: Y.Doc, update: Uint8Array, caps = limits) =>
  admitBoardUpdate(doc, update, caps, new WeakMap());

describe('board update admission', () => {
  it('keeps a previously oversized board readable and accepts deletions until it fits', () => {
    const stored = new Y.Doc();
    const elements = stored.getMap('elements');
    stored.transact(() => {
      for (let i = 0; i <= limits.elements; i++) elements.set(String(i), new Y.Map());
    });
    const live = new Y.Doc();
    Y.applyUpdate(live, Y.encodeStateAsUpdate(stored));
    expect(live.getMap('elements').size).toBe(20_001);
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(live));
    const addition = update(client, () => client.getMap('elements').set('extra', new Y.Map()));
    expect(admit(live, addition, limits)).toBe(false);
    const deletion = update(stored, () => {
      elements.delete('0');
      elements.delete('1');
    });
    expect(admit(live, deletion, limits)).toBe(true);
    Y.applyUpdate(live, deletion);
    const next = update(stored, () => elements.set('replacement', new Y.Map()));
    expect(admit(live, next, limits)).toBe(true);
    Y.applyUpdate(live, next);
    expect(live.getMap('elements').size).toBe(20_000);
    for (const doc of [stored, live, client]) doc.destroy();
  });

  it('refuses a crossing update without changing stored state, but always allows pure deletions', () => {
    const live = new Y.Doc();
    const client = new Y.Doc();
    const tiny = { ...limits, stateBytes: 100 };
    const addition = update(client, () => client.getMap('elements').set('large', 'x'.repeat(200)));
    expect(admit(live, addition, tiny)).toBe(false);
    expect(live.getMap('elements').size).toBe(0);
    Y.applyUpdate(live, addition);
    const deletion = update(client, () => client.getMap('elements').delete('large'));
    expect(admit(live, deletion, tiny)).toBe(true);
    live.destroy();
    client.destroy();
  });

  it('refuses a deletion of items the board does not hold, which nothing would measure', () => {
    const live = new Y.Doc();
    const other = new Y.Doc();
    other.getMap('elements').set('ghost', 'x'.repeat(50));
    other.getMap('elements').delete('ghost');
    // Only the deletion, of an item the board never received.
    const unknown = Y.encodeStateAsUpdate(other, Y.encodeStateVector(other));
    expect(Y.decodeUpdate(unknown).structs).toHaveLength(0);
    expect(admit(live, unknown, limits)).toBe(false);
    live.destroy();
    other.destroy();
  });

  it('counts the elements Yjs holds back until the items they follow arrive', () => {
    const live = new Y.Doc();
    const client = new Y.Doc();
    const three = { ...limits, elements: 3 };
    const add = (from: number) =>
      update(client, () => {
        for (let i = from; i < from + 3; i++) client.getMap('elements').set(String(i), new Y.Map());
      });
    const first = add(0);
    const second = add(3);
    // Sent out of order, the second waits for the first.
    expect(admit(live, second, three)).toBe(true);
    Y.applyUpdate(live, second);
    expect(live.getMap('elements').size).toBe(0);
    expect(admit(live, first, three)).toBe(false);
    live.destroy();
    client.destroy();
  });

  it('counts the bytes of admitted updates Yjs holds back, though they change nothing yet', () => {
    const live = new Y.Doc();
    const client = new Y.Doc();
    const small = { ...limits, stateBytes: 2_000 };
    const totals = new WeakMap<Y.Doc, BoardSize>();
    update(client, () => client.getMap('elements').set('first', 'x'));
    let admitted = 0;
    for (let i = 0; i < 10; i++) {
      // Each depends on the one never sent, so Yjs keeps it waiting.
      const later = update(client, () => client.getMap('elements').set(`n${i}`, 'x'.repeat(400)));
      if (!admitBoardUpdate(live, later, small, totals)) break;
      Y.applyUpdate(live, later);
      admitted++;
    }
    expect(live.getMap('elements').size).toBe(0);
    expect(admitted).toBeLessThan(10);
    expect(Y.encodeStateAsUpdate(live).byteLength).toBeLessThanOrEqual(small.stateBytes);
    live.destroy();
    client.destroy();
  });

  it('counts what a stream of additions with unknown deletions keeps waiting, up to the cap', () => {
    const live = new Y.Doc();
    const client = new Y.Doc();
    const small = { ...limits, stateBytes: 4_000 };
    const sizes = new WeakMap<Y.Doc, BoardSize>();
    let admitted = 0;
    for (let i = 0; i < 40; i++) {
      // Deletions of items the board never received: Yjs keeps them waiting, stored with it.
      const ghost = new Y.Doc();
      const text = ghost.getText('t');
      text.insert(0, 'x'.repeat(200));
      for (let at = 199; at > 0; at -= 2) text.delete(at, 1);
      const deletions = Y.encodeStateAsUpdate(ghost, Y.encodeStateVector(ghost));
      ghost.destroy();
      const addition = update(client, () => client.getMap('meta').set(`k${i}`, i));
      const mixed = Y.mergeUpdates([addition, deletions]);
      if (!admitBoardUpdate(live, mixed, small, sizes)) break;
      Y.applyUpdate(live, mixed);
      admitted++;
    }
    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThan(40);
    expect(live.store.pendingDs).not.toBeNull();
    expect(Y.encodeStateAsUpdate(live).byteLength).toBeLessThanOrEqual(small.stateBytes);
    live.destroy();
    client.destroy();
  });

  it('reuses the measured size: refused additions do not measure the board again', () => {
    const live = new Y.Doc();
    const client = new Y.Doc();
    const addition = update(client, () => client.getMap('elements').set('a', 'x'));
    // A measured size at the cap, though the board is empty: trusted until something changes.
    const sizes = new WeakMap<Y.Doc, BoardSize>([[live, { bytes: 1_000, exact: true }]]);
    const capped = { ...limits, stateBytes: 1_000 };
    expect(admitBoardUpdate(live, addition, capped, sizes)).toBe(false);
    expect(admitBoardUpdate(live, addition, capped, sizes)).toBe(false);
    expect(sizes.get(live)).toEqual({ bytes: 1_000, exact: true });
    // A bound, not a measure: past the cap, the board is measured for real.
    sizes.set(live, { bytes: 1_000, exact: false });
    expect(admitBoardUpdate(live, addition, capped, sizes)).toBe(true);
    expect(sizes.get(live)?.exact).toBe(false);
    live.destroy();
    client.destroy();
  });

  it('at the card cap, counts only new cards: edits inside cards and replacements pass', () => {
    const live = new Y.Doc();
    const client = new Y.Doc();
    const three = { ...limits, elements: 3 };
    const elements = client.getMap<Y.Map<unknown>>('elements');
    const setup = update(client, () => {
      for (const id of ['a', 'b', 'c']) {
        const card = new Y.Map<unknown>();
        elements.set(id, card);
        card.set('text', new Y.Text('note'));
      }
    });
    expect(admit(live, setup, three)).toBe(true);
    Y.applyUpdate(live, setup);
    const text = () => elements.get('a')?.get('text') as Y.Text;
    const edits = [
      update(client, () => text().insert(2, 'y'.repeat(5_000))),
      update(client, () => {
        elements.get('b')?.set('x', 10);
        text().insert(0, 'a');
        text().insert(text().length, 'z');
      }),
      // A card replaced under its own key.
      update(client, () => elements.set('c', new Y.Map())),
      // One card deleted and another added in the same update.
      update(client, () => {
        elements.delete('b');
        elements.set('d', new Y.Map());
      }),
    ];
    for (const edit of edits) {
      expect(admit(live, edit, three)).toBe(true);
      Y.applyUpdate(live, edit);
    }
    expect(live.getMap('elements').size).toBe(3);
    // A deleted key set again is a new card.
    const again = update(client, () => elements.set('b', new Y.Map()));
    expect(admit(live, again, three)).toBe(false);
    live.destroy();
    client.destroy();
  });
});
