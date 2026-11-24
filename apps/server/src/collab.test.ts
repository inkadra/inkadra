import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { Connection } from '@hocuspocus/server';
import { addTodoItem, createElement, updateTodoItem } from '@inkadra/canvas-core';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  newElementId,
  readElement,
  readPresence,
  roots,
} from '@inkadra/doc-schema';
import { Queue, QueueEvents } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from './auth.ts';
import { directBoardNotifier, NOTICE_TTL_MS } from './board-notices.ts';
import { CardOutcomeUnknown, directBoardWriter } from './board-writer.ts';
import {
  attachCollab,
  createCollabServer,
  replayUnsavedBoards,
  SHUTDOWN_STORE_MS,
  storedHolds,
} from './collab.ts';
import { StaleCollabEpochError, takeCollabEpoch } from './collab-epoch.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import {
  boardDoc,
  boardElementIndex,
  boardVersion,
  notification,
  personalToken,
  projectMember,
} from './db/schema.ts';
import { createApp } from './http/app.ts';
import * as drawings from './image-drawing.ts';
import {
  createRedis,
  QUEUES,
  queuedBoardNotifier,
  queuedBoardWriter,
  startBoardWorker,
} from './queues.ts';
import { testDeps } from './test-deps.ts';
import { issueToken } from './tokens.ts';
import { directVersionWriter } from './versions.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

const column = (title: string, x = 0) => ({
  id: newElementId(),
  type: 'column' as const,
  title,
  x,
  y: 0,
  w: 280,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: Date.now(),
});

describe.skipIf(!url)('collab (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    // Fixture setup creates many accounts on one loopback network. Auth limits have dedicated tests.
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  const limits = { stateBytes: 64 * 1024 * 1024, elements: 20_000, maxPayload: 16 * 1024 * 1024 };
  const collab = createCollabServer({
    limits,
    db,
    auth,
    log,
    publicUrl: config.PUBLIC_URL,
    recheckMs: 200,
    keepaliveMs: 500,
  });
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';
  let boardId = '';
  let projectId = '';
  const people: Record<string, { cookie: string; id: string }> = {};
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

  const as = (name: string) => ({ cookie: people[name]?.cookie ?? '', origin: config.PUBLIC_URL });

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, ...testDeps(db, log) });
    attachCollab(app.server, collab);
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    for (const name of ['owner', 'viewer', 'editor']) await signUp(name);
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('owner'),
      payload: { name: 'Collab' },
    });
    boardId = project.json().rootBoardId;
    projectId = project.json().id;
    for (const name of ['viewer', 'editor'] as const)
      await app.inject({
        method: 'PUT',
        url: `/api/v1/projects/${projectId}/members/${people[name]?.id}`,
        headers: as('owner'),
        payload: { role: name },
      });
  });

  afterAll(async () => {
    for (const c of open) c.close();
    await collab.destroy();
    await app?.close();
    await client.end();
  });

  function connect(
    credentials: { cookie?: string; token?: string },
    origin?: string,
    schemaVersion: number | null = CURRENT_SCHEMA_VERSION,
    targetBoardId = boardId,
    query = '',
  ) {
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, {
          headers: credentials.cookie ? { cookie: credentials.cookie } : {},
          ...(origin ? { origin } : {}),
        });
        // Closing a socket still connecting (e.g. a refused connection reconnecting at teardown)
        // emits `error` after Hocuspocus strips its own handlers; without a listener it throws out
        // of the worker (#971).
        this.on('error', () => {});
      }
    }
    const doc = new Y.Doc();
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://${base}/collab${schemaVersion === null ? '' : `?schemaVersion=${schemaVersion}`}${query}`,
      WebSocketPolyfill: CookieSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: boardDocName(targetBoardId),
      document: doc,
      ...(credentials.token ? { token: credentials.token } : {}),
    });
    provider.attach();
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    let closed = false;
    const conn = {
      doc,
      provider,
      websocketProvider,
      synced,
      close() {
        if (closed) return;
        closed = true;
        provider.destroy();
        websocketProvider.destroy();
      },
    };
    open.push(conn);
    return conn;
  }

  /** Why the server closed the document, or null if it stays open for 4 s. */
  function closedWith(c: ReturnType<typeof connect>) {
    return new Promise<string | null>((resolve) => {
      c.provider.on('close', ({ event }: { event: { reason: string } }) => resolve(event.reason));
      setTimeout(() => resolve(null), 4000);
    });
  }

  it('loads an existing oversized board, refuses additions and persists deletions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('owner'),
      payload: { name: 'Existing large board' },
    });
    const id = created.json().rootBoardId as string;
    const saved = new Y.Doc();
    roots(saved).meta.set('schemaVersion', CURRENT_SCHEMA_VERSION);
    const first = column('Keep');
    const second = column('Delete');
    addElement(saved, first);
    addElement(saved, second);
    const state = Y.encodeStateAsUpdate(saved);
    await db.insert(boardDoc).values({
      boardId: id,
      state,
      size: state.byteLength,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    limits.elements = 1;
    try {
      const writer = connect(as('owner'), undefined, CURRENT_SCHEMA_VERSION, id);
      await writer.synced;
      expect(roots(writer.doc).elements.size).toBe(2);
      // The server's own additions (clips) keep to the same caps.
      const clip = await directBoardWriter(collab).addCard({
        boardId: id,
        userId: people.owner?.id ?? '',
        card: { type: 'note', fields: {} },
      });
      expect(clip).toEqual({ ok: false, reason: 'full' });
      const notices: string[] = [];
      writer.provider.on('stateless', ({ payload }: { payload: string }) => notices.push(payload));
      addElement(writer.doc, column('Refused'));
      await vi.waitFor(() =>
        expect(notices).toContain(JSON.stringify({ type: 'writeRefused', reason: 'frozen' })),
      );
      // The open document: closing the last connection may unload it and the next one reload it.
      const live = () => collab.hocuspocus.documents.get(boardDocName(id))!;
      expect(roots(live()).elements.size).toBe(2);
      // Reopen from confirmed state, as the web client does on the refusal notice.
      writer.close();
      const clean = connect(as('owner'), undefined, CURRENT_SCHEMA_VERSION, id);
      await clean.synced;
      roots(clean.doc).elements.delete(second.id);
      await vi.waitFor(() => expect(roots(live()).elements.size).toBe(1));
      expect(roots(live()).elements.has(first.id)).toBe(true);
      clean.close();
      collab.hocuspocus.flushPendingStores();
      await vi.waitFor(async () => {
        const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, id));
        const persisted = new Y.Doc();
        Y.applyUpdate(persisted, row!.state);
        expect(roots(persisted).elements.size).toBe(1);
        persisted.destroy();
      });
    } finally {
      limits.elements = 20_000;
      saved.destroy();
    }
  });

  it('logs invalid elements at the first store of an open board, not at every store', async () => {
    const warned = vi.spyOn(log, 'warn');
    const owner = connect(as('owner'));
    await owner.synced;
    const odd = new Y.Map<unknown>();
    const oddId = newElementId();
    const otherId = newElementId();
    owner.doc.transact(() => {
      roots(owner.doc).elements.set(oddId, odd);
      odd.set('id', oddId);
      odd.set('type', 'not-a-card');
    });
    const invalid = () => warned.mock.calls.filter(([, msg]) => msg === 'invalid elements').length;
    try {
      collab.hocuspocus.flushPendingStores();
      await vi.waitFor(() => expect(invalid()).toBe(1), { timeout: 5000 });
      roots(owner.doc).elements.set(otherId, new Y.Map());
      await new Promise((r) => setTimeout(r, 100));
      collab.hocuspocus.flushPendingStores();
      await new Promise((r) => setTimeout(r, 500));
      expect(invalid()).toBe(1);
    } finally {
      warned.mockRestore();
      for (const id of [oddId, otherId]) roots(owner.doc).elements.delete(id);
      await new Promise((r) => setTimeout(r, 100));
      collab.hocuspocus.flushPendingStores();
      owner.close();
    }
  });

  it('syncs a board between two clients and stores it', async () => {
    const a = connect(as('owner'));
    const b = connect(as('owner'));
    await Promise.all([a.synced, b.synced]);
    expect(roots(a.doc).meta.get('schemaVersion')).toBe(CURRENT_SCHEMA_VERSION);

    const el = column('Location');
    addElement(a.doc, el);
    await expect.poll(() => roots(b.doc).elements.has(el.id), { timeout: 5000 }).toBe(true);
    expect(readElement(roots(b.doc).elements.get(el.id)!)?.type).toBe('column');

    a.close();
    b.close();
    collab.hocuspocus.flushPendingStores();
    await expect
      .poll(
        async () => (await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId))).length,
        { timeout: 5000 },
      )
      .toBe(1);
    // The search index follows the stored document.
    await expect
      .poll(
        async () =>
          (
            await db.select().from(boardElementIndex).where(eq(boardElementIndex.boardId, boardId))
          ).map((r) => r.title),
        { timeout: 5000 },
      )
      .toEqual(['Location']);
  });

  /** A new editor of the main board, who no other test demotes. */
  async function freshEditor(name: string) {
    await signUp(name);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/members/${people[name]?.id}`,
      headers: as('owner'),
      payload: { role: 'editor' },
    });
    return people[name]?.id ?? '';
  }

  it('refuses a malformed update, closing its sender, and leaves the board as it was (decision 0139)', async () => {
    await freshEditor('malformed');
    const c = connect(as('malformed'));
    await c.synced;
    const live = collab.hocuspocus.documents.get(boardDocName(boardId))!;
    const before = Y.encodeStateVector(live);
    // A struct of no length: applied, the board could no longer be encoded.
    const str = (s: string) => [s.length, ...new TextEncoder().encode(s)];
    const update = new Uint8Array([
      ...[1, 2, 0xab, 0x04, 0],
      ...[8 | 0x20, 1, ...str('decoy'), ...str('x'), 1, 119, ...str('a')],
      ...[8 | 0x80, 0xab, 0x04, 0, 0],
      0,
    ]);
    expect(Y.decodeUpdate(update).structs.map((s) => s.length)).toEqual([1, 0]);
    const closed = closedWith(c);
    // Sent as the provider sends an update, bypassing its own document.
    (
      c.provider as unknown as { documentUpdateHandler(u: Uint8Array, o: unknown): void }
    ).documentUpdateHandler(update, null);
    expect(await closed).toBe('Reset Connection');
    expect(Y.encodeStateVector(live)).toEqual(before);
    expect(() => Y.encodeStateAsUpdate(live)).not.toThrow();
    c.close();
  });

  it('applies nothing from a connection closed while its update waits for the role check', async () => {
    const actor = await freshEditor('revoked');
    // Someone else keeps the board open.
    const other = connect(as('owner'));
    await other.synced;
    const c = connect(as('revoked'));
    await c.synced;
    // A second board of theirs on the same socket keeps it open when this board's connection
    // closes, as a client with several boards open has it.
    const own = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('revoked'),
      payload: { name: 'Elsewhere' },
    });
    const elsewhere = new HocuspocusProvider({
      websocketProvider: c.websocketProvider,
      name: boardDocName(own.json().rootBoardId),
      document: new Y.Doc(),
    });
    elsewhere.attach();
    await new Promise<void>((resolve) => elsewhere.on('synced', () => resolve()));
    const live = collab.hocuspocus.documents.get(boardDocName(boardId))!;
    const connection = (
      live.getConnections() as Array<Connection<{ actor?: { id: string } }>>
    ).find((conn) => conn.context?.actor?.id === actor)!;
    // An assignment, which waits for the sender's role before Hocuspocus applies it.
    const draft = new Y.Doc();
    Y.applyUpdate(draft, Y.encodeStateAsUpdate(live));
    const sv = Y.encodeStateVector(draft);
    const todo = createElement(draft, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null }).id;
    const item = addTodoItem(draft, todo, 'Permit')!;
    updateTodoItem(draft, todo, item, { assigneeId: actor });
    const payload = Y.encodeStateAsUpdate(draft, sv);
    const beforeSync = collab.hocuspocus.configuration.beforeSync!;
    const checked = beforeSync({
      connection,
      document: live,
      documentName: live.name,
      context: connection.context,
      type: 2,
      payload,
    } as unknown as Parameters<typeof beforeSync>[0]);
    // Access removed meanwhile: the connection leaves the board, its socket may stay open.
    connection.close({ code: 4403, reason: 'Forbidden' });
    await checked;
    expect(connection.webSocket.readyState).toBe(1);
    expect(live.isDestroyed).toBe(false);
    expect(connection.readOnly).toBe(true);
    expect(roots(live).elements.has(todo)).toBe(false);
    // A message still queued from it is dropped before anything reads it, even a malformed one.
    connection.readOnly = false;
    await beforeSync({
      connection,
      document: live,
      documentName: live.name,
      context: connection.context,
      type: 2,
      payload: new Uint8Array([1, 1, 0xab, 0x04, 0, 8 | 0x80, 0xab, 0x04, 0, 0, 0]),
    } as unknown as Parameters<typeof beforeSync>[0]);
    expect(connection.readOnly).toBe(true);
    elsewhere.destroy();
    c.close();
    other.close();
  });

  it('drops the document of a board deleted while open, without an error, and unloads it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('owner'),
      payload: { name: 'Gone' },
    });
    const goneProject = created.json().id;
    const goneBoard = created.json().rootBoardId;
    const c = connect(as('owner'), undefined, CURRENT_SCHEMA_VERSION, goneBoard);
    await c.synced;
    const errors = vi.spyOn(console, 'error');
    const logged = vi.spyOn(log, 'error');
    const told = vi.spyOn(log, 'info');
    // The store finds no board row and writes nothing (#935): no rejected insert reaches the
    // database log, so no store transaction fails.
    const writes = vi.spyOn(db, 'transaction');
    try {
      // An edit the server holds but has not stored yet when the board is deleted: it tries to
      // store it afterwards. (An edit sent after the deletion is refused once the access check
      // closes the connection: decision 0139.)
      const late = column('Too late');
      addElement(c.doc, late);
      await expect
        .poll(
          () =>
            roots(collab.hocuspocus.documents.get(boardDocName(goneBoard))!).elements.has(late.id),
          { timeout: 5000 },
        )
        .toBe(true);
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${goneProject}`,
        headers: as('owner'),
      });
      expect(deleted.statusCode).toBe(204);
      c.close();
      collab.hocuspocus.flushPendingStores();
      await expect
        .poll(() => collab.hocuspocus.documents.has(boardDocName(goneBoard)), { timeout: 5000 })
        .toBe(false);
      expect(errors).not.toHaveBeenCalled();
      expect(logged).not.toHaveBeenCalled();
      expect(told).toHaveBeenCalledWith(
        { boardId: goneBoard },
        'board deleted while open: document not stored',
      );
      expect(writes).toHaveBeenCalled();
      await Promise.allSettled(writes.mock.results.map((r) => r.value));
      expect(writes.mock.settledResults.map((r) => r.type)).not.toContain('rejected');
      expect(await db.select().from(boardDoc).where(eq(boardDoc.boardId, goneBoard))).toEqual([]);
    } finally {
      errors.mockRestore();
      logged.mockRestore();
      told.mockRestore();
      writes.mockRestore();
    }
  });

  it('drops a board kept on disk whose board was deleted, without a rejected write', async () => {
    const goneBoard = randomUUID();
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-unsaved-'));
    const doc = new Y.Doc();
    addElement(doc, column('Kept for a deleted board'));
    writeFileSync(join(dir, `${goneBoard}.yupdate`), Y.encodeStateAsUpdate(doc));
    const told = vi.spyOn(log, 'info');
    const writes = vi.spyOn(db, 'transaction');
    try {
      await replayUnsavedBoards(db, dir, log);
      expect(told).toHaveBeenCalledWith(
        { boardId: goneBoard },
        'board kept on disk at the last shutdown was deleted: dropped',
      );
      await Promise.allSettled(writes.mock.results.map((r) => r.value));
      expect(writes.mock.settledResults.map((r) => r.type)).toEqual(['fulfilled']);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      told.mockRestore();
      writes.mockRestore();
    }
  });

  it('retries a failed board store, keeps the board until it is stored, and keeps it on disk at shutdown', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('owner'),
      payload: { name: 'Flaky database' },
    });
    const flakyBoard: string = created.json().rootBoardId;
    const name = boardDocName(flakyBoard);
    // The board_doc write fails while `down` is set, as when Postgres restarts.
    let down = true;
    const flaky = failingInserts(db, () => down);
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-unsaved-'));
    const other = createCollabServer({
      db: flaky,
      auth,
      log,
      publicUrl: config.PUBLIC_URL,
      unsavedDir: dir,
    });
    const isStored = async (id: string) => {
      const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, flakyBoard));
      const doc = new Y.Doc();
      if (row) Y.applyUpdate(doc, row.state);
      return doc.getMap('elements').has(id);
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const kept = column('Kept');
      const first = await other.hocuspocus.openDirectConnection(name);
      await first.transact((doc) => addElement(doc, kept));
      // Leaving stores at once: the store fails, and the board must not unload with it.
      await first.disconnect();
      expect(other.hocuspocus.documents.has(name)).toBe(true);
      expect(await isStored(kept.id)).toBe(false);
      down = false;
      await expect.poll(() => isStored(kept.id), { timeout: 5000 }).toBe(true);
      await expect.poll(() => other.hocuspocus.documents.has(name), { timeout: 5000 }).toBe(false);

      // Shutdown while the database is still down: one last try, then the board goes to disk
      // and the shutdown ends instead of waiting for a store that cannot happen.
      down = true;
      const spilled = column('Spilled');
      const second = await other.hocuspocus.openDirectConnection(name);
      await second.transact((doc) => addElement(doc, spilled));
      await second.disconnect();
      await other.destroy();
      expect(readdirSync(dir)).toEqual([`${flakyBoard}.yupdate`]);
      expect(await isStored(spilled.id)).toBe(false);
      // The next start stores it, merged with what the database has.
      await replayUnsavedBoards(db, dir, log);
      expect(await isStored(spilled.id)).toBe(true);
      expect(await isStored(kept.id)).toBe(true);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      down = false;
      errors.mockRestore();
      await other.destroy();
    }
  });

  /**
   * A new board on a collab server of its own, with one shown and two hidden columns, its stores
   * counted, its board writes able to fail or wait on demand, and its setup already stored.
   */
  async function hidingBoard(
    name: string,
    boardLimits?: typeof limits & { freeze?: boolean },
    timerMode: 'real' | 'manual' | 'sync' = 'real',
    fence?: { epoch: number; onStale: () => void },
  ) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('owner'),
      payload: { name },
    });
    const id: string = created.json().rootBoardId;
    const control = controlledWrites(db);
    /** Early-store timers waiting, when the test fires them by hand. */
    const timers = new Set<() => void>();
    const fire = () => {
      const due = [...timers];
      timers.clear();
      for (const run of due) run();
    };
    const server = createCollabServer({
      ...(timerMode === 'manual'
        ? {
            hidingTimer: (run: () => void) => {
              timers.add(run);
              return () => timers.delete(run);
            },
          }
        : {}),
      // A timer that runs before it returns its cancel.
      ...(timerMode === 'sync'
        ? {
            hidingTimer: (run: () => void) => {
              run();
              return () => {};
            },
          }
        : {}),
      db: control.db,
      auth,
      log,
      publicUrl: config.PUBLIC_URL,
      ...(boardLimits ? { limits: boardLimits } : {}),
      ...(fence ? { fence } : {}),
    });
    const hooks = vi.spyOn(server.hocuspocus, 'hooks');
    const storeCalls = vi.spyOn(server.hocuspocus, 'storeDocumentHooks');
    /** Stores begun, failed ones included. */
    const stores = () => hooks.mock.calls.filter(([hook]) => hook === 'onStoreDocument').length;
    /** Stores asked to run at once: early stores, retries and the last person leaving. */
    const immediate = () => storeCalls.mock.calls.filter(([, , now]) => now === true).length;
    const shown = column('Shown');
    const hiddenA = { ...column('Hidden A'), guestHidden: true };
    const hiddenB = { ...column('Hidden B'), guestHidden: true };
    const card = (parent: string) => ({
      id: newElementId(),
      type: 'note' as const,
      x: 0,
      y: 0,
      w: 200,
      z: 'a1',
      parent,
      createdBy: null,
      createdAt: Date.now(),
    });
    const cards = [card(shown.id), card(shown.id), card(shown.id)];
    const tucked = card(hiddenA.id);
    const conn = await server.hocuspocus.openDirectConnection(boardDocName(id));
    await conn.transact((doc) => {
      for (const el of [shown, hiddenA, hiddenB, ...cards, tucked]) addElement(doc, el);
    });
    const set = (elementId: string, key: string, value: unknown) =>
      conn.transact((doc) => roots(doc).elements.get(elementId)?.set(key, value));
    /** The parent of an element in the stored document. */
    const storedParent = async (elementId: string) => {
      const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, id));
      const doc = new Y.Doc();
      if (row) Y.applyUpdate(doc, row.state);
      return roots(doc).elements.get(elementId)?.get('parent');
    };
    const flush = () => server.hocuspocus.flushPendingStores();
    flush();
    // Stored, and the store finished (it still indexes the board after the write).
    const finished = () =>
      hooks.mock.calls.filter(([hook]) => hook === 'afterStoreDocument').length;
    await expect.poll(finished, { timeout: 5000 }).toBe(1);
    expect(await storedParent(tucked.id)).toBe(hiddenA.id);
    expect(stores()).toBe(1);
    const close = async () => {
      control.down = false;
      control.release();
      await conn.disconnect().catch(() => {});
      await server.destroy();
    };
    return {
      ...{ control, server, stores, finished, immediate, set, storedParent, flush, close },
      ...{ timers, fire },
      ...{ shown, hiddenA, hiddenB, cards, tucked },
    };
  }
  /** Well past GUEST_HIDING_STORE_MS (300 ms) and well before the usual store debounce (2 s). */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 800));
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Silences and counts the errors a failed store logs. */
  const storeErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('stores a board at once when a card guests saw is hidden through its container', async () => {
    const b = await hidingBoard('Hidden through a column');
    try {
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      await expect.poll(() => b.storedParent(b.cards[0]!.id), { timeout: 800 }).toBe(b.hiddenA.id);
      expect(b.stores()).toBe(2);
    } finally {
      await b.close();
    }
  });

  it('cancels its early stores once superseded and arms none after (F-24)', async () => {
    const stale = vi.fn();
    const b = await hidingBoard('Superseded early store', undefined, 'manual', {
      epoch: await takeCollabEpoch(db),
      onStale: stale,
    });
    try {
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      expect(b.timers.size).toBe(1);
      // A newer process took over; the next store is refused.
      await takeCollabEpoch(db);
      b.flush();
      await vi.waitFor(() => expect(stale).toHaveBeenCalledOnce());
      expect(b.timers.size).toBe(0);
      await b.set(b.cards[1]!.id, 'parent', b.hiddenA.id);
      expect(b.timers.size).toBe(0);
    } finally {
      await b.close();
    }
  });

  it('arms no early store after a store whose index write meets a newer process (F-24)', async () => {
    const stale = vi.fn();
    const b = await hidingBoard('Superseded at the index', undefined, 'manual', {
      epoch: await takeCollabEpoch(db),
      onStale: stale,
    });
    const transaction = db.transaction.bind(db);
    let armed = false;
    const writes = vi.spyOn(db, 'transaction').mockImplementation((async (
      ...args: Parameters<typeof db.transaction>
    ) => {
      // The takeover lands after the store's write, before the next transaction of the store.
      if (armed) {
        armed = false;
        await takeCollabEpoch({ transaction } as never);
      }
      return transaction(...args);
    }) as typeof db.transaction);
    try {
      // The store reads the board, then a card is hidden while its write waits.
      await b.set(b.cards[2]!.id, 'x', 40);
      b.control.hold();
      b.flush();
      await vi.waitFor(() => expect(b.control.waiting).toBeGreaterThan(0));
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      armed = true;
      b.control.release();
      await vi.waitFor(() => expect(stale).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(b.finished()).toBe(2));
      // The store wrote an older state, but this process stores nothing more: nothing is armed.
      expect(b.timers.size).toBe(0);
    } finally {
      writes.mockRestore();
      await b.close();
    }
  });

  it('stores a burst of cards hidden from guests once', async () => {
    const b = await hidingBoard('Hidden in a burst');
    try {
      for (const c of b.cards) await b.set(c.id, 'parent', b.hiddenA.id);
      await settle();
      expect(b.stores()).toBe(2);
      expect(b.immediate()).toBe(1);
      for (const c of b.cards) expect(await b.storedParent(c.id)).toBe(b.hiddenA.id);
    } finally {
      await b.close();
    }
  });

  it('does not store early when a card moves between two containers already hidden', async () => {
    const b = await hidingBoard('Between hidden columns');
    try {
      await b.set(b.tucked.id, 'parent', b.hiddenB.id);
      await b.set(b.tucked.id, 'parent', b.hiddenA.id);
      await b.set(b.tucked.id, 'parent', b.hiddenB.id);
      await settle();
      expect(b.stores()).toBe(1);
      expect(b.immediate()).toBe(0);
    } finally {
      await b.close();
    }
  });

  it('does not store early on edits that hide nothing guests saw', async () => {
    const b = await hidingBoard('Unrelated edits');
    try {
      await b.set(b.shown.id, 'title', 'Renamed');
      await b.set(b.cards[0]!.id, 'x', 40);
      await b.set(b.hiddenB.id, 'guestHidden', false);
      await settle();
      expect(b.stores()).toBe(1);
      expect(b.immediate()).toBe(0);
    } finally {
      await b.close();
    }
  });

  it('cancels the early store once a store that ran first wrote the hiding', async () => {
    const b = await hidingBoard('Store ran first', undefined, 'manual');
    try {
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      expect(b.timers.size).toBe(1);
      // A store that runs first (the last person leaving, a shutdown) writes the hiding too.
      b.flush();
      await expect.poll(() => b.storedParent(b.cards[0]!.id), { timeout: 1000 }).toBe(b.hiddenA.id);
      await expect.poll(() => b.timers.size, { timeout: 1000 }).toBe(0);
      expect(b.stores()).toBe(2);
      expect(b.immediate()).toBe(0);
    } finally {
      await b.close();
    }
  });

  it('stores again a card hidden while a store that read the board before it was writing', async () => {
    const b = await hidingBoard('Hidden during a store', undefined, 'manual');
    try {
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      // The early store is still armed when another store reads the board and starts writing.
      b.control.hold();
      b.flush();
      await expect.poll(() => b.control.waiting, { timeout: 1000 }).toBe(1);
      await b.set(b.cards[1]!.id, 'parent', b.hiddenA.id);
      const [first] = b.timers;
      expect(b.timers.size).toBe(1);
      b.control.release();
      await expect.poll(b.finished, { timeout: 1000 }).toBe(2);
      expect(await b.storedParent(b.cards[0]!.id)).toBe(b.hiddenA.id);
      // Written without the second card: the early store is armed again (its timer expires after
      // the commit), and sends.
      expect(b.timers.size).toBe(1);
      expect(b.timers.has(first!)).toBe(false);
      expect(await b.storedParent(b.cards[1]!.id)).toBe(b.shown.id);
      b.fire();
      expect(b.immediate()).toBe(1);
      await expect.poll(() => b.storedParent(b.cards[1]!.id), { timeout: 1000 }).toBe(b.hiddenA.id);
    } finally {
      await b.close();
    }
  });

  it('stores again a card hidden while a retried store was writing', async () => {
    const errors = storeErrors();
    const b = await hidingBoard('Hidden during a retry', undefined, 'manual');
    try {
      b.control.down = true;
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      b.fire();
      await expect.poll(() => errors.mock.calls.length > 0, { timeout: 1000 }).toBe(true);
      expect(b.stores()).toBe(2);
      // The retry (1 s later) reads the board, then waits on the write.
      b.control.hold();
      b.control.down = false;
      await expect.poll(() => b.control.waiting, { timeout: 3000 }).toBe(1);
      await b.set(b.cards[1]!.id, 'parent', b.hiddenA.id);
      // A board waiting for its retry arms no early store.
      expect(b.timers.size).toBe(0);
      b.control.release();
      await expect.poll(() => b.storedParent(b.cards[0]!.id), { timeout: 1000 }).toBe(b.hiddenA.id);
      await expect.poll(() => b.timers.size, { timeout: 1000 }).toBe(1);
      b.fire();
      await expect.poll(() => b.storedParent(b.cards[1]!.id), { timeout: 1000 }).toBe(b.hiddenA.id);
      expect(b.stores()).toBe(4);
    } finally {
      errors.mockRestore();
      await b.close();
    }
  });

  it('keeps the retry backoff, then no early store once the retry wrote the hiding', async () => {
    const errors = storeErrors();
    const b = await hidingBoard('Hidden during the backoff', undefined, 'manual');
    try {
      b.control.down = true;
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      b.fire();
      await expect.poll(() => errors.mock.calls.length > 0, { timeout: 1000 }).toBe(true);
      expect(b.stores()).toBe(2);
      // Hidden while the board waits for its retry (1 s): the retry stores it, not an early store.
      await b.set(b.cards[1]!.id, 'parent', b.hiddenA.id);
      expect(b.timers.size).toBe(0);
      expect(b.stores()).toBe(2);
      b.control.down = false;
      await expect.poll(() => b.storedParent(b.cards[1]!.id), { timeout: 3000 }).toBe(b.hiddenA.id);
      expect(b.stores()).toBe(3);
      expect(b.timers.size).toBe(0);
      // Later edits that hide nothing arm nothing.
      await b.set(b.shown.id, 'title', 'Renamed');
      expect(b.timers.size).toBe(0);
    } finally {
      errors.mockRestore();
      await b.close();
    }
  });

  it('sends no early store while a store that already read the hiding is writing', async () => {
    const b = await hidingBoard('Early store during a store', undefined, 'manual');
    try {
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      expect(b.timers.size).toBe(1);
      // An ordinary store reads the hidden card, then waits on the write; the timer runs then.
      b.control.hold();
      b.flush();
      await expect.poll(() => b.control.waiting, { timeout: 1000 }).toBe(1);
      b.fire();
      expect(b.immediate()).toBe(0);
      b.control.release();
      await expect.poll(b.finished, { timeout: 1000 }).toBe(2);
      expect(await b.storedParent(b.cards[0]!.id)).toBe(b.hiddenA.id);
      expect(b.stores()).toBe(2);
      expect(b.immediate()).toBe(0);
      expect(b.timers.size).toBe(0);
    } finally {
      await b.close();
    }
  });

  it('sends the early store once the store in flight wrote an older state', async () => {
    const b = await hidingBoard('Early store after a store', undefined, 'manual');
    try {
      b.control.hold();
      await b.set(b.shown.id, 'title', 'Renamed');
      b.flush();
      await expect.poll(() => b.control.waiting, { timeout: 1000 }).toBe(1);
      // Hidden after that store read the board: the timer runs before it commits.
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      b.fire();
      expect(b.immediate()).toBe(0);
      b.control.release();
      await expect.poll(() => b.timers.size, { timeout: 1000 }).toBe(1);
      expect(await b.storedParent(b.cards[0]!.id)).toBe(b.shown.id);
      b.fire();
      expect(b.immediate()).toBe(1);
      await expect.poll(() => b.storedParent(b.cards[0]!.id), { timeout: 1000 }).toBe(b.hiddenA.id);
      expect(b.stores()).toBe(3);
    } finally {
      await b.close();
    }
  });

  it('leaves a failed store to its retry, without an early store ahead of the backoff', async () => {
    const errors = storeErrors();
    const b = await hidingBoard('Early store and a failed store', undefined, 'manual');
    try {
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      b.control.hold();
      b.control.down = true;
      b.flush();
      await expect.poll(() => b.control.waiting, { timeout: 1000 }).toBe(1);
      b.fire();
      b.control.release();
      await expect.poll(() => errors.mock.calls.length > 0, { timeout: 1000 }).toBe(true);
      // The retry comes after its backoff (1 s), and nothing else in between.
      await pause(500);
      expect(b.stores()).toBe(2);
      expect(b.immediate()).toBe(0);
      expect(b.timers.size).toBe(0);
      b.control.down = false;
      await expect.poll(() => b.storedParent(b.cards[0]!.id), { timeout: 3000 }).toBe(b.hiddenA.id);
      expect(b.stores()).toBe(3);
    } finally {
      errors.mockRestore();
      await b.close();
    }
  });

  it('drops a pending early store once the last person left and the server shut down', async () => {
    const b = await hidingBoard('Early store at shutdown', undefined, 'manual');
    try {
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      const [pending] = b.timers;
      // Leaving stores the board at once; the shutdown then cancels what was left.
      await b.close();
      expect(await b.storedParent(b.cards[0]!.id)).toBe(b.hiddenA.id);
      expect(b.timers.size).toBe(0);
      const after = b.immediate();
      pending?.();
      expect(b.immediate()).toBe(after);
    } finally {
      await b.close();
    }
  });

  it('drops a pending early store at shutdown while a connection is still open', async () => {
    const b = await hidingBoard('Shutdown with a connection open', undefined, 'manual');
    try {
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      const [pending] = b.timers;
      await b.server.destroy();
      expect(await b.storedParent(b.cards[0]!.id)).toBe(b.hiddenA.id);
      expect(b.timers.size).toBe(0);
      const after = b.immediate();
      pending?.();
      expect(b.immediate()).toBe(after);
    } finally {
      await b.close();
    }
  });

  it('keeps no early store armed while a failed store waits for its retry', async () => {
    const errors = storeErrors();
    const b = await hidingBoard('Early store during the backoff', undefined, 'manual');
    try {
      b.control.down = true;
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      expect(b.timers.size).toBe(1);
      b.flush();
      await expect.poll(() => errors.mock.calls.length > 0, { timeout: 1000 }).toBe(true);
      expect(b.timers.size).toBe(0);
      b.control.down = false;
      await expect.poll(() => b.storedParent(b.cards[0]!.id), { timeout: 3000 }).toBe(b.hiddenA.id);
    } finally {
      errors.mockRestore();
      await b.close();
    }
  });

  it('arms the early store again after a timer that ran at once during a store', async () => {
    const b = await hidingBoard('Synchronous early-store timer', undefined, 'sync');
    try {
      b.control.hold();
      await b.set(b.shown.id, 'title', 'Renamed');
      b.flush();
      await expect.poll(() => b.control.waiting, { timeout: 1000 }).toBe(1);
      // Its timer runs at once, while the store is in flight: nothing is sent yet.
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      expect(b.immediate()).toBe(0);
      b.control.release();
      await expect.poll(() => b.storedParent(b.cards[0]!.id), { timeout: 1000 }).toBe(b.hiddenA.id);
      expect(b.immediate()).toBe(1);
    } finally {
      await b.close();
    }
  });

  it('does not store a frozen board early', async () => {
    const capped = { ...limits, freeze: true };
    const b = await hidingBoard('Frozen board', capped, 'manual');
    try {
      // The next store finds the board past the cap and freezes it.
      capped.stateBytes = 1;
      await b.set(b.shown.id, 'title', 'Renamed');
      b.flush();
      await expect.poll(b.finished, { timeout: 1000 }).toBe(2);
      await b.set(b.cards[0]!.id, 'parent', b.hiddenA.id);
      expect(b.timers.size).toBe(0);
      expect(b.immediate()).toBe(0);
    } finally {
      await b.close();
    }
  });

  /** A board of its own and the ids of the cards its stored document holds. */
  async function freshBoard(name: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('owner'),
      payload: { name },
    });
    const id: string = created.json().rootBoardId;
    const storedIds = async () => {
      const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, id));
      const doc = new Y.Doc();
      if (row) Y.applyUpdate(doc, row.state);
      return [...doc.getMap('elements').keys()];
    };
    const edit = async (server: typeof collab, title: string) => {
      const el = column(title);
      const connection = await server.hocuspocus.openDirectConnection(boardDocName(id));
      await connection.transact((doc) => addElement(doc, el));
      await connection.disconnect();
      return el.id;
    };
    return { id, name: boardDocName(id), storedIds, edit };
  }

  it('refuses the stores of a collab process a newer one took over from, stops it, and merges what it kept (F-24)', async () => {
    const board = await freshBoard('Two holders');
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-unsaved-'));
    const newerStopped = vi.fn();
    const logged = vi.spyOn(log, 'error');
    let stopping: Promise<void> | undefined;
    const old: typeof collab = createCollabServer({
      db,
      auth,
      log,
      publicUrl: config.PUBLIC_URL,
      unsavedDir: dir,
      // As main.ts: the process shuts down, which stores (or keeps on disk) what it holds.
      fence: {
        epoch: await takeCollabEpoch(db),
        onStale: () => {
          stopping = old.destroy();
        },
      },
    });
    let newer: typeof collab | undefined;
    try {
      // The only holder stores as before.
      const first = await board.edit(old, 'Before the takeover');
      await expect.poll(board.storedIds, { timeout: 5000 }).toContain(first);
      // Cut off from Valkey, it keeps running while a newer process takes the lease. Both use
      // one data folder, as a container started again on its volume.
      newer = createCollabServer({
        db,
        auth,
        log,
        publicUrl: config.PUBLIC_URL,
        unsavedDir: dir,
        drainMs: 200,
        fence: { epoch: await takeCollabEpoch(db), onStale: newerStopped },
      });
      const kept = await board.edit(newer, 'Written by the new holder');
      await expect.poll(board.storedIds, { timeout: 5000 }).toContain(kept);
      const lost = await board.edit(old, 'Written by the old holder');
      // Refused, logged once, and the old process stops: its board goes to disk.
      await vi.waitFor(() => expect(stopping).toBeDefined(), { timeout: 5000 });
      await stopping;
      expect(
        logged.mock.calls.filter(([, msg]) => String(msg).includes('another collab process took')),
      ).toHaveLength(1);
      expect(old.hocuspocus.documents.size).toBe(0);
      // The newer process merges it into the board it serves, without a restart.
      await expect
        .poll(board.storedIds, { timeout: 5000 })
        .toEqual(expect.arrayContaining([first, kept, lost]));
      await expect.poll(() => readdirSync(dir), { timeout: 5000 }).toEqual([]);
      expect(newerStopped).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      await old.destroy();
      await newer?.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses connections, edits and versions once superseded, without asking the database (F-24)', async () => {
    const board = await freshBoard('Superseded');
    const stale = vi.fn();
    const old = createCollabServer({
      db,
      auth,
      log,
      publicUrl: config.PUBLIC_URL,
      fence: { epoch: await takeCollabEpoch(db), onStale: stale },
    });
    const saved = await directVersionWriter(collab, db, log).save({
      boardId: board.id,
      name: 'Before',
      userId: people.owner?.id ?? '',
    });
    if (!saved.ok) throw new Error('version not saved');
    const writes = vi.spyOn(db, 'transaction');
    const http = createServer();
    try {
      // Served under /collab by an HTTP server of its own, as in the all-in-one mode.
      attachCollab(http, old);
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      await takeCollabEpoch(db);
      const lost = await board.edit(old, 'Refused');
      await vi.waitFor(() => expect(stale).toHaveBeenCalledOnce());
      expect(old.isSuperseded()).toBe(true);
      expect(old.hocuspocus.documents.has(board.name)).toBe(true);
      // Later stores do not reach the database.
      writes.mockClear();
      await board.edit(old, 'Refused again');
      await new Promise((r) => setTimeout(r, 300));
      expect(writes).not.toHaveBeenCalled();
      expect(await board.storedIds()).not.toContain(lost);
      // A new socket is refused at the upgrade, so its client reconnects (to the newer one).
      const socket = new WebSocket(`ws://127.0.0.1:${(http.address() as AddressInfo).port}/collab`);
      await new Promise<void>((resolve) => {
        socket.on('error', () => resolve());
        socket.on('close', () => resolve());
      });
      expect(socket.readyState).not.toBe(WebSocket.OPEN);
      // Clips and restores say they did not happen.
      expect(
        await directBoardWriter(old).addCard({
          boardId: board.id,
          userId: people.owner?.id ?? '',
          card: { type: 'note', fields: {} },
        }),
      ).toEqual({ ok: false, reason: 'expired' });
      const versions = directVersionWriter(old, db, log);
      expect(
        await versions.save({ boardId: board.id, name: 'v', userId: people.owner?.id ?? '' }),
      ).toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(
        await versions.restore({
          boardId: board.id,
          versionId: saved.versionId,
          userId: people.owner?.id ?? '',
        }),
      ).toEqual({ ok: false, reason: 'expired' });
    } finally {
      writes.mockRestore();
      http.close();
      await old.destroy();
    }
  });

  it('refuses the index write of a store when a newer process took over in between (F-24)', async () => {
    const board = await freshBoard('Index in between');
    const stale = vi.fn();
    const logged = vi.spyOn(log, 'error');
    // The takeover lands between the store's transaction and the index's.
    let stores = 0;
    const between = new Proxy(db, {
      get(target, key) {
        if (key === 'transaction')
          return async (fn: (tx: unknown) => unknown, ...rest: unknown[]) => {
            stores += 1;
            if (stores === 2) await takeCollabEpoch(db);
            return (target.transaction as (...a: unknown[]) => unknown)(fn, ...rest);
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const old = createCollabServer({
      db: between,
      auth,
      log,
      publicUrl: config.PUBLIC_URL,
      fence: { epoch: await takeCollabEpoch(db), onStale: stale },
    });
    try {
      const id = await board.edit(old, 'Stored, not indexed');
      await vi.waitFor(() => expect(stale).toHaveBeenCalledOnce());
      expect(await board.storedIds()).toContain(id);
      const indexed = await db
        .select()
        .from(boardElementIndex)
        .where(eq(boardElementIndex.boardId, board.id));
      expect(indexed.map((r) => r.elementId)).not.toContain(id);
      expect(logged).not.toHaveBeenCalledWith(expect.anything(), 'board search index not updated');
    } finally {
      logged.mockRestore();
      await old.destroy();
    }
  });

  it('refuses to replay boards kept on disk for a process a newer one took over from', async () => {
    const board = await freshBoard('Replay refused');
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-unsaved-'));
    try {
      const doc = new Y.Doc();
      addElement(doc, column('Kept'));
      writeFileSync(join(dir, `${board.id}.yupdate`), Y.encodeStateAsUpdate(doc));
      const current = await takeCollabEpoch(db);
      await expect(replayUnsavedBoards(db, dir, log, current - 1)).rejects.toThrow(
        StaleCollabEpochError,
      );
      expect(readdirSync(dir)).toEqual([`${board.id}.yupdate`]);
      await replayUnsavedBoards(db, dir, log, current);
      expect(readdirSync(dir)).toEqual([]);
      expect(await board.storedIds()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a version or a restore whose first write meets a newer process (F-24)', async () => {
    const board = await freshBoard('Versions in between');
    const userId = people.owner?.id ?? '';
    const saved = await directVersionWriter(collab, db, log).save({
      boardId: board.id,
      name: 'Before',
      userId,
    });
    if (!saved.ok) throw new Error('version not saved');
    const versionsOf = async (kind: 'named' | 'restore') =>
      (await db.select().from(boardVersion).where(eq(boardVersion.boardId, board.id))).filter(
        (v) => v.kind === kind,
      ).length;
    const named = await versionsOf('named');
    for (const op of ['save', 'restore'] as const) {
      const stale = vi.fn();
      const old = createCollabServer({
        db,
        auth,
        log,
        publicUrl: config.PUBLIC_URL,
        fence: { epoch: await takeCollabEpoch(db), onStale: stale },
      });
      try {
        // A newer process took over; this one has not seen it yet.
        await takeCollabEpoch(db);
        expect(old.isSuperseded()).toBe(false);
        const versions = directVersionWriter(old, db, log);
        const result =
          op === 'save'
            ? await versions.save({ boardId: board.id, name: 'Stale', userId })
            : await versions.restore({ boardId: board.id, versionId: saved.versionId, userId });
        expect(result).toEqual({ ok: false, reason: 'expired' });
        expect(stale).toHaveBeenCalledOnce();
        expect(await versionsOf('named')).toBe(named);
        expect(await versionsOf('restore')).toBe(0);
      } finally {
        await old.destroy();
      }
    }
  });

  for (const mode of ['direct', 'split'] as const)
    it.skipIf(mode === 'split' && !process.env.REDIS_URL)(
      `says a restore refused only at its record has an unknown outcome, in ${mode} mode (F-24)`,
      async () => {
        const board = await freshBoard(`Restore record refused ${mode}`);
        const userId = people.owner?.id ?? '';
        const saved = await directVersionWriter(collab, db, log).save({
          boardId: board.id,
          name: 'Before',
          userId,
        });
        if (!saved.ok) throw new Error('version not saved');
        await board.edit(collab, 'After the version');
        const old = createCollabServer({
          db,
          auth,
          log,
          publicUrl: config.PUBLIC_URL,
          fence: { epoch: await takeCollabEpoch(db), onStale: vi.fn() },
        });
        // The takeover lands after the restore's backup, before its record.
        let writes = 0;
        const between = new Proxy(db, {
          get(target, key) {
            if (key === 'transaction')
              return async (fn: (tx: unknown) => unknown, ...rest: unknown[]) => {
                writes += 1;
                if (writes === 2) await takeCollabEpoch(db);
                return (target.transaction as (...a: unknown[]) => unknown)(fn, ...rest);
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const versions = directVersionWriter(old, between, log);
        const redisUrl = process.env.REDIS_URL ?? '';
        const prefix = `inkadra-restore-unknown-${randomUUID()}`;
        const worker =
          mode === 'split'
            ? startBoardWorker(redisUrl, directBoardWriter(old), log, { prefix, versions })
            : undefined;
        const queued = mode === 'split' ? queuedBoardWriter(redisUrl, { prefix }) : undefined;
        try {
          const restoring = (queued?.versions ?? versions).restore({
            boardId: board.id,
            versionId: saved.versionId,
            userId,
          });
          await expect(restoring).rejects.toThrow(CardOutcomeUnknown);
          expect(old.isSuperseded()).toBe(true);
        } finally {
          await queued?.close();
          await worker?.close();
          await old.destroy();
        }
      },
    );

  it.skipIf(!process.env.REDIS_URL)(
    'answers a clip through the queue as expired once superseded, so its files go (F-24)',
    async () => {
      const board = await freshBoard('Clip to a superseded process');
      const old = createCollabServer({
        db,
        auth,
        log,
        publicUrl: config.PUBLIC_URL,
        fence: { epoch: await takeCollabEpoch(db), onStale: vi.fn() },
      });
      const redisUrl = process.env.REDIS_URL ?? '';
      const prefix = `inkadra-superseded-${randomUUID()}`;
      const worker = startBoardWorker(redisUrl, directBoardWriter(old), log, { prefix });
      const queued = queuedBoardWriter(redisUrl, { prefix });
      try {
        await takeCollabEpoch(db);
        await board.edit(old, 'Refused');
        await vi.waitFor(() => expect(old.isSuperseded()).toBe(true));
        expect(
          await queued.writer.addCard({
            boardId: board.id,
            userId: people.owner?.id ?? '',
            card: { type: 'note', fields: {} },
          }),
        ).toEqual({ ok: false, reason: 'expired' });
      } finally {
        await queued.close();
        await worker.close();
        await old.destroy();
      }
    },
  );

  describe('boards kept on disk by another collab process (F-24)', () => {
    let dir = '';
    let server: typeof collab | undefined;
    afterEach(async () => {
      await server?.destroy();
      server = undefined;
      rmSync(dir, { recursive: true, force: true });
    });
    // The demo's caps, small: one card at most.
    const demo = { freeze: true, maxPayload: 1024 * 1024, elements: 1, stateBytes: 1024 * 1024 };
    const serve = (opts: { db?: typeof db; limits?: typeof demo } = {}) => {
      dir = mkdtempSync(join(tmpdir(), 'inkadra-unsaved-'));
      server = createCollabServer({
        db: opts.db ?? db,
        auth,
        log,
        publicUrl: config.PUBLIC_URL,
        unsavedDir: dir,
        drainMs: 100,
        ...(opts.limits ? { limits: opts.limits } : {}),
      });
      return server;
    };
    const kept = (title: string) => {
      const doc = new Y.Doc();
      const el = column(title);
      addElement(doc, el);
      return { id: el.id, update: Y.encodeStateAsUpdate(doc) };
    };

    it('removes a merged file only once the stored board holds it', async () => {
      const board = await freshBoard('Merged after the store');
      let down = true;
      serve({ db: failingInserts(db, () => down) });
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const card = kept('Kept by the old process');
        writeFileSync(join(dir, `${board.id}.yupdate`), card.update);
        // Merged into the live board, whose store fails: the file stays, being merged.
        await vi.waitFor(
          () => expect(readdirSync(dir)).toEqual([expect.stringMatching(/\.draining$/)]),
          { timeout: 5000 },
        );
        await new Promise((r) => setTimeout(r, 2500));
        expect(readdirSync(dir)).toEqual([expect.stringMatching(/\.draining$/)]);
        expect(await board.storedIds()).not.toContain(card.id);
        down = false;
        await expect.poll(board.storedIds, { timeout: 10_000 }).toContain(card.id);
        await expect.poll(() => readdirSync(dir), { timeout: 5000 }).toEqual([]);
      } finally {
        down = false;
        errors.mockRestore();
      }
    });

    it('drops the file of a deleted board, and leaves a file that is not an update', async () => {
      serve();
      const gone = randomUUID();
      const other = randomUUID();
      writeFileSync(join(dir, `${gone}.yupdate`), kept('Of a deleted board').update);
      writeFileSync(join(dir, `${other}.yupdate`), Buffer.from('not a Yjs update'));
      await expect
        .poll(() => readdirSync(dir), { timeout: 10_000 })
        .toEqual([expect.stringMatching(new RegExp(`^${other}\\..*\\.unreadable$`))]);
    });

    it('tells a stored board that holds a merged file, deletions and items held back included', async () => {
      const board = await freshBoard('Held back');
      const store = (state: Uint8Array) =>
        db
          .insert(boardDoc)
          .values({ boardId: board.id, state, schemaVersion: 1, size: state.byteLength })
          .onConflictDoUpdate({ target: boardDoc.boardId, set: { state, size: state.byteLength } });
      const doc = (...updates: Uint8Array[]) => {
        const d = new Y.Doc();
        for (const u of updates) Y.applyUpdate(d, u);
        return d;
      };
      const base = Y.encodeStateAsUpdate(doc(kept('Stored').update));
      await store(base);
      // A deletion of an item the stored board lacks: Yjs holds it back (a pending deletion).
      const other = new Y.Doc();
      addElement(other, column('Elsewhere'));
      other.getMap('elements').clear();
      const deletion = Y.encodeStateAsUpdate(other, Y.encodeStateVector(other));
      expect(await storedHolds(db, board.id, deletion)).toBe('no');
      await store(Y.encodeStateAsUpdate(doc(base, deletion)));
      expect(await storedHolds(db, board.id, deletion)).toBe('yes');
      // A stored board that already holds items back (they wait for one never received).
      const writer = new Y.Doc();
      addElement(writer, column('First'));
      const first = Y.encodeStateVector(writer);
      addElement(writer, column('Second'));
      const waiting = Y.encodeStateAsUpdate(doc(base, Y.encodeStateAsUpdate(writer, first)));
      await store(waiting);
      expect(await storedHolds(db, board.id, waiting)).toBe('yes');
      expect(await storedHolds(db, board.id, Y.encodeStateAsUpdate(writer))).toBe('no');
    });

    it('drops, in the demo, a file that would take its board past the caps', async () => {
      const board = await freshBoard('Demo caps');
      serve({ limits: demo });
      const doc = new Y.Doc();
      addElement(doc, column('One'));
      addElement(doc, column('Two'));
      writeFileSync(join(dir, `${board.id}.yupdate`), Y.encodeStateAsUpdate(doc));
      await expect.poll(() => readdirSync(dir), { timeout: 5000 }).toEqual([]);
      expect(await board.storedIds()).toHaveLength(0);
      // The replay at a start respects them too, and leaves a file that is not an update.
      const again = join(dir, `${board.id}.${randomUUID()}.draining`);
      writeFileSync(again, Y.encodeStateAsUpdate(doc));
      writeFileSync(join(dir, `${board.id}.yupdate`), Buffer.from('not a Yjs update'));
      await replayUnsavedBoards(db, dir, log, undefined, demo);
      expect(readdirSync(dir)).toEqual([expect.stringMatching(/\.unreadable$/)]);
      expect(await board.storedIds()).toHaveLength(0);
    });

    it('replays at the next start a file the last run was merging when it stopped', async () => {
      const board = await freshBoard('Merging at the crash');
      dir = mkdtempSync(join(tmpdir(), 'inkadra-unsaved-'));
      const card = kept('Being merged');
      writeFileSync(join(dir, `${board.id}.${randomUUID()}.draining`), card.update);
      await replayUnsavedBoards(db, dir, log);
      expect(await board.storedIds()).toContain(card.id);
      expect(readdirSync(dir)).toEqual([]);
    });
  });

  it('keeps a board on disk when its store hangs at shutdown', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('owner'),
      payload: { name: 'Hung database' },
    });
    const hungBoard: string = created.json().rootBoardId;
    const name = boardDocName(hungBoard);
    let hung = false;
    // A database that stopped answering: the store's transaction never settles.
    const stuck = new Proxy(db, {
      get(target, key) {
        if (key === 'transaction' && hung) return () => new Promise(() => {});
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-unsaved-'));
    // Odd periods pick out the server's own intervals among everything else running.
    const periods = [4321, 4322];
    const intervals: unknown[] = [];
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const other = createCollabServer({
      db: stuck,
      auth,
      log,
      publicUrl: config.PUBLIC_URL,
      unsavedDir: dir,
      recheckMs: periods[0],
      keepaliveMs: periods[1],
    });
    const connection = await other.hocuspocus.openDirectConnection(name);
    hung = true;
    await connection.transact((doc) => addElement(doc, column('Hung')));
    const started = Date.now();
    await other.destroy();
    expect(Date.now() - started).toBeLessThan(SHUTDOWN_STORE_MS + 3000);
    expect(readdirSync(dir)).toEqual([`${hungBoard}.yupdate`]);
    // The board never unloaded, so Hocuspocus's onDestroy never ran: the server's own shutdown
    // still stops the access recheck and the keepalive.
    setSpy.mock.calls.forEach((args, i) => {
      if (periods.includes(args[1] as number)) intervals.push(setSpy.mock.results[i]?.value);
    });
    expect(intervals).toHaveLength(2);
    const cleared = clearSpy.mock.calls.map(([handle]) => handle);
    for (const handle of intervals) expect(cleared).toContain(handle);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it.each([
    ['anonymous connections', {}, undefined],
    ['other origins', 'OWNER', 'https://evil.example.com'],
    ['unknown tokens', { token: 'ink_not-a-real-token-at-all-0123456789' }, undefined],
  ] as const)('refuses %s', async (_label, credentials, origin) => {
    const c = connect(credentials === 'OWNER' ? as('owner') : credentials, origin);
    const failed = await new Promise<boolean>((resolve) => {
      c.provider.on('authenticationFailed', () => resolve(true));
      setTimeout(() => resolve(false), 4000);
    });
    c.close();
    expect(failed).toBe(true);
  });

  it('tells a client that asks a lost access and a signed-out session apart (#791)', async () => {
    const reasonOf = async (c: ReturnType<typeof connect>) => {
      try {
        return await new Promise<string | null>((resolve) => {
          c.provider.on('authenticationFailed', ({ reason }: { reason: string }) =>
            resolve(reason),
          );
          setTimeout(() => resolve(null), 4000);
        });
      } finally {
        c.close();
      }
    };
    await signUp('outsider');
    const asks = (credentials: { cookie?: string }) =>
      connect(credentials, undefined, CURRENT_SCHEMA_VERSION, boardId, '&reasons=1');
    // The client deletes its copy of the board only for `Forbidden`.
    expect(await reasonOf(asks(as('outsider')))).toBe('Forbidden');
    expect(await reasonOf(asks({}))).toBe('Unauthorized');
    // A client that does not ask keeps the generic refusal it knows.
    expect(await reasonOf(connect(as('outsider')))).toBe('permission-denied');
  });

  it('keeps viewers read-only on the WebSocket', async () => {
    const owner = connect(as('owner'));
    const viewer = connect(as('viewer'));
    await Promise.all([owner.synced, viewer.synced]);
    const scope = await new Promise<string>((resolve) => {
      if (viewer.provider.authorizedScope) resolve(viewer.provider.authorizedScope);
      viewer.provider.on('authenticated', ({ scope }: { scope: string }) => resolve(scope));
    });
    expect(scope).toBe('readonly');

    const forged = column('Forged');
    addElement(viewer.doc, forged);
    const real = column('Real');
    addElement(owner.doc, real);
    // The owner's change reaches the viewer; the viewer's never reaches anyone.
    await expect.poll(() => roots(viewer.doc).elements.has(real.id), { timeout: 5000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(roots(owner.doc).elements.has(forged.id)).toBe(false);
    const fresh = connect(as('editor'));
    await fresh.synced;
    expect(roots(fresh.doc).elements.has(forged.id)).toBe(false);
    for (const c of [owner, viewer, fresh]) c.close();
  });

  it('downgrades a live schema without claiming the role changed', async () => {
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: as('owner'),
      payload: { name: 'Future schema' },
    });
    const id = project.json().rootBoardId;
    const current = connect(as('owner'), undefined, CURRENT_SCHEMA_VERSION, id);
    const future = connect(as('owner'), undefined, CURRENT_SCHEMA_VERSION + 1, id);
    await Promise.all([current.synced, future.synced]);
    const notices: unknown[] = [];
    current.provider.on('stateless', ({ payload }: { payload: string }) =>
      notices.push(JSON.parse(payload)),
    );
    roots(future.doc).meta.set('schemaVersion', CURRENT_SCHEMA_VERSION + 1);
    await expect
      .poll(() => roots(current.doc).meta.get('schemaVersion'))
      .toBe(CURRENT_SCHEMA_VERSION + 1);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(notices).toEqual([]);
    const forged = column('Refused schema write');
    addElement(current.doc, forged);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(roots(future.doc).elements.has(forged.id)).toBe(false);
    current.close();
    future.close();
  });

  it('prepares drawings on load but never rescans them for card updates', async () => {
    const editor = connect(as('owner'));
    const peer = connect(as('owner'));
    await Promise.all([editor.synced, peer.synced]);
    const prepare = vi.spyOn(drawings, 'prepareImageDrawings');
    try {
      const el = column('Dragged without drawing scan');
      addElement(editor.doc, el);
      await expect.poll(() => roots(peer.doc).elements.has(el.id)).toBe(true);
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
      editor.close();
      peer.close();
    }
  });

  it.each([null, 15])(
    'keeps stale editor schema %s read-only even after role rechecks',
    async (schemaVersion) => {
      const current = connect(as('owner'));
      const legacy = connect(as('editor'), undefined, schemaVersion);
      await Promise.all([current.synced, legacy.synced]);
      expect(legacy.provider.authorizedScope).toBe('readonly');
      const forged = column('Stale writer');
      addElement(legacy.doc, forged);
      const real = column('Current writer');
      addElement(current.doc, real);
      await expect.poll(() => roots(legacy.doc).elements.has(real.id)).toBe(true);
      expect(roots(current.doc).elements.has(forged.id)).toBe(false);
      // The test server rechecks every 200 ms. A permission refresh must not re-enable this client.
      await new Promise((resolve) => setTimeout(resolve, 450));
      const another = column('Still stale');
      addElement(legacy.doc, another);
      const fresh = connect(as('owner'));
      await fresh.synced;
      expect(roots(fresh.doc).elements.has(another.id)).toBe(false);
      current.close();
      legacy.close();
      fresh.close();
    },
  );

  it('signs in with a personal token', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/me/tokens',
      headers: as('editor'),
      payload: { name: 'Mobile' },
    });
    const c = connect({ token: created.json().token });
    await c.synced;
    expect(c.provider.isAuthenticated).toBe(true);

    // Revoking the token ends the connection at the next check.
    const closed = closedWith(c);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/tokens/${created.json().id}`,
      headers: as('editor'),
    });
    expect(await closed).toBe('Unauthorized');
    c.close();
  });

  it("refuses the Clipper's limited token and keeps app tokens (decision 0137)", async () => {
    const owner = people.owner?.id ?? '';
    /** How the sign-in ended; a timeout is neither, and fails the test. */
    const outcome = (c: ReturnType<typeof connect>) =>
      new Promise<'refused' | 'synced' | 'timeout'>((resolve) => {
        c.provider.on('authenticationFailed', () => resolve('refused'));
        c.provider.on('synced', () => resolve('synced'));
        setTimeout(() => resolve('timeout'), 4000);
      });
    const clip = await issueToken(db, owner, { name: 'Clipper', client: 'clipper' });
    const clipper = connect({ token: clip.token });
    expect(await outcome(clipper)).toBe('refused');
    clipper.close();
    // A refused sign-in does not count as a use of the token.
    const [row] = await db.select().from(personalToken).where(eq(personalToken.id, clip.row.id));
    expect(row?.lastUsedAt).toBeNull();
    const phone = await issueToken(db, owner, { name: 'Phone', client: 'mobile' });
    const mobile = connect({ token: phone.token });
    expect(await outcome(mobile)).toBe('synced');
    expect(mobile.provider.isAuthenticated).toBe(true);
    mobile.close();
  });

  it('closes the connection when the person signs out', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: 'viewer@example.com', password: 'correct-horse-battery' },
    });
    const cookie = String(res.headers['set-cookie']).split(';')[0] ?? '';
    const c = connect({ cookie });
    await c.synced;
    const closed = closedWith(c);
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: config.PUBLIC_URL },
      payload: {},
    });
    expect(await closed).toBe('Unauthorized');
    c.close();
  });

  it('keeps the connection of the session that changes the password, and closes the others', async () => {
    await signUp('changer');
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/members/${people.changer?.id}`,
      headers: as('owner'),
      payload: { role: 'editor' },
    });
    const signIn = async () =>
      String(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/sign-in/email',
            headers: { origin: config.PUBLIC_URL },
            payload: { email: 'changer@example.com', password: 'correct-horse-battery' },
          })
        ).headers['set-cookie'],
      ).split(';')[0] ?? '';
    const current = people.changer?.cookie ?? '';
    const other = await signIn();
    const here = connect({ cookie: current });
    const elsewhere = connect({ cookie: other });
    await Promise.all([here.synced, elsewhere.synced]);
    const hereClosed = closedWith(here);
    const elsewhereClosed = closedWith(elsewhere);
    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: current, origin: config.PUBLIC_URL },
      payload: {
        currentPassword: 'correct-horse-battery',
        newPassword: 'another-correct-horse',
        revokeOtherSessions: true,
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(await elsewhereClosed).toBe('Unauthorized');
    expect(await hereClosed).toBeNull();
    // The tab that changed the password keeps editing with the cookie it already has.
    const el = column('After password change');
    addElement(here.doc, el);
    const peer = connect(as('owner'));
    await peer.synced;
    await expect.poll(() => roots(peer.doc).elements.has(el.id), { timeout: 5000 }).toBe(true);
    for (const c of [here, elsewhere, peer]) c.close();
  });

  it('stamps presence with the signed-in person', async () => {
    const a = connect(as('editor'));
    const b = connect(as('viewer'));
    await Promise.all([a.synced, b.synced]);
    a.provider.awareness?.setLocalState({
      user: { id: people.owner?.id, name: 'Someone else', image: null },
      readOnly: false,
      cursor: { x: 120, y: -40 },
      selection: [],
      editing: null,
    });
    await expect
      .poll(
        () =>
          [...(b.provider.awareness?.getStates().values() ?? [])]
            .map(readPresence)
            .find((p) => p?.cursor?.x === 120)?.user,
        { timeout: 5000 },
      )
      .toEqual({ id: people.editor?.id, name: 'editor', image: null });
    a.close();
    b.close();
  });

  it('keeps a connection to eight presence ids for as long as it is open', async () => {
    const a = connect(as('editor'));
    const c = connect(as('viewer'));
    await Promise.all([a.synced, c.synced]);
    const live = () => collab.hocuspocus.documents.get(boardDocName(boardId))!.awareness;
    const cursorOf = (id: number) =>
      (live().getStates().get(id) as { cursor?: { x: number } })?.cursor?.x;
    const seenByPeer = (id: number) =>
      (c.provider.awareness?.getStates().get(id) as { cursor?: { x: number } })?.cursor?.x;
    /** Sends one frame of presence states (null removes one) under the given ids and clocks. */
    const send = (
      conn: typeof a,
      changes: Array<[id: number, clock: number, x: number | null]>,
    ) => {
      const aw = conn.provider.awareness!;
      for (const [id, clock, x] of changes) {
        if (x === null) aw.states.delete(id);
        else aw.states.set(id, { cursor: { x, y: 0 }, selection: [], editing: null });
        aw.meta.set(id, { clock, lastUpdated: Date.now() });
      }
      const ids = changes.map(([id]) => id);
      aw.emit('update', [{ added: [], updated: ids, removed: [] }, 'local']);
    };
    const settle = () => new Promise((r) => setTimeout(r, 300));
    // The cap: eight ids, the rest of the frame dropped.
    send(
      a,
      [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009].map((id) => [id, 1, id]),
    );
    await expect.poll(() => cursorOf(1008), { timeout: 5000 }).toBe(1008);
    await settle();
    expect(cursorOf(1009)).toBeUndefined();
    // A frame mixing an owned id with new ones: the owned one passes, the new ones do not.
    send(a, [
      [1001, 2, 11],
      [1010, 1, 1010],
    ]);
    await expect.poll(() => cursorOf(1001), { timeout: 5000 }).toBe(11);
    await settle();
    expect(cursorOf(1010)).toBeUndefined();
    // Removed and published again: still its own, and shown.
    send(a, [[1002, 2, null]]);
    await expect.poll(() => cursorOf(1002), { timeout: 5000 }).toBeUndefined();
    // Another connection can't take it while its owner is connected.
    send(c, [[1002, 9, 99]]);
    await settle();
    expect(cursorOf(1002)).toBeUndefined();
    send(a, [[1002, 3, 22]]);
    await expect.poll(() => cursorOf(1002), { timeout: 5000 }).toBe(22);
    await expect.poll(() => seenByPeer(1001), { timeout: 5000 }).toBe(11);
    // The connection drops without a word: its presence goes for everyone, its ids are free.
    a.websocketProvider.shouldConnect = false;
    (a.websocketProvider.webSocket as unknown as WebSocket).terminate();
    await expect.poll(() => cursorOf(1001), { timeout: 5000 }).toBeUndefined();
    await expect.poll(() => seenByPeer(1001), { timeout: 5000 }).toBeUndefined();
    send(c, [[1001, 10, 70]]);
    await expect.poll(() => cursorOf(1001), { timeout: 5000 }).toBe(70);
    a.close();
    c.close();
  });

  it('shows every provider of a board on a socket opened first without a session', async () => {
    // Hocuspocus hands the frames of the session-aware providers to the session-less connection
    // until their own exists: up to three ids on one connection, all of them shown.
    const a = connect(as('editor'));
    await a.synced;
    const peer = connect(as('viewer'));
    await peer.synced;
    const presence = (x: number) => ({ cursor: { x, y: 0 }, selection: [], editing: null });
    const sessions = [1, 2].map(() => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        websocketProvider: a.websocketProvider,
        name: boardDocName(boardId),
        document: doc,
        sessionAwareness: true,
      });
      provider.attach();
      return { doc, provider };
    });
    a.provider.awareness?.setLocalState(presence(1));
    for (const [i, s] of sessions.entries()) s.provider.awareness?.setLocalState(presence(2 + i));
    const ids = [a.doc.clientID, ...sessions.map((s) => s.doc.clientID)];
    const cursorOf = (id: number) =>
      (peer.provider.awareness?.getStates().get(id) as { cursor?: { x: number } })?.cursor?.x;
    await expect.poll(() => ids.map(cursorOf), { timeout: 5000 }).toEqual([1, 2, 3]);
    for (const s of sessions) {
      s.provider.destroy();
      s.doc.destroy();
    }
    a.close();
    peer.close();
  });

  it('counts presence ids per document session, several on one socket', async () => {
    // A socket of its own: Hocuspocus hands the messages of a session to a connection of the
    // same board without one, so the board is opened only in sessions on it.
    const socket = connect(as('editor'));
    await socket.synced;
    socket.provider.destroy();
    const peer = connect(as('viewer'));
    await peer.synced;
    const presence = (x: number) => ({ cursor: { x, y: 0 }, selection: [], editing: null });
    const sessions = [1, 2, 3].map(() => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        websocketProvider: socket.websocketProvider,
        name: boardDocName(boardId),
        document: doc,
        sessionAwareness: true,
      });
      provider.attach();
      return { doc, provider };
    });
    for (const [i, s] of sessions.entries()) s.provider.awareness?.setLocalState(presence(1 + i));
    const ids = sessions.map((s) => s.doc.clientID);
    const cursorOf = (id: number) =>
      (peer.provider.awareness?.getStates().get(id) as { cursor?: { x: number } })?.cursor?.x;
    // Three sessions of one board on one socket: each publishes its own id.
    await expect.poll(() => ids.map(cursorOf), { timeout: 5000 }).toEqual([1, 2, 3]);
    // Closing one session leaves the others, which still update their presence.
    sessions[0]!.provider.destroy();
    await expect.poll(() => cursorOf(ids[0]!), { timeout: 5000 }).toBeUndefined();
    sessions[1]!.provider.awareness?.setLocalState(presence(20));
    sessions[2]!.provider.awareness?.setLocalState(presence(30));
    await expect
      .poll(() => [cursorOf(ids[1]!), cursorOf(ids[2]!)], { timeout: 5000 })
      .toEqual([20, 30]);
    for (const s of sessions) {
      s.provider.destroy();
      s.doc.destroy();
    }
    socket.close();
    peer.close();
  });

  it('keeps a lone client connected while nobody else writes', async () => {
    const alone = connect(as('editor'));
    await alone.synced;
    // The provider drops a socket that hears nothing for this long (30 s in the app), checked
    // every 3 s: with nobody else on the board, only the server's keepalive speaks.
    alone.websocketProvider.configuration.messageReconnectTimeout = 1500;
    let dropped = false;
    alone.provider.on('disconnect', () => {
      dropped = true;
    });
    await new Promise((r) => setTimeout(r, 7000));
    expect(dropped).toBe(false);
    alone.close();
  }, 15_000);

  it('keeps a viewer from appearing to be typing', async () => {
    const editor = connect(as('editor'));
    const viewer = connect(as('viewer'));
    await Promise.all([editor.synced, viewer.synced]);
    const state = { cursor: null, selection: [], editing: 'noteAAAAAAAAA', typing: true };
    editor.provider.awareness?.setLocalState({ ...state, cursor: { x: 7, y: 7 } });
    viewer.provider.awareness?.setLocalState({ ...state, cursor: { x: 9, y: 9 } });
    const seenBy = (c: typeof editor, x: number) =>
      [...(c.provider.awareness?.getStates().values() ?? [])]
        .map(readPresence)
        .find((p) => p?.cursor?.x === x)?.typing;
    await expect.poll(() => seenBy(editor, 9), { timeout: 5000 }).toBe(false);
    await expect.poll(() => seenBy(viewer, 7), { timeout: 5000 }).toBe(true);
    editor.close();
    viewer.close();
  });

  it('closes the connection when access is removed and applies a lower role', async () => {
    const editor = connect(as('editor'));
    await editor.synced;
    const notices: unknown[] = [];
    editor.provider.on('stateless', ({ payload }: { payload: string }) =>
      notices.push(JSON.parse(payload)),
    );
    // Demoted to viewer: within a recheck the connection turns read-only.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/members/${people.editor?.id}`,
      headers: as('owner'),
      payload: { role: 'viewer' },
    });
    await new Promise((r) => setTimeout(r, 600));
    const forged = column('After demotion');
    addElement(editor.doc, forged);
    await new Promise((r) => setTimeout(r, 300));
    const check = connect(as('owner'));
    await check.synced;
    expect(roots(check.doc).elements.has(forged.id)).toBe(false);
    // The client was told, so its editor turns read-only too, and why its edit was refused.
    expect(notices).toEqual([
      { type: 'access', readOnly: true },
      { type: 'writeRefused', reason: 'role' },
    ]);

    const closed = new Promise<boolean>((resolve) => {
      editor.provider.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 4000);
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/members/${people.editor?.id}`,
      headers: as('owner'),
    });
    expect(await closed).toBe(true);
    editor.close();
    check.close();
  });

  it('closes the connection at the next re-check once a membership ends', async () => {
    await signUp('colourist');
    const set = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/members/${people.colourist?.id}`,
      headers: as('owner'),
      payload: { role: 'editor', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(set.json().expiresAt).not.toBeNull();
    const colourist = connect(as('colourist'));
    await colourist.synced;
    const closed = closedWith(colourist);
    // The end date passes; no sweep runs: the access check alone closes the connection.
    await db
      .update(projectMember)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectMember.userId, people.colourist?.id ?? ''));
    expect(await closed).toBe('Forbidden');
    colourist.close();
  });

  it('lets a promoted viewer edit without reconnecting', async () => {
    const viewer = connect(as('viewer'));
    await viewer.synced;
    const notices: unknown[] = [];
    viewer.provider.on('stateless', ({ payload }: { payload: string }) =>
      notices.push(JSON.parse(payload)),
    );
    const setRole = (role: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/projects/${projectId}/members/${people.viewer?.id}`,
        headers: as('owner'),
        payload: { role },
      });
    await setRole('editor');
    await expect
      .poll(() => notices, { timeout: 5000 })
      .toEqual([{ type: 'access', readOnly: false }]);
    const added = column('After promotion');
    addElement(viewer.doc, added);
    const check = connect(as('owner'));
    await check.synced;
    await expect.poll(() => roots(check.doc).elements.has(added.id), { timeout: 5000 }).toBe(true);
    await setRole('viewer');
    for (const c of [viewer, check]) c.close();
  });

  for (const mode of ['direct', 'split'] as const) {
    it.skipIf(mode === 'split' && !process.env.REDIS_URL)(
      `applies a role change and a removal at once, not at the next re-check, in ${mode} mode`,
      async () => {
        // The default re-check (30 s): only the member routes can make this quick.
        const slow = createCollabServer({ limits, db, auth, log, publicUrl: config.PUBLIC_URL });
        const redisUrl = process.env.REDIS_URL ?? '';
        const prefix = `inkadra-recheck-${randomUUID()}`;
        const queued =
          mode === 'split' ? queuedBoardNotifier(redisUrl, log, { prefix }) : undefined;
        const worker =
          mode === 'split'
            ? startBoardWorker(redisUrl, directBoardWriter(slow), log, {
                prefix,
                notices: directBoardNotifier(slow),
              })
            : undefined;
        const web = await createApp({
          config,
          db,
          auth,
          log,
          ...testDeps(db, log),
          notices: queued?.notifier ?? directBoardNotifier(slow),
        });
        attachCollab(web.server, slow);
        await web.listen({ host: '127.0.0.1', port: 0 });
        const shared = base;
        base = `127.0.0.1:${(web.server.address() as AddressInfo).port}`;
        const member = `/api/v1/projects/${projectId}/members/${people.viewer?.id}`;
        const viewer = connect(as('viewer'));
        try {
          await viewer.synced;
          const notices: unknown[] = [];
          viewer.provider.on('stateless', ({ payload }: { payload: string }) =>
            notices.push(JSON.parse(payload)),
          );
          await web.inject({
            method: 'PUT',
            url: member,
            headers: as('owner'),
            payload: { role: 'editor' },
          });
          await expect
            .poll(() => notices, { timeout: 3000 })
            .toEqual([{ type: 'access', readOnly: false }]);
          const closed = closedWith(viewer);
          await web.inject({ method: 'DELETE', url: member, headers: as('owner') });
          expect(await closed).toBe('Forbidden');

          // A board grant is a role too.
          const name = `grantee-${mode}`;
          await signUp(name);
          const child = await web.inject({
            method: 'POST',
            url: `/api/v1/projects/${projectId}/boards`,
            headers: as('owner'),
            payload: { title: `Granted ${mode}`, parentBoardId: boardId },
          });
          const childId = child.json().id as string;
          const grant = `/api/v1/boards/${childId}/grants/${people[name]?.id}`;
          const granted = await web.inject({
            method: 'PUT',
            url: grant,
            headers: as('owner'),
            payload: { role: 'viewer' },
          });
          expect(granted.statusCode, granted.body).toBe(200);
          const grantee = connect(as(name), undefined, CURRENT_SCHEMA_VERSION, childId);
          try {
            await grantee.synced;
            const told: unknown[] = [];
            grantee.provider.on('stateless', ({ payload }: { payload: string }) =>
              told.push(JSON.parse(payload)),
            );
            await web.inject({
              method: 'PUT',
              url: grant,
              headers: as('owner'),
              payload: { role: 'editor' },
            });
            await expect
              .poll(() => told, { timeout: 3000 })
              .toEqual([{ type: 'access', readOnly: false }]);
            const ended = closedWith(grantee);
            await web.inject({ method: 'DELETE', url: grant, headers: as('owner') });
            expect(await ended).toBe('Forbidden');
          } finally {
            grantee.close();
          }
        } finally {
          viewer.close();
          base = shared;
          await app.inject({
            method: 'PUT',
            url: member,
            headers: as('owner'),
            payload: { role: 'viewer' },
          });
          await slow.destroy();
          await web.close();
          await queued?.close();
          await worker?.close();
        }
      },
    );
  }

  it('tells open boards they were trashed or deleted and closes them at once (#951)', async () => {
    // The default re-check (30 s): only the delete routes can make this quick.
    const slow = createCollabServer({ limits, db, auth, log, publicUrl: config.PUBLIC_URL });
    const web = await createApp({
      config,
      db,
      auth,
      log,
      ...testDeps(db, log),
      notices: directBoardNotifier(slow),
    });
    attachCollab(web.server, slow);
    await web.listen({ host: '127.0.0.1', port: 0 });
    const shared = base;
    base = `127.0.0.1:${(web.server.address() as AddressInfo).port}`;
    const opened: Array<ReturnType<typeof connect>> = [];
    try {
      const created = await web.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: as('owner'),
        payload: { name: 'Gone' },
      });
      const { id: goneProject, rootBoardId } = created.json() as {
        id: string;
        rootBoardId: string;
      };
      const addBoard = async (parentBoardId: string) =>
        (
          await web.inject({
            method: 'POST',
            url: `/api/v1/projects/${goneProject}/boards`,
            headers: as('owner'),
            payload: { title: 'Below', parentBoardId },
          })
        ).json().id as string;
      const child = await addBoard(rootBoardId);
      const grandchild = await addBoard(child);
      /** What a board's connection was told, and why it closed. */
      const watch = async (id: string) => {
        const c = connect(as('owner'), undefined, CURRENT_SCHEMA_VERSION, id);
        opened.push(c);
        await c.synced;
        const told: unknown[] = [];
        c.provider.on('stateless', ({ payload }: { payload: string }) =>
          told.push(JSON.parse(payload)),
        );
        return { told, closed: () => closedWith(c) };
      };
      const [root, below, belowThat] = await Promise.all(
        [rootBoardId, child, grandchild].map(watch),
      );

      // To the trash: the board and the one below it, told first, closed well within 4 s.
      const closings = [below, belowThat].map((board) => board?.closed());
      const trashed = await web.inject({
        method: 'DELETE',
        url: `/api/v1/boards/${child}`,
        headers: as('owner'),
      });
      expect(trashed.statusCode).toBe(204);
      expect(await Promise.all(closings)).toEqual(['Forbidden', 'Forbidden']);
      for (const board of [below, belowThat])
        expect(board?.told).toEqual([{ type: 'boardGone', reason: 'trash' }]);
      expect(root?.told).toEqual([]);

      // The project deleted: its root board says deleted.
      const rootClosed = root?.closed();
      const deleted = await web.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${goneProject}`,
        headers: as('owner'),
      });
      expect(deleted.statusCode).toBe(204);
      expect(await rootClosed).toBe('Forbidden');
      expect(root?.told).toEqual([{ type: 'boardGone', reason: 'deleted' }]);
    } finally {
      for (const c of opened) c.close();
      base = shared;
      await slow.destroy();
      await web.close();
    }
  });

  describe('an assignee who is not a project member', () => {
    let runs = 0;
    /** Its own project, so the other tests' role changes don't reach it. */
    async function assignmentBoard() {
      runs += 1;
      const former = `former${runs}`;
      const writer = `writer${runs}`;
      for (const name of [former, writer]) await signUp(name);
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: as('owner'),
        payload: { name: `Assignments ${runs}` },
      });
      const project = created.json().id as string;
      const setRole = (who: string, role: 'editor' | 'viewer') =>
        app.inject({
          method: 'PUT',
          url: `/api/v1/projects/${project}/members/${people[who]?.id}`,
          headers: as('owner'),
          payload: { role },
        });
      await setRole(former, 'editor');
      await setRole(writer, 'editor');
      const board = created.json().rootBoardId as string;
      const late = connect(as(writer), undefined, CURRENT_SCHEMA_VERSION, board);
      const other = connect(as('owner'), undefined, CURRENT_SCHEMA_VERSION, board);
      await Promise.all([late.synced, other.synced]);
      const todo = createElement(late.doc, 'todo', { x: 0, y: 0 }, { items: [] }, { userId: null });
      const itemId = addTodoItem(late.doc, todo.id, 'Permit') as string;
      await expect.poll(() => assigneeOf(other.doc, todo.id, itemId)).toBeNull();
      const offline = async () => {
        late.websocketProvider.disconnect();
        await expect.poll(() => late.websocketProvider.status).toBe('disconnected');
      };
      const removeFormer = () =>
        app.inject({
          method: 'DELETE',
          url: `/api/v1/projects/${project}/members/${people[former]?.id}`,
          headers: as('owner'),
        });
      return { board, former, writer, late, other, todo, itemId, offline, removeFormer, setRole };
    }
    /** Undefined until the card and the item arrive, null while the item has no assignee. */
    function assigneeOf(doc: Y.Doc, elementId: string, itemId: string) {
      const items = roots(doc).elements.get(elementId)?.get('items') as
        | Y.Array<Y.Map<unknown>>
        | undefined;
      for (const item of items ?? [])
        if (item.get('id') === itemId) return (item.get('assigneeId') as string) ?? null;
      return undefined;
    }

    it('takes the offline edits and drops an assignee removed in the meantime', async () => {
      const { board, former, late, other, todo, itemId, offline, removeFormer } =
        await assignmentBoard();
      await offline();
      const note = column('Written offline');
      updateTodoItem(late.doc, todo.id, itemId, { assigneeId: people[former]?.id });
      addElement(late.doc, note);
      expect((await removeFormer()).statusCode).toBe(204);
      const closed = closedWith(late);
      late.websocketProvider.connect();

      await expect.poll(() => roots(other.doc).elements.has(note.id)).toBe(true);
      // Both sides settle on no assignee, and the writer has nothing left to send.
      await expect.poll(() => assigneeOf(late.doc, todo.id, itemId)).toBeNull();
      await expect.poll(() => assigneeOf(other.doc, todo.id, itemId)).toBeNull();
      await expect.poll(() => late.provider.unsyncedChanges).toBe(0);
      expect(await closed).toBeNull();

      collab.hocuspocus.flushPendingStores();
      await expect
        .poll(async () => {
          const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, board));
          const stored = new Y.Doc();
          if (row) Y.applyUpdate(stored, row.state);
          return roots(stored).elements.has(note.id) && assigneeOf(stored, todo.id, itemId);
        })
        .toBeNull();
      const told = await db
        .select()
        .from(notification)
        .where(eq(notification.userId, people[former]?.id ?? ''));
      expect(told).toEqual([]);
      late.close();
      other.close();
    });

    it('keeps another person’s assignment when a stale list offers someone who left', async () => {
      const { former, late, other, todo, itemId, removeFormer } = await assignmentBoard();
      const owner = people.owner?.id;
      updateTodoItem(other.doc, todo.id, itemId, { assigneeId: owner });
      await expect.poll(() => assigneeOf(late.doc, todo.id, itemId)).toBe(owner);
      expect((await removeFormer()).statusCode).toBe(204);
      const closed = closedWith(late);

      const note = column('Written after the stale pick');
      updateTodoItem(late.doc, todo.id, itemId, { assigneeId: people[former]?.id });
      addElement(late.doc, note);

      await expect.poll(() => roots(other.doc).elements.has(note.id)).toBe(true);
      await expect.poll(() => assigneeOf(late.doc, todo.id, itemId)).toBe(owner);
      await expect.poll(() => assigneeOf(other.doc, todo.id, itemId)).toBe(owner);
      await expect.poll(() => late.provider.unsyncedChanges).toBe(0);
      expect(await closed).toBeNull();
      late.close();
      other.close();
    });

    it('keeps a person demoted while offline connected, without applying the assignment', async () => {
      const { former, writer, late, other, todo, itemId, offline, setRole } =
        await assignmentBoard();
      await offline();
      updateTodoItem(late.doc, todo.id, itemId, { assigneeId: people[former]?.id });
      await setRole(writer, 'viewer');
      const closed = closedWith(late);
      late.websocketProvider.connect();
      expect(await closed).toBeNull();

      // Read-only, but still live: what others write keeps arriving without a reconnection.
      const note = column('Written by someone else');
      addElement(other.doc, note);
      await expect.poll(() => roots(late.doc).elements.has(note.id)).toBe(true);
      expect(assigneeOf(other.doc, todo.id, itemId)).toBeNull();
      late.close();
      other.close();
    });
  });

  it('merges ten people editing the same board at once', async () => {
    const PEOPLE = 10;
    const EACH = 20;
    for (let i = 0; i < PEOPLE; i++) {
      await signUp(`crew${i}`);
      await app.inject({
        method: 'PUT',
        url: `/api/v1/projects/${projectId}/members/${people[`crew${i}`]?.id}`,
        headers: as('owner'),
        payload: { role: 'editor' },
      });
    }
    const clients = Array.from({ length: PEOPLE }, (_, i) => connect(as(`crew${i}`)));
    await Promise.all(clients.map((c) => c.synced));
    const startCount = roots(clients[0]!.doc).elements.size;

    // Everyone adds cards and moves a shared one, interleaved.
    const shared = column('Shared');
    addElement(clients[0]!.doc, shared);
    await expect
      .poll(() => clients.every((c) => roots(c.doc).elements.has(shared.id)), { timeout: 5000 })
      .toBe(true);
    await Promise.all(
      clients.map(async (c, i) => {
        for (let n = 0; n < EACH; n++) {
          addElement(c.doc, column(`crew${i}-${n}`, n * 10));
          roots(c.doc)
            .elements.get(shared.id)
            ?.set('x', i * 1000 + n);
          await new Promise((r) => setTimeout(r, Math.random() * 10));
        }
      }),
    );
    const expected = startCount + 1 + PEOPLE * EACH;
    await expect
      .poll(() => clients.map((c) => roots(c.doc).elements.size), { timeout: 15_000 })
      .toEqual(Array(PEOPLE).fill(expected));
    // Everyone ends with the same document, including who won the concurrent moves.
    const states = clients.map((c) => roots(c.doc).elements.get(shared.id)?.get('x'));
    expect(new Set(states).size).toBe(1);

    for (const c of clients) c.close();
    collab.hocuspocus.flushPendingStores();
    await expect
      .poll(
        async () => {
          const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
          if (!row) return 0;
          const stored = new Y.Doc();
          Y.applyUpdate(stored, row.state);
          return roots(stored).elements.size;
        },
        { timeout: 10_000 },
      )
      .toBe(expected);
  });
  for (const mode of ['direct', 'split'] as const) {
    it.skipIf(mode === 'split' && !process.env.REDIS_URL)(
      `delivers comment/review notices to read-only clients in ${mode} mode`,
      async () => {
        const viewer = connect(as('viewer'));
        await viewer.synced;
        const received: unknown[] = [];
        viewer.provider.on('stateless', ({ payload }: { payload: string }) =>
          received.push(JSON.parse(payload)),
        );
        const redisUrl = process.env.REDIS_URL ?? '';
        const prefix = `inkadra-notices-${randomUUID()}`;
        const queued =
          mode === 'split' ? queuedBoardNotifier(redisUrl, log, { prefix }) : undefined;
        const worker =
          mode === 'split'
            ? startBoardWorker(redisUrl, directBoardWriter(collab), log, {
                prefix,
                notices: directBoardNotifier(collab),
              })
            : undefined;
        const web = await createApp({
          config,
          db,
          auth,
          log,
          ...testDeps(db, log),
          notices: queued?.notifier ?? directBoardNotifier(collab),
        });
        try {
          const created = await web.inject({
            method: 'POST',
            url: `/api/v1/boards/${boardId}/comments`,
            headers: as('owner'),
            payload: { body: `A comment through ${mode}` },
          });
          expect(created.statusCode).toBe(201);
          const elementId = roots(viewer.doc).elements.keys().next().value as string;
          const reviewed = await web.inject({
            method: 'PUT',
            url: `/api/v1/boards/${boardId}/elements/${elementId}/review`,
            headers: as('owner'),
            payload: { status: mode === 'direct' ? 'approved' : 'changes_requested' },
          });
          expect(reviewed.statusCode, reviewed.body).toBe(200);
          await expect
            .poll(() => received, { timeout: 5000 })
            .toEqual([
              { type: 'comments', elementId: null, threadId: created.json().id },
              { type: 'review', elementId },
            ]);
          if (mode === 'split') {
            const connection = createRedis(redisUrl);
            const queue = new Queue(QUEUES.collab, { connection, prefix });
            const events = new QueueEvents(QUEUES.collab, {
              connection: createRedis(redisUrl),
              prefix,
            });
            try {
              await events.waitUntilReady();
              const stale = await queue.add('notice', {
                boardId,
                notice: { type: 'review', elementId },
                sentAt: Date.now() - NOTICE_TTL_MS - 1000,
              });
              expect(await stale.waitUntilFinished(events, 5000)).toEqual({ sent: false });
              expect(received).toHaveLength(2);
            } finally {
              await Promise.all([queue.close(), events.close()]);
              connection.disconnect();
            }
          }
        } finally {
          await web.close();
          await queued?.close();
          await worker?.close();
          viewer.close();
        }
      },
    );
  }
});

/**
 * `db` whose inserts throw while `down()` holds, inside transactions too, where raw statements
 * (the board store's conditional insert) throw as well.
 */
function failingInserts<T extends object>(target: T, down: () => boolean, inTx = false): T {
  return new Proxy(target, {
    get(t, key) {
      if ((key === 'insert' || (inTx && key === 'execute')) && down())
        return () => {
          throw new Error('database down');
        };
      if (key === 'transaction')
        return (fn: (tx: object) => unknown, ...rest: unknown[]) =>
          (t as { transaction: (...a: unknown[]) => unknown }).transaction(
            (tx: object) => fn(failingInserts(tx, down, true)),
            ...rest,
          );
      const value = Reflect.get(t, key);
      return typeof value === 'function' ? value.bind(t) : value;
    },
  });
}

/** A database whose board writes (in transactions) fail while `down` and wait while held. */
function controlledWrites<T extends object>(target: T) {
  let held: Promise<void> | null = null;
  let open = () => {};
  const control = {
    db: target,
    down: false,
    /** Writes that waited on a hold. */
    waiting: 0,
    hold() {
      held = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release() {
      held = null;
      open();
    },
  };
  const wrap = <U extends object>(t: U, inTx: boolean): U =>
    new Proxy(t, {
      get(o, key) {
        if (key === 'transaction')
          return (fn: (tx: object) => unknown, ...rest: unknown[]) =>
            (o as { transaction: (...a: unknown[]) => unknown }).transaction(
              (tx: object) => fn(wrap(tx, true)),
              ...rest,
            );
        if (inTx && key === 'execute')
          return async (...args: unknown[]) => {
            if (held) {
              control.waiting += 1;
              await held;
            }
            if (control.down) throw new Error('database down');
            return (o as { execute: (...a: unknown[]) => unknown }).execute(...args);
          };
        const value = Reflect.get(o, key);
        return typeof value === 'function' ? value.bind(o) : value;
      },
    });
  control.db = wrap(target, false);
  return control;
}
