import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  type Element,
  roots,
} from '@inkadra/doc-schema';
import { BOARD_WRITERS_CAPABILITY, type BoardWriter } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import {
  MAX_WRITERS_PER_BOARD,
  noteWriter,
  type PendingWriters,
  pruneWriters,
  WRITER_KEEP_MS,
} from '../board-writers.ts';
import { attachCollab, createCollabServer } from '../collab.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { boardWriter, projectMember, user } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe('noteWriter', () => {
  it('keeps the highest clock and marks an id two writers used as contested', () => {
    const pending: PendingWriters = new Map();
    noteWriter(pending, 7, 'a', 3);
    noteWriter(pending, 7, 'a', 1);
    noteWriter(pending, 8, null, 0);
    expect(pending.get(7)).toEqual({ userId: 'a', clock: 3, contested: false });
    noteWriter(pending, 7, 'b', 9);
    noteWriter(pending, 8, 'a', 1);
    expect(pending.get(7)).toEqual({ userId: 'a', clock: 9, contested: true });
    expect(pending.get(8)?.contested).toBe(true);
  });
});

describe.skipIf(!url)('board writers (needs DATABASE_URL)', () => {
  const env = {
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  };
  const config = loadConfig(env);
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  /** The collaboration server's clock, moved by the mark tests. */
  let clock: Date | null = null;
  const collab = createCollabServer({
    db,
    auth,
    log,
    publicUrl: config.PUBLIC_URL,
    now: () => clock ?? new Date(),
  });
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';
  const people: Record<string, { cookie: string; id: string }> = {};
  let projectId = '';
  let rootBoardId = '';
  /** A fresh board per test. */
  let boardId = '';
  const open: Array<{ close(): void }> = [];

  async function signUp(name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
    });
    people[name] = {
      cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
      id: res.json().user.id,
    };
  }

  function request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    as: string | null,
    payload?: unknown,
  ) {
    return app.inject({
      method,
      url: `/api/v1${path}`,
      headers: as ? { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }

  const lookup = (as: string | null, items: unknown, id = boardId) =>
    request('POST', `/boards/${id}/writers`, as, { items });
  async function writersOf(items: Array<{ client: number; clock?: number }>, as = 'viewer') {
    const res = await lookup(as, items);
    expect(res.statusCode).toBe(200);
    return (res.json() as { items: BoardWriter[] }).items;
  }

  function note(id: string): Element {
    return {
      id,
      type: 'note',
      x: 0,
      y: 0,
      w: 240,
      z: 'a0',
      parent: null,
      createdBy: null,
      createdAt: 1,
    } as Element;
  }

  /** A collaboration socket of `as`, writing under `clientID`. */
  function connect(as: string, clientID: number) {
    const header = people[as]?.cookie ?? '';
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie: header } });
      }
    }
    const doc = new Y.Doc();
    doc.clientID = clientID;
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://${base}/collab?schemaVersion=${CURRENT_SCHEMA_VERSION}`,
      WebSocketPolyfill: CookieSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: boardDocName(boardId),
      document: doc,
    });
    provider.attach();
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    const conn = {
      doc,
      provider,
      synced,
      close() {
        provider.destroy();
        websocketProvider.destroy();
      },
    };
    open.push(conn);
    return conn;
  }

  const live = () => collab.hocuspocus.documents.get(boardDocName(boardId));
  /** Waits until the live board has the card. */
  const arrived = (elementId: string) =>
    expect
      .poll(() => (live() ? roots(live() as Y.Doc).elements.has(elementId) : false), {
        timeout: 5000,
      })
      .toBe(true);
  /** Runs the debounced store of the board now and waits for it. */
  const store = async () => {
    await collab.hocuspocus.debouncer.executeNow(`onStoreDocument-${boardDocName(boardId)}`);
  };
  const nextClock = (doc: Y.Doc) => Y.getState(doc.store, doc.clientID);

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, ...testDeps(db, log) });
    attachCollab(app.server, collab);
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    for (const name of ['owner', 'editor', 'editor2', 'commenter', 'viewer', 'stranger'])
      await signUp(name);
    const project = await request('POST', '/projects', 'owner', { name: 'Writers' });
    projectId = project.json().id;
    rootBoardId = project.json().rootBoardId;
    for (const [name, role] of [
      ['editor', 'editor'],
      ['editor2', 'editor'],
      ['commenter', 'commenter'],
      ['viewer', 'viewer'],
    ] as const)
      await request('PUT', `/projects/${projectId}/members/${people[name]?.id}`, 'owner', { role });
  });

  beforeEach(async () => {
    clock = null;
    const created = await request('POST', `/projects/${projectId}/boards`, 'owner', {
      parentBoardId: rootBoardId,
      title: 'Writers',
    });
    boardId = created.json().id;
  });

  afterAll(async () => {
    for (const conn of open) conn.close();
    await app?.close();
    await collab.destroy();
    await client.end();
  });

  it('names the account behind each socket’s client id, in the order asked', async () => {
    const a = connect('editor', 1001);
    const b = connect('editor2', 1002);
    await Promise.all([a.synced, b.synced]);
    addElement(a.doc, note('writerA1'));
    addElement(b.doc, note('writerB1'));
    await arrived('writerA1');
    await arrived('writerB1');
    // Not stored yet: unknown, and the client retries.
    expect((await writersOf([{ client: 1001 }]))[0]?.kind).toBe('unknown');
    await store();
    a.close();
    b.close();
    const items = await writersOf([{ client: 1002 }, { client: 999 }, { client: 1001 }]);
    expect(items.map((i) => [i.client, i.kind, i.user?.name ?? null])).toEqual([
      [1002, 'user', 'editor2'],
      [999, 'unknown', null],
      [1001, 'user', 'editor'],
    ]);
    expect(items[0]?.user?.id).toBe(people.editor2?.id);
    expect(items[0]?.lastSeenAt).not.toBeNull();
    expect(items[1]).toMatchObject({ changedAt: null, lastSeenAt: null, user: null });
    expect(JSON.stringify(items)).not.toContain('@example.com');
  });

  it('names nobody once a second account writes under the same id', async () => {
    const a = connect('editor', 2001);
    await a.synced;
    addElement(a.doc, note('first001'));
    await arrived('first001');
    await store();
    a.close();
    const b = connect('editor2', 2002);
    await b.synced;
    // Yjs would pick a fresh id if the server sent writes under it; here nothing else writes.
    b.doc.clientID = 2001;
    addElement(b.doc, note('second01'));
    await arrived('second01');
    await store();
    b.close();
    const [item] = await writersOf([{ client: 2001 }]);
    expect(item).toMatchObject({ client: 2001, kind: 'contested', user: null });
  });

  it('puts items waiting for another socket’s on the socket that sent them', async () => {
    // Items under 3102, which editor2 will send; editor writes under 3101 on top of them.
    const other = new Y.Doc();
    other.clientID = 3102;
    addElement(other, note('base0001'));
    const theirs = Y.encodeStateAsUpdate(other);
    const a = connect('editor', 3101);
    await a.synced;
    // Applied as if it came from the server: not sent, so the server cannot integrate 3101 yet.
    Y.applyUpdate(a.doc, theirs, a.provider);
    roots(a.doc).elements.get('base0001')?.set('x', 50);
    await expect
      .poll(() => (live()?.store.pendingStructs ? 'pending' : 'none'), { timeout: 5000 })
      .toBe('pending');
    const b = connect('editor2', 3103);
    await b.synced;
    Y.applyUpdate(b.doc, theirs);
    await arrived('base0001');
    await expect
      .poll(
        () =>
          roots(live() as Y.Doc)
            .elements.get('base0001')
            ?.get('x'),
        { timeout: 5000 },
      )
      .toBe(50);
    await store();
    a.close();
    b.close();
    const items = await writersOf([{ client: 3101 }, { client: 3102 }]);
    expect(items.map((i) => [i.kind, i.user?.name])).toEqual([
      ['user', 'editor'],
      ['user', 'editor2'],
    ]);
  });

  it('writes the noted ids in one statement per store, not per update', async () => {
    const a = connect('editor', 4001);
    const b = connect('editor2', 4002);
    await Promise.all([a.synced, b.synced]);
    const inserts = vi.spyOn(db, 'insert');
    try {
      for (let i = 0; i < 5; i++) {
        addElement(a.doc, note(`batchA0${i}`));
        addElement(b.doc, note(`batchB0${i}`));
      }
      await arrived('batchA04');
      await arrived('batchB04');
      await store();
      expect(inserts.mock.calls.filter(([table]) => table === boardWriter)).toHaveLength(1);
    } finally {
      inserts.mockRestore();
      a.close();
      b.close();
    }
    const rows = await db.select().from(boardWriter).where(eq(boardWriter.boardId, boardId));
    expect(rows.map((r) => r.clientId).sort()).toEqual([4001, 4002]);
  });

  it('records the server’s own writes under the document’s id', async () => {
    let serverId = 0;
    const connection = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
    try {
      await connection.transact((doc) => {
        serverId = doc.clientID;
        addElement(doc, note('server01'));
      });
      await store();
    } finally {
      await connection.disconnect();
    }
    const [item] = await writersOf([{ client: serverId }]);
    expect(item).toMatchObject({ kind: 'server', user: null });
  });

  it('answers when a clock reached the server, about to the minute', async () => {
    const t0 = new Date('2026-11-12T10:00:00Z');
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
    const a = connect('editor', 5001);
    await a.synced;
    const write = async (id: string, seconds: number) => {
      const first = nextClock(a.doc);
      addElement(a.doc, note(id));
      await arrived(id);
      clock = at(seconds);
      await store();
      return first;
    };
    const c1 = await write('mark0001', 0); // first mark
    const c2 = await write('mark0002', 30); // under a minute: no mark
    const c3 = await write('mark0003', 61); // a mark covering c2 and c3
    const c4 = await write('mark0004', 90); // no mark: last seen only
    a.close();
    const items = await writersOf([
      { client: 5001, clock: c1 },
      { client: 5001, clock: c2 },
      { client: 5001, clock: c3 },
      { client: 5001, clock: c4 },
      { client: 5001 },
    ]);
    expect(items.map((i) => i.changedAt)).toEqual([
      at(0).toISOString(),
      at(61).toISOString(),
      at(61).toISOString(),
      at(90).toISOString(),
      at(90).toISOString(),
    ]);
    expect(new Set(items.map((i) => i.lastSeenAt))).toEqual(new Set([at(90).toISOString()]));
    const [row] = await db.select().from(boardWriter).where(eq(boardWriter.clientId, 5001));
    expect(row?.firstSeenAt).toEqual(at(0));
    expect(row?.marks).toHaveLength(2);
  });

  it('keeps at most 32 marks, dropping the oldest', async () => {
    const a = connect('editor', 6001);
    await a.synced;
    const t0 = Date.parse('2026-11-12T10:00:00Z');
    for (let i = 0; i < 34; i++) {
      addElement(a.doc, note(`cap000${String(i).padStart(2, '0')}`));
      await arrived(`cap000${String(i).padStart(2, '0')}`);
      clock = new Date(t0 + i * 60_000);
      await store();
    }
    a.close();
    const [row] = await db.select().from(boardWriter).where(eq(boardWriter.clientId, 6001));
    expect(row?.marks).toHaveLength(32);
    expect(row?.marks[0]?.[1]).toBe(t0 / 1000 + 2 * 60);
  });

  it('lets viewers and up ask; strangers get 404, signed-out callers 401', async () => {
    await db.insert(boardWriter).values({
      boardId,
      clientId: 7001,
      userId: people.editor?.id ?? null,
      kind: 'user',
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      marks: [[0, Math.floor(Date.now() / 1000)]],
    });
    for (const who of ['viewer', 'commenter', 'editor', 'owner']) {
      const [item] = await writersOf([{ client: 7001 }], who);
      expect(item?.user?.name).toBe('editor');
    }
    expect((await lookup('stranger', [{ client: 7001 }])).statusCode).toBe(404);
    expect((await lookup(null, [{ client: 7001 }])).statusCode).toBe(401);
    const missing = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
    expect((await lookup('viewer', [{ client: 7001 }], missing)).statusCode).toBe(404);
  });

  it('refuses lookups out of the contract', async () => {
    const many = Array.from({ length: 51 }, (_, client) => ({ client }));
    expect((await lookup('viewer', many)).statusCode).toBe(400);
    expect((await lookup('viewer', many.slice(0, 50))).statusCode).toBe(200);
    for (const items of [
      [],
      [{ client: -1 }],
      [{ client: 4294967296 }],
      [{ client: 1, clock: -1 }],
    ])
      expect((await lookup('viewer', items)).statusCode).toBe(400);
  });

  it('names removed members and never deleted accounts', async () => {
    await signUp('leaver');
    await signUp('gone');
    for (const name of ['leaver', 'gone'])
      await request('PUT', `/projects/${projectId}/members/${people[name]?.id}`, 'owner', {
        role: 'editor',
      });
    const a = connect('leaver', 8001);
    const b = connect('gone', 8002);
    await Promise.all([a.synced, b.synced]);
    addElement(a.doc, note('leaver01'));
    addElement(b.doc, note('gone0001'));
    await arrived('leaver01');
    await arrived('gone0001');
    await store();
    a.close();
    b.close();
    for (const name of ['leaver', 'gone'])
      await db.delete(projectMember).where(eq(projectMember.userId, people[name]?.id ?? ''));
    await db.delete(user).where(eq(user.id, people.gone?.id ?? ''));
    const items = await writersOf([{ client: 8001 }, { client: 8002 }]);
    expect(items.map((i) => [i.kind, i.user?.name ?? null])).toEqual([
      ['user', 'leaver'],
      ['deleted', null],
    ]);
    expect(items[1]?.lastSeenAt).not.toBeNull();
    expect(JSON.stringify(items)).not.toContain('gone');
  });

  it('allows 60 lookups a minute per account', async () => {
    await signUp('counter');
    await request('PUT', `/projects/${projectId}/members/${people.counter?.id}`, 'owner', {
      role: 'viewer',
    });
    for (let i = 0; i < 60; i++)
      expect((await lookup('counter', [{ client: 1 }])).statusCode).toBe(200);
    expect((await lookup('counter', [{ client: 1 }])).statusCode).toBe(429);
    expect((await lookup('viewer', [{ client: 1 }])).statusCode).toBe(200);
  });

  it('purges rows 30 days after their last write and keeps the newest 2000 per board', async () => {
    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const row = (clientId: number, lastSeenAt: Date) => ({
      boardId,
      clientId,
      userId: null,
      kind: 'server' as const,
      firstSeenAt: lastSeenAt,
      lastSeenAt,
      marks: [[0, 0]] as Array<[number, number]>,
    });
    await db
      .insert(boardWriter)
      .values([
        row(1, ago(WRITER_KEEP_MS + 60_000)),
        row(2, ago(WRITER_KEEP_MS - 60_000)),
        ...Array.from({ length: MAX_WRITERS_PER_BOARD + 1 }, (_, i) => row(100 + i, ago(i * 1000))),
      ]);
    const { removed } = await pruneWriters(db, now);
    expect(removed).toBe(3);
    const left = await db
      .select({ id: boardWriter.clientId })
      .from(boardWriter)
      .where(eq(boardWriter.boardId, boardId));
    const ids = new Set(left.map((r) => r.id));
    expect(ids.size).toBe(MAX_WRITERS_PER_BOARD);
    expect(ids.has(1) || ids.has(2)).toBe(false);
    expect(ids.has(100)).toBe(true);
    expect(ids.has(100 + MAX_WRITERS_PER_BOARD)).toBe(false);
  });

  it('advertises the capability', async () => {
    const res = await request('GET', '/instance/version', 'viewer');
    expect(res.json().capabilities).toContain(BOARD_WRITERS_CAPABILITY);
  });
});
