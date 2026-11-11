// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElement, readElement, roots } from './doc.ts';
import { Element, ElementId } from './elements.ts';
import { generateReferenceBoard } from './reference-board.ts';
import { checkCard } from './strict.ts';
import {
  cardFingerprint,
  encodeValidatedSnapshot,
  openValidatedSnapshot,
} from './validated-snapshot.ts';

const BUILD = { build: 'app 1.0.0 (abc1234)' };
const KEY = [0x12345678, 0x9abcdef0] as const;
const BOARD = generateReferenceBoard('small', 5).update;
const load = (update: Uint8Array = BOARD) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
};
const readsOf = (doc: Y.Doc) =>
  [...roots(doc).elements.entries()].map(
    ([key, map]) => [key, readElement(map)] as [string, Element | null],
  );
const exportOf = (doc: Y.Doc, build = BUILD) => encodeValidatedSnapshot(doc, readsOf(doc), build);
const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdBy: null, createdAt: 1 };
const stroke = (id: string) => ({
  id,
  tool: 'pencil' as const,
  color: '#202020',
  width: 3,
  points: [1, 2, 3, 4],
});

/** Takes every card of `doc` from the snapshot; undefined for the cards it does not vouch for. */
function takeAll(doc: Y.Doc, text: unknown, build = BUILD) {
  const snapshot = openValidatedSnapshot(doc, text, build);
  if (!snapshot) return null;
  return new Map(
    [...roots(doc).elements.entries()].map(([key, map]) => [key, snapshot.take(key, map)]),
  );
}

/** A card's line with its read replaced, the rest of the snapshot as written. */
function withRead(text: string, id: string, read: (element: Record<string, unknown>) => unknown) {
  return text
    .split('\n')
    .map((line) => {
      if (!line.startsWith(`${JSON.stringify(id)}\t`)) return line;
      const [key, fingerprint, json] = line.split('\t') as [string, string, string];
      return `${key}\t${fingerprint}\t${JSON.stringify(read(JSON.parse(json)))}`;
    })
    .join('\n');
}

describe('validated snapshots', () => {
  it('give back every card of the same document as this build reads it', {
    timeout: 30_000,
  }, () => {
    const text = exportOf(load());
    const doc = load();
    const taken = takeAll(doc, text)!;
    expect(taken.size).toBe(roots(doc).elements.size);
    for (const [key, map] of roots(doc).elements.entries()) {
      expect(taken.get(key)).not.toBeUndefined();
      expect(JSON.stringify(taken.get(key))).toBe(JSON.stringify(readElement(map)));
    }
  });

  it('are bound to the build: another build identity reads every card again', () => {
    const doc = new Y.Doc();
    roots(doc).meta.set('boardId', 'board-a');
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    const text = exportOf(doc);
    expect(openValidatedSnapshot(doc, text, BUILD)).not.toBeNull();
    expect(openValidatedSnapshot(doc, text, { build: 'app 1.0.1 (def5678)' })).toBeNull();
    expect(() => openValidatedSnapshot(doc, text, { build: '' })).toThrow(RangeError);
    expect(() => encodeValidatedSnapshot(doc, [], { build: 'x'.repeat(201) })).toThrow(RangeError);
  });

  it('never hand a card a newer build rejects to that build, rules behind refines included', () => {
    // An image crop past the picture's edge: only ImageCrop's refine rejects it, and refines are
    // not in the JSON schema the header hashes. Stand-in for the read of a build whose refine was
    // looser: the line holds what that build accepted.
    const doc = new Y.Doc();
    roots(doc).meta.set('boardId', 'board-a');
    addElement(doc, {
      ...base,
      id: 'image0000001',
      type: 'image',
      assetId: 'asset',
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    });
    const looser = withRead(exportOf(doc, { build: 'old' }), 'image0000001', (read) => ({
      ...read,
      crop: { x: 0.6, y: 0, w: 0.6, h: 1 },
    }));
    expect(Element.safeParse(JSON.parse(looser.split('\n')[1]!.split('\t')[2]!)).success).toBe(
      false,
    );
    // The build that wrote it would take it; this build, with its own identity, reads the card.
    expect(takeAll(doc, looser, { build: 'old' })!.get('image0000001')).toMatchObject({
      crop: { x: 0.6 },
    });
    expect(openValidatedSnapshot(doc, looser, { build: 'new' })).toBeNull();
  });

  it('read the same fingerprints from a document loaded another way', { timeout: 30_000 }, () => {
    const first = load();
    const again = load(Y.encodeStateAsUpdate(first));
    for (const [key, map] of roots(first).elements.entries())
      expect(cardFingerprint(roots(again).elements.get(key)!, KEY)).toBe(cardFingerprint(map, KEY));
  });

  it('read the same fingerprint live, reloaded or rebuilt update by update', () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    addElement(doc, { ...base, id: 'frame0000001', type: 'frame' });
    const map = roots(doc).elements.get('frame0000001')!;
    const strokes = map.get('strokes') as Y.Array<unknown>;
    for (let i = 0; i < 20; i++) strokes.push([stroke(`stroke${String(i).padStart(6, '0')}`)]);
    strokes.delete(5, 3);
    map.set('x', 3);
    const rebuilt = new Y.Doc();
    for (const update of updates) Y.applyUpdate(rebuilt, update);
    const fingerprint = cardFingerprint(map, KEY);
    const reloaded = load(Y.encodeStateAsUpdate(doc));
    expect(cardFingerprint(roots(reloaded).elements.get('frame0000001')!, KEY)).toBe(fingerprint);
    expect(cardFingerprint(roots(rebuilt).elements.get('frame0000001')!, KEY)).toBe(fingerprint);
  });

  it('read the same fingerprint when two clients added keys in either order', () => {
    const origin = new Y.Doc();
    addElement(origin, { ...base, id: 'frame0000001', type: 'frame' });
    const start = Y.encodeStateAsUpdate(origin);
    const b = load(start);
    const c = load(start);
    b.clientID = 1000;
    c.clientID = 2000;
    // Two clients add a field each to the same card, without seeing each other.
    roots(b).elements.get('frame0000001')!.set('label', '1A');
    roots(c).elements.get('frame0000001')!.set('action', 'Enters');
    const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(origin));
    const fromC = Y.encodeStateAsUpdate(c, Y.encodeStateVector(origin));
    const one = load(start);
    Y.applyUpdate(one, fromB);
    Y.applyUpdate(one, fromC);
    const two = load(start);
    Y.applyUpdate(two, fromC);
    Y.applyUpdate(two, fromB);
    const mapOne = roots(one).elements.get('frame0000001')!;
    const mapTwo = roots(two).elements.get('frame0000001')!;
    // The documents keep the keys in different orders; the fingerprint does not depend on it.
    expect([...mapOne.keys()]).not.toEqual([...mapTwo.keys()]);
    expect(cardFingerprint(mapOne, KEY)).toBe(cardFingerprint(mapTwo, KEY));
    const taken = takeAll(two, exportOf(one))!.get('frame0000001');
    expect(taken).toEqual(readElement(mapTwo));
  });

  it('never reuse a read when the writer of a field differs only above 32 bits of its id', () => {
    // Two writers whose client ids differ by exactly 2^32 write the same field at the same clock:
    // a board editor can choose such ids. The second write must not pass for the first.
    const doc = new Y.Doc();
    roots(doc).meta.set('boardId', 'board-a');
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    const write = (client: number, w: unknown) => {
      const writer = load(Y.encodeStateAsUpdate(doc));
      writer.clientID = client;
      roots(writer).elements.get('note00000001')!.set('w', w);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(writer, Y.encodeStateVector(doc)));
    };
    write(1000, 240);
    const text = exportOf(doc);
    write(1000 + 2 ** 32, 'wide');
    const map = roots(doc).elements.get('note00000001')!;
    expect(map.get('w')).toBe('wide');
    expect(readElement(map)).toBeNull();
    expect(takeAll(doc, text)!.get('note00000001')).toBeUndefined();
  });

  it('hash every bit of client ids, clocks and lengths', () => {
    // Item ids past 32 bits, as a crafted update can carry them: a stand-in for a map whose
    // only field was written by one item.
    const card = (client: number, clock: number, length = 1) =>
      ({
        _item: null,
        _map: new Map([
          ['w', { deleted: false, id: { client, clock }, length, content: {}, right: null }],
        ]),
        _start: null,
      }) as unknown as Y.Map<unknown>;
    const list = (client: number, clock: number, length = 1) =>
      ({
        _item: null,
        _map: new Map(),
        _start: { deleted: false, id: { client, clock }, length, content: {}, right: null },
      }) as unknown as Y.Map<unknown>;
    const prints = [
      list(1, 0),
      list(1 + 2 ** 32, 0),
      list(1, 2 ** 32),
      list(1, 0, 1 + 2 ** 32),
      card(1, 0),
      card(1 + 2 ** 32, 0),
      card(1 + 2 ** 40, 0),
      card(1, 2 ** 32),
      card(1, 2 ** 32 + 2 ** 33),
      card(2 ** 53 - 1, 2 ** 53 - 1),
    ].map((map) => cardFingerprint(map, KEY));
    expect(prints).not.toContain(null);
    expect(new Set(prints).size).toBe(prints.length);
    // An id that is not a safe integer gets no fingerprint: the card is never taken.
    expect(cardFingerprint(card(2 ** 53, 0), KEY)).toBeNull();
    expect(cardFingerprint(card(1, -1), KEY)).toBeNull();
  });

  it('are keyed: the same card has another fingerprint under another key', () => {
    const doc = new Y.Doc();
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    const map = roots(doc).elements.get('note00000001')!;
    expect(cardFingerprint(map, KEY)).toBe(cardFingerprint(map, [...KEY]));
    expect(cardFingerprint(map, KEY)).not.toBe(cardFingerprint(map, [KEY[0], KEY[1] + 1]));
    // Each snapshot draws its own key: two exports of the same card do not share fingerprints.
    const print = (text: string) => text.split('\n')[1]!.split('\t')[1];
    expect(print(exportOf(doc))).not.toBe(print(exportOf(doc)));
  });

  it('leave out what changed since: a field, a stroke added or erased, a new or a replaced card', () => {
    const doc = new Y.Doc();
    roots(doc).meta.set('boardId', 'board-a');
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    addElement(doc, {
      ...base,
      id: 'frame0000001',
      type: 'frame',
      strokes: [stroke('stroke000001')],
    });
    addElement(doc, {
      ...base,
      id: 'frame0000002',
      type: 'frame',
      strokes: [stroke('stroke000002')],
    });
    addElement(doc, { ...base, id: 'note00000002', type: 'note' });
    const text = exportOf(doc);
    const { elements } = roots(doc);
    elements.get('note00000001')!.set('x', 5);
    (elements.get('frame0000001')!.get('strokes') as Y.Array<unknown>).push([
      stroke('stroke000003'),
    ]);
    (elements.get('frame0000002')!.get('strokes') as Y.Array<unknown>).delete(0, 1);
    addElement(doc, { ...base, id: 'note00000003', type: 'note' });
    addElement(doc, { ...base, id: 'note00000002', type: 'note', x: 9 });
    const taken = takeAll(doc, text)!;
    expect([...taken].filter(([, el]) => el !== undefined).map(([key]) => key)).toEqual([]);
    // Undo writes the old value as a new item: the card is read again.
    const doc2 = new Y.Doc();
    roots(doc2).meta.set('boardId', 'board-a');
    addElement(doc2, { ...base, id: 'note00000001', type: 'note' });
    const undo = new Y.UndoManager(roots(doc2).elements, { captureTimeout: 0 });
    const text2 = exportOf(doc2);
    roots(doc2).elements.get('note00000001')!.set('x', 5);
    undo.undo();
    expect(takeAll(doc2, text2)!.get('note00000001')).toBeUndefined();
  });

  it('leave out a card whose cell, plan icon or redone field changed since', () => {
    const doc = new Y.Doc();
    const column = 'col00000001';
    addElement(doc, {
      ...base,
      id: 'table0000001',
      type: 'table',
      columns: [{ id: column }],
      rows: [{ id: 'row00000001', cells: { [column]: 'a' } }],
    });
    addElement(doc, {
      ...base,
      id: 'plan00000001',
      type: 'plan',
      icons: [{ id: 'icon0000001', kind: 'fresnel', color: '#FFFFFF', x: 1, y: 1 }],
    });
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    const { elements } = roots(doc);
    const note = elements.get('note00000001')!;
    const undo = new Y.UndoManager(note, { captureTimeout: 0 });
    note.set('x', 5);
    undo.undo();
    // Saved with the note back at 0, then the move is redone: same value, new items.
    const text = exportOf(doc);
    const rows = elements.get('table0000001')!.get('rows') as Y.Array<Y.Map<unknown>>;
    (rows.get(0).get('cells') as Y.Map<string>).set(column, 'b');
    const icons = elements.get('plan00000001')!.get('icons') as Y.Array<Y.Map<unknown>>;
    icons.get(0).set('label', 'Key');
    undo.redo();
    expect(elements.get('note00000001')!.get('x')).toBe(5);
    const taken = takeAll(doc, text)!;
    expect(taken.get('table0000001')).toBeUndefined();
    expect(taken.get('plan00000001')).toBeUndefined();
    expect(taken.get('note00000001')).toBeUndefined();
  });

  it('keep a card that does not validate as not validating', () => {
    const doc = new Y.Doc();
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    roots(doc).elements.get('note00000001')!.set('w', 'wide');
    const taken = takeAll(doc, exportOf(doc))!;
    expect(taken.get('note00000001')).toBeNull();
  });

  it('are ignored as a whole for another board, schema or format, and when anything is malformed', () => {
    const doc = new Y.Doc();
    roots(doc).meta.set('boardId', 'board-a');
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    addElement(doc, { ...base, id: 'note00000002', type: 'note' });
    const text = exportOf(doc);
    const other = load(Y.encodeStateAsUpdate(doc));
    roots(other).meta.set('boardId', 'board-b');
    expect(openValidatedSnapshot(other, text, BUILD)).toBeNull();
    const [head, line, second] = text.split('\n') as [string, string, string];
    const header = JSON.parse(head) as unknown[];
    const [key, fingerprint, json] = line.split('\t') as [string, string, string];
    const variants = [
      // Header: another schema, reader, format or count; a key that is not 64 bits.
      ...[
        [3, 'another-schema'],
        [1, 1],
        [0, 'another-format'],
        [6, 3],
        [5, 'xyz'],
      ].map(([i, value]) => {
        const changed = [...header];
        changed[i as number] = value;
        return [JSON.stringify(changed), line, second, ''].join('\n');
      }),
      // Lines: cut, repeated, altered fingerprint, not an element, an unknown type, a bad id.
      text.slice(0, -10),
      [head, line, line, ''].join('\n'),
      [head, `${key}\tnot-a-print\t${json}`, second, ''].join('\n'),
      [head, `${key}\t${fingerprint}\t[1,2]`, second, ''].join('\n'),
      withRead(text, 'note00000001', (read) => ({ ...read, type: 'nate' })),
      withRead(text, 'note00000001', (read) => ({ ...read, id: 'no' })),
      [head, `${key}\t${fingerprint}\t{"id":"note00000001"`, second, ''].join('\n'),
      [head, `"note00000001\t${fingerprint}\tnull`, second, ''].join('\n'),
    ];
    for (const variant of variants) expect(openValidatedSnapshot(doc, variant, BUILD)).toBeNull();
    for (const bad of [undefined, 42, '', 'garbage', '\n\n', text.slice(0, 10)])
      expect(openValidatedSnapshot(doc, bad, BUILD)).toBeNull();
    // A card is taken once.
    const snapshot = openValidatedSnapshot(doc, text, BUILD)!;
    const map = roots(doc).elements.get('note00000001')!;
    expect(snapshot.take('note00000001', map)).not.toBeUndefined();
    expect(snapshot.take('note00000001', map)).toBeUndefined();
  });

  it('check ids with the pattern of ElementId', () => {
    // validated-snapshot.ts copies it to check a line without a Zod call per card.
    const [check] = (ElementId._zod.def.checks ?? []) as unknown as Array<{
      _zod: { def: { pattern?: RegExp } };
    }>;
    expect(check?._zod.def.pattern?.source).toBe('^[A-Za-z0-9_-]{8,64}$');
  });

  it('leave out reads JSON would change, so a taken card is exactly the read', () => {
    const doc = new Y.Doc();
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    const map = roots(doc).elements.get('note00000001')!;
    const read = { ...readElement(map)!, x: -0 } as Element;
    const text = encodeValidatedSnapshot(doc, [['note00000001', read]], BUILD);
    expect(openValidatedSnapshot(doc, text, BUILD)!.take('note00000001', map)).toBeUndefined();
  });

  it('leave reads and the strict check to the stored card', () => {
    const doc = new Y.Doc();
    addElement(doc, {
      ...base,
      id: 'frame0000001',
      type: 'frame',
      strokes: [stroke('stroke000001')],
    });
    addElement(doc, { ...base, id: 'note00000001', type: 'note' });
    roots(doc).elements.get('note00000001')!.set('future', 1);
    addElement(doc, {
      ...base,
      id: 'plan00000001',
      type: 'plan',
      strokes: [stroke('stroke000002')],
    });
    (roots(doc).elements.get('plan00000001')!.get('strokes') as Y.Array<unknown>).push([
      { ...stroke('stroke000003'), tool: 'laser' },
    ]);
    const text = exportOf(doc);
    const fresh = load(Y.encodeStateAsUpdate(doc));
    const before = new Map(
      [...roots(fresh).elements.entries()].map(([key, map]) => [key, checkCard(map)]),
    );
    const doc2 = load(Y.encodeStateAsUpdate(doc));
    const taken = takeAll(doc2, text)!;
    for (const [key, map] of roots(doc2).elements.entries()) {
      expect(taken.get(key)).not.toBeUndefined();
      // A read after taking parses the stored card, and finds the same.
      expect(readElement(map)).toEqual(taken.get(key));
      expect(checkCard(map)).toEqual(before.get(key));
    }
    expect(checkCard(roots(doc2).elements.get('note00000001')!).status).toBe('foreign');
    expect(checkCard(roots(doc2).elements.get('plan00000001')!)).toMatchObject({
      status: 'foreign',
      issues: expect.arrayContaining([expect.objectContaining({ path: ['strokes', 1, 'tool'] })]),
    });
    expect(checkCard(roots(doc2).elements.get('frame0000001')!).status).toBe('known');
  });
});
