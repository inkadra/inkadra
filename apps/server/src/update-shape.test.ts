import { addTodoItem, createElement, updateTodoItem } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { malformedUpdate, stillWritable } from './update-shape.ts';

const ID = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

/** A board with an assigned to-do item and a note with an empty text, on a client and the server. */
function board() {
  const doc = createBoardDoc(ID);
  const todo = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
  const item = addTodoItem(doc, todo, 'Permit')!;
  updateTodoItem(doc, todo, item, { assigneeId: ID });
  const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, { userId: null }).id;
  (doc.getMap('elements').get(note) as Y.Map<unknown>).set('label', new Y.Text());
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
  const card = (d: Y.Doc, key: string) => d.getMap('elements').get(key) as Y.Map<unknown>;
  const labelOf = (d: Y.Doc) => card(d, note).get('label') as Y.Text;
  const other = () => {
    const c = new Y.Doc();
    Y.applyUpdate(c, Y.encodeStateAsUpdate(server));
    return c;
  };
  const at = (d: Y.Doc, change: () => void) => {
    const sv = Y.encodeStateVector(d);
    change();
    return Y.encodeStateAsUpdate(d, sv);
  };
  /** As collab.ts does: a refused update never reaches the board. */
  const send = (update: Uint8Array) => {
    const reason = malformedUpdate(server, update);
    if (!reason) Y.applyUpdate(server, update);
    return reason;
  };
  return { doc, server, todo, item, note, card, labelOf, other, at, send };
}

const content = (doc: Y.Doc) =>
  JSON.stringify({ elements: doc.getMap('elements').toJSON(), meta: doc.getMap('meta').toJSON() });

type ItemSpec = {
  origin?: Y.ID;
  rightOrigin?: Y.ID;
  parent?: string | Y.ID;
  key?: string;
  content:
    | { any: Array<string | null> }
    | { skip: number; info: number }
    | { doc: string; guid: number | null };
};

/**
 * An update encoded by hand: Yjs's API never writes an item or a deletion of no length, an item
 * naming a later clock of its own client, or a Skip with extra bits.
 */
function encodeUpdate(
  blocks: Array<{ client: number; clock: number; structs: ItemSpec[] }>,
  deletions: Array<{ client: number; clock: number; len: number }> = [],
) {
  const bytes: number[] = [];
  const varUint = (n: number) => {
    while (n > 0x7f) {
      bytes.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    bytes.push(n);
  };
  const string = (s: string) => {
    const utf8 = new TextEncoder().encode(s);
    varUint(utf8.length);
    bytes.push(...utf8);
  };
  varUint(blocks.length);
  for (const block of blocks) {
    for (const n of [block.structs.length, block.client, block.clock]) varUint(n);
    for (const item of block.structs) {
      if ('skip' in item.content) {
        bytes.push(item.content.info);
        varUint(item.content.skip);
        continue;
      }
      const hasParent = !item.origin && !item.rightOrigin;
      bytes.push(
        ('doc' in item.content ? 9 : 8) |
          (item.origin ? 0x80 : 0) |
          (item.rightOrigin ? 0x40 : 0) |
          (hasParent && item.key ? 0x20 : 0),
      );
      for (const id of [item.origin, item.rightOrigin])
        if (id) {
          varUint(id.client);
          varUint(id.clock);
        }
      if (hasParent && typeof item.parent === 'string') {
        varUint(1);
        string(item.parent);
      } else if (hasParent && typeof item.parent === 'object') {
        varUint(0);
        varUint(item.parent.client);
        varUint(item.parent.clock);
      }
      if (hasParent && item.key) string(item.key);
      if ('doc' in item.content) {
        // A subdocument: its guid, then options (lib0's writeAny object: 118, one key, 125 int).
        string(item.content.doc);
        bytes.push(118);
        varUint(1);
        string('guid');
        if (item.content.guid === null) bytes.push(126);
        else bytes.push(125, item.content.guid);
        continue;
      }
      varUint(item.content.any.length);
      // lib0's writeAny: 126 for null, 119 then the string.
      for (const v of item.content.any)
        if (v === null) bytes.push(126);
        else {
          bytes.push(119);
          string(v);
        }
    }
  }
  varUint(deletions.length);
  for (const { client, clock, len } of deletions)
    for (const n of [client, 1, clock, len]) varUint(n);
  return new Uint8Array(bytes);
}

describe('updates refused before they reach the board', () => {
  it('refuses each shape that would break the board, which stays as it was', () => {
    const b = board();
    const own = b.server.clientID;
    const next = Y.getState(b.server.store, own);
    const item = (b.card(b.server, b.todo).get('items') as Y.Array<Y.Map<unknown>>).get(0)._item!;
    const cases: Record<string, [Uint8Array, string]> = {
      'a Skip with extra bits, which only applyUpdate reads': [
        encodeUpdate([
          { client: 999, clock: 0, structs: [{ content: { skip: 1, info: 0x2a } }] },
          {
            client: 555,
            clock: 0,
            structs: [{ parent: 'decoy', key: 'x', content: { any: ['a'] } }],
          },
        ]),
        'undecodable',
      ],
      'an item of no length': [
        encodeUpdate([
          {
            client: 555,
            clock: 0,
            structs: [
              { parent: 'decoy', key: 'x', content: { any: ['a'] } },
              { origin: Y.createID(555, 0), content: { any: [] } },
            ],
          },
        ]),
        'empty struct',
      ],
      'a deletion of no length': [encodeUpdate([], [{ ...item.id, len: 0 }]), 'empty deletion'],
      'an item naming a later clock of its own client': [
        encodeUpdate([
          {
            client: 777,
            clock: 0,
            structs: [
              { origin: Y.createID(777, 1), content: { any: ['a'] } },
              { parent: 'decoy', key: 'x', content: { any: ['b'] } },
            ],
          },
        ]),
        'self reference',
      ],
      'an item naming its own clock as parent': [
        encodeUpdate([
          {
            client: 777,
            clock: 0,
            structs: [{ parent: Y.createID(777, 0), content: { any: ['a'] } }],
          },
        ]),
        'self reference',
      ],
      'a new item under the board’s own client id': [
        encodeUpdate([
          {
            client: own,
            clock: next,
            structs: [{ parent: 'decoy', key: 'x', content: { any: ['a'] } }],
          },
        ]),
        'server client id',
      ],
      'a deletion of clocks the board’s own client id has not written yet': [
        encodeUpdate([], [{ client: own, clock: next, len: 1 }]),
        'server client id',
      ],
      'an item naming a later clock of its own client as right origin': [
        encodeUpdate([
          {
            client: 777,
            clock: 0,
            structs: [
              { rightOrigin: Y.createID(777, 1), content: { any: ['a'] } },
              { parent: 'decoy', key: 'x', content: { any: ['b'] } },
            ],
          },
        ]),
        'self reference',
      ],
      'a subdocument whose guid is not a string': [
        encodeUpdate([
          {
            client: 555,
            clock: 0,
            structs: [{ parent: 'decoy', key: 'x', content: { doc: 'sub', guid: 5 } }],
          },
        ]),
        'subdocument guid',
      ],
      'a deletion past the safe integers': [
        encodeUpdate([], [{ client: 555, clock: 2 ** 53, len: 1 }]),
        'unsafe clock',
      ],
      'a struct past the safe integers': [
        encodeUpdate([
          {
            client: 555,
            clock: 2 ** 53,
            structs: [{ parent: 'decoy', key: 'x', content: { any: ['a'] } }],
          },
        ]),
        'unsafe clock',
      ],
      'deletions of one client out of order': [
        encodeUpdate(
          [],
          [
            { client: 555, clock: 5, len: 1 },
            { client: 555, clock: 2, len: 1 },
          ],
        ),
        'unsorted deletions',
      ],
      'deletions of one client that overlap': [
        encodeUpdate(
          [],
          [
            { client: 555, clock: 2, len: 3 },
            { client: 555, clock: 3, len: 1 },
          ],
        ),
        'unsorted deletions',
      ],
    };
    for (const [name, [update, reason]] of Object.entries(cases)) {
      const before = content(b.server);
      expect(b.send(update), name).toBe(reason);
      expect(content(b.server), name).toBe(before);
      expect(() => Y.encodeStateAsUpdate(b.server), name).not.toThrow();
    }
  });

  it('refuses an item overlapping held clocks after a collected one, unless its parent is gone too', () => {
    const b = board();
    const typist = b.other();
    typist.clientID = 555;
    // The guest's first letter, then the note deleted: Yjs collects the letter.
    const first = b.at(typist, () => b.labelOf(typist).insert(0, 'a'));
    b.labelOf(typist).insert(1, 'b');
    const both = Y.encodeStateAsUpdate(typist, Y.encodeStateVector(b.server));
    expect(b.send(first)).toBeNull();
    expect(b.send(b.at(b.doc, () => b.doc.getMap('elements').delete(b.note)))).toBeNull();
    expect(Y.getItem(b.server.store, Y.createID(555, 0))).toBeInstanceOf(Y.GC);
    // One naming a live parent: Yjs fails halfway through applying it.
    const forged = encodeUpdate([
      {
        client: 555,
        clock: 0,
        structs: [{ parent: 'decoy', key: 'x', content: { any: [null, 'b'] } }],
      },
    ]);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(b.server));
    expect(() => Y.applyUpdate(copy, forged)).toThrow();
    expect(b.send(forged)).toBe('overlaps a collected struct');
    // A real resend of both letters names the text, which is gone too: Yjs collects the rest.
    expect(b.send(both)).toBeNull();
    expect(() => Y.encodeStateAsUpdate(b.server)).not.toThrow();
  });

  it('shows why: applied, these break the board', () => {
    // An item of no length: no later encoding of the board succeeds.
    const empty = new Y.Doc();
    try {
      Y.applyUpdate(
        empty,
        encodeUpdate([
          {
            client: 555,
            clock: 0,
            structs: [
              { parent: 'decoy', key: 'x', content: { any: ['a'] } },
              { origin: Y.createID(555, 0), content: { any: [] } },
            ],
          },
        ]),
      );
    } catch {}
    expect(() => Y.encodeStateAsUpdate(empty)).toThrow();
    // A subdocument whose guid is not a string (null here): no later encoding succeeds.
    const sub = new Y.Doc();
    Y.applyUpdate(
      sub,
      encodeUpdate([
        {
          client: 555,
          clock: 0,
          structs: [{ parent: 'decoy', key: 'x', content: { doc: 'sub', guid: null } }],
        },
      ]),
    );
    expect(() => Y.encodeStateAsUpdate(sub)).toThrow();
    // A deletion past the safe integers: applying fails halfway through.
    const far = new Y.Doc();
    expect(() =>
      Y.applyUpdate(far, encodeUpdate([], [{ client: 555, clock: 2 ** 53, len: 1 }])),
    ).toThrow();
    // A later clock of its own client: applying fails halfway through.
    const selfRef = new Y.Doc();
    expect(() =>
      Y.applyUpdate(
        selfRef,
        encodeUpdate([
          {
            client: 777,
            clock: 0,
            structs: [
              { origin: Y.createID(777, 1), content: { any: ['a'] } },
              { parent: 'decoy', key: 'x', content: { any: ['b'] } },
            ],
          },
        ]),
      ),
    ).toThrow();
  });
});

describe('what real clients send', () => {
  it('lets an offline session through, sent again from an older state', () => {
    const b = board();
    const sv = Y.encodeStateVector(b.doc);
    const first = b.at(b.doc, () => b.labelOf(b.doc).insert(0, 'Hel'));
    for (const letter of 'lo there') b.labelOf(b.doc).insert(b.labelOf(b.doc).length, letter);
    updateTodoItem(b.doc, b.todo, b.item, { dueDate: '2026-12-01' });
    expect(b.send(first)).toBeNull();
    b.doc.getMap('elements').delete(b.note);
    expect(b.send(Y.encodeStateAsUpdate(b.doc, sv))).toBeNull();
    expect(content(b.server)).toBe(content(b.doc));
  });

  it('lets through a resync that repeats what the board holds, its own writes included', () => {
    const b = board();
    const sv = Y.encodeStateVector(b.doc);
    const first = b.at(b.doc, () => b.labelOf(b.doc).insert(0, 'a'));
    b.labelOf(b.doc).insert(1, 'b');
    expect(b.send(first)).toBeNull();
    // The server writes; the client hears it before it resyncs from its older state.
    b.server.transact(() => b.card(b.server, b.todo).set('x', 99));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(b.server));
    expect(b.send(Y.encodeStateAsUpdate(b.doc, sv))).toBeNull();
    expect(content(b.server)).toBe(content(b.doc));
  });

  it('lets letters through that arrive out of order after their card was deleted', () => {
    const b = board();
    const c = b.other();
    const letters = ['a', 'b', 'c'].map((l, i) => b.at(c, () => b.labelOf(c).insert(i, l)));
    expect(b.send(letters[1]!)).toBeNull();
    expect(b.send(letters[2]!)).toBeNull();
    expect(b.server.store.pendingStructs).not.toBeNull();
    expect(b.send(b.at(b.doc, () => b.doc.getMap('elements').delete(b.note)))).toBeNull();
    expect(b.send(letters[0]!)).toBeNull();
    expect(b.server.store.pendingStructs).toBeNull();
  });

  it('lets rich text, undo and redo, a large paste and two people at once through', () => {
    const b = board();
    const body = new Y.XmlFragment();
    expect(b.send(b.at(b.doc, () => b.card(b.doc, b.note).set('body', body)))).toBeNull();
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    expect(
      b.send(
        b.at(b.doc, () => {
          body.insert(0, [paragraph]);
          paragraph.insert(0, [text]);
          text.insert(0, 'Bold and plain');
          text.format(0, 4, { bold: true });
        }),
      ),
    ).toBeNull();
    const undo = new Y.UndoManager(b.card(b.doc, b.note));
    for (const step of [
      () => b.card(b.doc, b.note).set('x', 120),
      () => undo.undo(),
      () => undo.redo(),
    ])
      expect(b.send(b.at(b.doc, step))).toBeNull();
    expect(b.send(b.at(b.doc, () => b.labelOf(b.doc).insert(0, 'x'.repeat(200_000))))).toBeNull();
    const [one, two] = [b.other(), b.other()];
    const fromOne = b.at(one, () => b.labelOf(one).insert(0, 'one'));
    const fromTwo = b.at(two, () => updateTodoItem(two, b.todo, b.item, { done: true }));
    expect(b.send(fromOne)).toBeNull();
    expect(b.send(fromTwo)).toBeNull();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(b.server));
    expect(content(b.server)).toBe(content(b.doc));
  });
});

describe('after an await', () => {
  it('lets a connection write only if it is still writable, open and on a loaded board', () => {
    const open = { readOnly: false, connected: true, socketState: 1, documentDestroyed: false };
    expect(stillWritable(open)).toBe(true);
    expect(stillWritable({ ...open, readOnly: true })).toBe(false);
    expect(stillWritable({ ...open, connected: false })).toBe(false);
    expect(stillWritable({ ...open, socketState: 2 })).toBe(false);
    expect(stillWritable({ ...open, socketState: 3 })).toBe(false);
    expect(stillWritable({ ...open, documentDestroyed: true })).toBe(false);
  });
});
