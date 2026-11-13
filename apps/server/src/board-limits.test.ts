import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { boardUpdateFits } from './collab.ts';

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
    stored.transact(() => { for (let i = 0; i <= limits.elements; i++) elements.set(String(i), new Y.Map()); });
    const live = new Y.Doc();
    Y.applyUpdate(live, Y.encodeStateAsUpdate(stored));
    expect(live.getMap('elements').size).toBe(20_001);
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(live));
    const addition = update(client, () => client.getMap('elements').set('extra', new Y.Map()));
    expect(boardUpdateFits(live, addition, limits)).toBe(false);
    const deletion = update(stored, () => { elements.delete('0'); elements.delete('1'); });
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
    live.destroy(); client.destroy();
  });
});
