import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { admitBoardUpdate, boardUpdateFits } from './collab.ts';

const limits = { stateBytes: 64 * 1024 * 1024, elements: 20_000, maxPayload: 16 * 1024 * 1024 };
function update(doc: Y.Doc, change: () => void) {
  const vector = Y.encodeStateVector(doc);
  change();
  return Y.encodeStateAsUpdate(doc, vector);
}

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
    expect(boardUpdateFits(live, addition, limits)).toBe(false);
    const deletion = update(stored, () => {
      elements.delete('0');
      elements.delete('1');
    });
    expect(boardUpdateFits(live, deletion, limits)).toBe(true);
    Y.applyUpdate(live, deletion);
    const next = update(stored, () => elements.set('replacement', new Y.Map()));
    expect(boardUpdateFits(live, next, limits)).toBe(true);
    Y.applyUpdate(live, next);
    expect(live.getMap('elements').size).toBe(20_000);
    for (const doc of [stored, live, client]) doc.destroy();
  });

  it('refuses a crossing update without changing stored state, but always allows pure deletions', () => {
    const live = new Y.Doc();
    const client = new Y.Doc();
    const tiny = { ...limits, stateBytes: 100 };
    const addition = update(client, () => client.getMap('elements').set('large', 'x'.repeat(200)));
    expect(boardUpdateFits(live, addition, tiny)).toBe(false);
    expect(live.getMap('elements').size).toBe(0);
    Y.applyUpdate(live, addition);
    const deletion = update(client, () => client.getMap('elements').delete('large'));
    expect(boardUpdateFits(live, deletion, tiny)).toBe(true);
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
    expect(boardUpdateFits(live, unknown, limits)).toBe(false);
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
    expect(boardUpdateFits(live, second, three)).toBe(true);
    Y.applyUpdate(live, second);
    expect(live.getMap('elements').size).toBe(0);
    expect(boardUpdateFits(live, first, three)).toBe(false);
    live.destroy();
    client.destroy();
  });

  it('counts the bytes of admitted updates Yjs holds back, though they change nothing yet', () => {
    const live = new Y.Doc();
    const client = new Y.Doc();
    const small = { ...limits, stateBytes: 2_000 };
    const totals = new WeakMap<Y.Doc, number>();
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
});
