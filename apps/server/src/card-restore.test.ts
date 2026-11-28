import { type Connection, Document } from '@hocuspocus/server';
import {
  type ClipboardData,
  copyElements,
  createElement,
  deleteElements,
  listElements,
  restoreElements,
} from '@inkadra/canvas-core';
import {
  createBoardDoc,
  type RestoreCardsResult,
  type RestoreRefusal,
  roots,
} from '@inkadra/doc-schema';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCardRestore } from './card-restore.ts';
import type { Database } from './db/client.ts';
import { AssignmentRefusedError, validateTaskUpdate } from './tasks.ts';

vi.mock('./tasks.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tasks.ts')>();
  return { ...actual, validateTaskUpdate: vi.fn(actual.validateTaskUpdate) };
});

const requestId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a12';
const otherId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
const at = { x: 500, y: 300 };
const opts = { userId: 'u1' };
const message = (clipboard: unknown, id = requestId) =>
  JSON.stringify({ type: 'restoreCards', requestId: id, clipboard, at });
const empty = { version: 1, elements: [], bodies: {} };

/**
 * The database the handler reads (the moved-cards query, then the task check's role) as a stub:
 * `during` runs while a query is pending, as a write that lands on the board during the await.
 */
function stubDb(during: () => void | Promise<void> = () => {}) {
  let calls = 0;
  const query = {
    from: () => query,
    where: () => query,
    innerJoin: () => query,
    leftJoin: () => query,
    limit: async () => {
      calls += 1;
      await during();
      return [];
    },
  };
  return { db: { select: () => query } as unknown as Database, calls: () => calls };
}

function setup(
  options: {
    db?: Database;
    refusal?: () => RestoreRefusal | null;
    timeoutMs?: number;
    actor?: string;
  } = {},
) {
  const sent: RestoreCardsResult[] = [];
  const admitted: Uint8Array[] = [];
  const document = new Document('board');
  Y.applyUpdate(document, Y.encodeStateAsUpdate(createBoardDoc(boardId)));
  const connect = (actor = options.actor ?? 'u1') => {
    const connection = {
      context: { actor: { id: actor, role: 'member' }, boardId: 'b1' },
      webSocket: { readyState: 1 },
      messageAddress: 'board',
      send: () => {},
      sendStateless: (payload: string) => sent.push(JSON.parse(payload)),
    } as unknown as Connection;
    document.addConnection(connection);
    return connection;
  };
  const connection = connect();
  const restorer = createCardRestore({
    db: options.db ?? stubDb().db,
    log: pino({ level: 'silent' }),
    refusal: options.refusal ?? (() => null),
    admit: (_, update) => {
      admitted.push(update);
      return null;
    },
    writersOf: () => new Map(),
    timeoutMs: options.timeoutMs,
  });
  const ask = (clipboard: unknown, id = requestId, on = connection) =>
    restorer.handle(on, document, message(clipboard, id));
  return { sent, admitted, connection, connect, document, restorer, ask };
}

/** A column with a note, and a free note, on `doc`; copied and then deleted. */
function deletedCards(doc: Y.Doc) {
  const column = createElement(doc, 'column', { x: 0, y: 0 }, { title: 'Refs' }, opts).id;
  const inside = createElement(doc, 'note', { x: 0, y: 0 }, { parent: column }, opts).id;
  const free = createElement(doc, 'note', { x: 40, y: 50 }, {}, opts).id;
  const copy: ClipboardData = JSON.parse(JSON.stringify(copyElements(doc, [column, free])));
  deleteElements(doc, [column, free]);
  return { column, inside, free, copy, ids: [column, inside, free] };
}

const live = (doc: Y.Doc, ids: string[]) => ids.filter((id) => roots(doc).elements.has(id));

describe('conditional restore requests', () => {
  it('leaves other stateless messages to others', () => {
    const { restorer, connection, document, sent } = setup();
    expect(restorer.handle(connection, document, '{"type":"other"}')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('answers an error inside the handler `busy`, without rejecting', async () => {
    const { ask, sent } = setup({
      refusal: () => {
        throw new Error('boom');
      },
    });
    await expect(ask(empty)).resolves.toBeUndefined();
    expect(sent).toEqual([
      { type: 'restoreCardsResult', requestId, outcome: 'refused', reason: 'busy' },
    ]);
  });

  it('answers a malformed request whose id it can read, and only that one', async () => {
    const { restorer, connection, document, sent } = setup();
    await restorer.handle(connection, document, '{"type":"restoreCards","requestId":"x"}');
    await restorer.handle(
      connection,
      document,
      `{"type":"restoreCards","requestId":"${requestId}"}`,
    );
    expect(sent).toEqual([
      { type: 'restoreCardsResult', requestId, outcome: 'refused', reason: 'invalid' },
    ]);
  });

  it('answers `busy` past the requests one person may send for a board in a minute', async () => {
    const { ask, connect, sent } = setup({ refusal: () => 'role' });
    // Over two connections of the same person: the limit is theirs, not the socket's.
    const second = connect();
    for (let i = 0; i < 30; i++) await ask(empty, requestId, i % 2 ? second : undefined);
    await ask(empty, requestId, second);
    const reasons = sent.map((a) => (a.outcome === 'refused' ? a.reason : a.outcome));
    expect(reasons.slice(0, 30).every((r) => r === 'role')).toBe(true);
    expect(reasons[30]).toBe('busy');
    // Someone else on the same board is not held back.
    await ask(empty, otherId, connect('u2'));
    expect(sent.at(-1)).toMatchObject({ reason: 'role' });
  });

  it('sends only what the restore writes, not the deletions the board holds', async () => {
    const { ask, admitted, document, sent } = setup();
    for (let i = 0; i < 200; i++)
      deleteElements(document, [createElement(document, 'note', at, {}, opts).id]);
    const { copy } = deletedCards(document);
    await ask(copy);
    expect(sent[0]).toMatchObject({ outcome: 'restored' });
    expect(admitted).toHaveLength(1);
    // Its own deletions only (a note's empty body replaced by the copied one).
    const deleted = [...Y.decodeUpdate(admitted[0] as Uint8Array).ds.clients.keys()];
    expect(deleted).not.toContain(document.clientID);
  });

  it('answers an error of the task check `busy`, and a refused assignment `role`', async () => {
    const { ask, document, sent } = setup();
    const { copy, ids } = deletedCards(document);
    vi.mocked(validateTaskUpdate).mockRejectedValueOnce(new Error('connection lost'));
    await ask(copy);
    vi.mocked(validateTaskUpdate).mockRejectedValueOnce(
      new AssignmentRefusedError('Assignment requires editor access'),
    );
    await ask(copy, otherId);
    expect(sent).toMatchObject([
      { outcome: 'refused', reason: 'busy' },
      { outcome: 'refused', reason: 'role' },
    ]);
    expect(live(document, ids)).toEqual([]);
  });
});

describe('a write that lands on the board while a restore waits', () => {
  it('reads `present` when the cards came back meanwhile, and keeps that write', async () => {
    let rival = () => {};
    const { db } = stubDb(() => rival());
    const { ask, document, sent } = setup({ db });
    const { free, copy, ids } = deletedCards(document);
    rival = () => {
      rival = () => {};
      restoreElements(document, copy, { x: 0, y: 0 });
    };
    await ask(copy);
    expect(sent).toMatchObject([{ outcome: 'present' }]);
    const answer = sent[0];
    expect(answer?.outcome === 'present' && [...answer.present].sort()).toEqual([...ids].sort());
    // The card on the board is the rival's: its only client id is the board's own.
    expect(roots(document).elements._map.get(free)?.id.client).toBe(document.clientID);
  });

  it('builds again when a card key was set and deleted meanwhile, then restores', async () => {
    let rival = () => {};
    const { db, calls } = stubDb(() => rival());
    const { ask, document, sent } = setup({ db });
    const { free, copy, ids } = deletedCards(document);
    let between: Y.ID | undefined;
    rival = () => {
      rival = () => {};
      restoreElements(document, copy, { x: 0, y: 0 });
      deleteElements(
        document,
        ids.filter((id) => id !== ids[1]),
      );
      between = roots(document).elements._map.get(free)?.id;
    };
    await ask(copy);
    expect(sent).toMatchObject([{ outcome: 'restored' }]);
    expect(live(document, ids)).toEqual(ids);
    // Settled against the value set meanwhile, not the one the first build read: the rebuild
    // happened, and the holder of a key is what `_map` names.
    const holder = roots(document).elements._map.get(free);
    expect(holder?.origin).toEqual(between);
    // The moved-cards query ran once; each build ran the task check (no assignment: no query).
    expect(calls()).toBe(1);
  });

  it('refuses when the role was taken away meanwhile, writing nothing', async () => {
    let role: RestoreRefusal | null = null;
    const { db } = stubDb(() => {
      role = 'role';
    });
    const { ask, document, sent } = setup({ db, refusal: () => role });
    const { copy, ids } = deletedCards(document);
    await ask(copy);
    expect(sent).toMatchObject([{ outcome: 'refused', reason: 'role' }]);
    expect(live(document, ids)).toEqual([]);
  });

  it('puts a card on the canvas when its column was deleted meanwhile', async () => {
    let rival = () => {};
    const { db } = stubDb(() => rival());
    const { ask, document, sent } = setup({ db });
    const column = createElement(document, 'column', { x: 0, y: 0 }, { title: 'Refs' }, opts).id;
    const note = createElement(document, 'note', { x: 0, y: 0 }, { parent: column }, opts).id;
    const copy = JSON.parse(JSON.stringify(copyElements(document, [note])));
    deleteElements(document, [note]);
    rival = () => {
      rival = () => {};
      deleteElements(document, [column]);
    };
    await ask(copy);
    expect(sent).toMatchObject([{ outcome: 'restored', outside: [note] }]);
    expect(listElements(document).find((e) => e.id === note)).toMatchObject({
      parent: null,
      x: at.x,
      y: at.y,
    });
  });

  it('answers a request stuck on the database `busy`, never writes it, and goes on', async () => {
    let release = () => {};
    let stuck = true;
    const { db } = stubDb(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          if (!stuck) resolve();
        }),
    );
    const { ask, document, sent } = setup({ db, timeoutMs: 50 });
    const first = deletedCards(document);
    const second = deletedCards(document);
    const hung = ask(first.copy);
    await hung;
    expect(sent).toMatchObject([{ requestId, outcome: 'refused', reason: 'busy' }]);
    stuck = false;
    const pending = release;
    await ask(second.copy, otherId);
    expect(sent.at(-1)).toMatchObject({ requestId: otherId, outcome: 'restored' });
    // The stuck one answers late: it was already told `busy`, so it writes nothing.
    pending();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(live(document, first.ids)).toEqual([]);
    expect(sent).toHaveLength(2);
  });
});

describe('requests for one board', () => {
  it('run one at a time, in the order they came', async () => {
    let release = () => {};
    let first = true;
    const { db } = stubDb(async () => {
      if (!first) return;
      first = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const { ask, document, sent } = setup({ db });
    const a = deletedCards(document);
    const b = deletedCards(document);
    const one = ask(a.copy);
    const two = ask(b.copy, otherId);
    // The second waits for the first, held on the database.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
    release();
    await Promise.all([one, two]);
    expect(sent.map((s) => s.requestId)).toEqual([requestId, otherId]);
  });
});

describe('a resend', () => {
  it('is answered again only with the same copy', async () => {
    const { ask, document, sent } = setup();
    const { copy, ids } = deletedCards(document);
    await ask(copy);
    expect(sent[0]).toMatchObject({ outcome: 'restored' });
    await ask(copy);
    expect(sent[1]).toEqual({ ...sent[0], repeat: true });
    // The same id with another copy is another request: checked, and the cards are there.
    const other = { ...copy, elements: copy.elements.filter((e) => e.id === ids[2]) };
    await ask(other);
    expect(sent[2]).toMatchObject({ outcome: 'present', present: [ids[2]] });
  });
});
