import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  type ClipboardData,
  copyElements,
  createElement,
  deleteElements,
  listElements,
  restoreElements,
} from '@inkadra/canvas-core';
import {
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  type RestoreCardsResult,
  readRestoreCardsResult,
  roots,
} from '@inkadra/doc-schema';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from './auth.ts';
import { attachCollab, createCollabServer } from './collab.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { createApp } from './http/app.ts';
import { testDeps } from './test-deps.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const at = { x: 900, y: 100 };

/** Decision 0142: `restoreCards` on a board's connection, against real providers. */
describe.skipIf(!url)('conditional card restores (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  const collab = createCollabServer({ db, auth, log, publicUrl: config.PUBLIC_URL });
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';
  let boardId = '';
  let otherBoardId = '';
  let ownerId = '';
  let cookie = '';
  let viewerCookie = '';
  const open: Array<{ close(): void }> = [];

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, ...testDeps(db, log) });
    attachCollab(app.server, collab);
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const signUp = (email: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email, password: 'correct-horse-battery', name: email },
      });
    const owner = await signUp('owner@example.com');
    ownerId = owner.json().user.id;
    cookie = String(owner.headers['set-cookie']).split(';')[0] ?? '';
    const project = async (name: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: { cookie, origin: config.PUBLIC_URL },
          payload: { name },
        })
      ).json();
    const main = await project('Restores');
    boardId = main.rootBoardId;
    otherBoardId = (await project('Elsewhere')).rootBoardId;
    const viewer = await signUp('viewer@example.com');
    viewerCookie = String(viewer.headers['set-cookie']).split(';')[0] ?? '';
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${main.id}/members/${viewer.json().user.id}`,
      headers: { cookie, origin: config.PUBLIC_URL },
      payload: { role: 'viewer' },
    });
  });

  afterAll(async () => {
    for (const c of open) c.close();
    await collab.destroy();
    await app?.close();
    await client.end();
  });

  const serverDoc = () => {
    const doc = collab.hocuspocus.documents.get(boardDocName(boardId));
    if (!doc) throw new Error('board not open');
    return doc;
  };

  async function connect({ as = cookie, doc = new Y.Doc() } = {}) {
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie: as }, origin: config.PUBLIC_URL });
      }
    }
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://${base}/collab?schemaVersion=${CURRENT_SCHEMA_VERSION}&strictCards=1`,
      WebSocketPolyfill: CookieSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: boardDocName(boardId),
      document: doc,
    });
    provider.attach();
    const answers: RestoreCardsResult[] = [];
    provider.on('stateless', ({ payload }: { payload: string }) => {
      const answer = readRestoreCardsResult(payload);
      if (answer) answers.push(answer);
    });
    await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    const conn = {
      doc,
      answers,
      /** Sends a request; resolves with its answer. */
      ask(clipboard: ClipboardData, requestId: string = randomUUID()) {
        const from = answers.length;
        const mine = () => answers.slice(from).find((a) => a.requestId === requestId);
        provider.sendStateless(JSON.stringify({ type: 'restoreCards', requestId, clipboard, at }));
        return expect
          .poll(mine, { timeout: 5000 })
          .toBeDefined()
          .then(() => mine() as RestoreCardsResult);
      },
      send: (payload: string) => provider.sendStateless(payload),
      close() {
        provider.destroy();
        websocketProvider.destroy();
      },
    };
    open.push(conn);
    return conn;
  }

  /** A column with a note that has text, and a free note: made, copied, deleted, on the server. */
  async function deletedCards(on: Awaited<ReturnType<typeof connect>>) {
    const opts = { userId: ownerId };
    const column = createElement(on.doc, 'column', { x: 0, y: 0 }, { title: 'Refs' }, opts).id;
    const inside = createElement(on.doc, 'note', { x: 0, y: 0 }, { parent: column }, opts).id;
    const body = roots(on.doc).elements.get(inside)?.get('body') as Y.XmlFragment;
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('kept text')]);
    body.insert(0, [paragraph]);
    const free = createElement(on.doc, 'note', { x: 40, y: 50 }, {}, opts).id;
    const copy: ClipboardData = JSON.parse(JSON.stringify(copyElements(on.doc, [column, free])));
    await expect.poll(() => roots(serverDoc()).elements.has(free)).toBe(true);
    deleteElements(on.doc, [column, free]);
    await expect.poll(() => roots(serverDoc()).elements.has(free)).toBe(false);
    return { column, inside, free, copy, ids: [column, inside, free] };
  }

  const onServer = (ids: string[]) => ids.filter((id) => roots(serverDoc()).elements.has(id));

  it('puts the cards back for everyone, answers only the requester, on their account', async () => {
    const asker = await connect();
    const other = await connect();
    const { column, inside, free, copy, ids } = await deletedCards(asker);
    const requestId = randomUUID();
    const answer = await asker.ask(copy, requestId);
    expect(answer).toMatchObject({ outcome: 'restored', outside: [] });
    expect(answer.outcome === 'restored' && [...answer.ids].sort()).toEqual([column, free].sort());
    expect(answer.outcome === 'restored' && [...answer.own].sort()).toEqual([...ids].sort());
    await expect.poll(() => ids.every((id) => roots(other.doc).elements.has(id))).toBe(true);
    await expect.poll(() => ids.every((id) => roots(asker.doc).elements.has(id))).toBe(true);
    expect(listElements(other.doc).find((e) => e.id === inside)?.parent).toBe(column);
    expect(String(roots(other.doc).elements.get(inside)?.get('body'))).toContain('kept text');
    expect(other.answers).toEqual([]);
    // Under a client id of its own, neither the server's nor the requester's (decision 0120).
    const holder = roots(serverDoc()).elements._map.get(free)?.id;
    expect(holder?.client).not.toBe(serverDoc().clientID);
    expect(holder?.client).not.toBe(asker.doc.clientID);
    await expect
      .poll(
        async () =>
          (
            await db.execute<{ user_id: string }>(
              sql`select user_id from board_writer where board_id = ${boardId}
                  and client_id = ${holder?.client ?? -1}`,
            )
          )[0]?.user_id,
        { timeout: 15_000 },
      )
      .toBe(ownerId);
    // The same request again: the same answer, and nothing written again.
    const state = Y.encodeStateVector(serverDoc());
    const again = await asker.ask(copy, requestId);
    expect(again).toEqual({ ...answer, repeat: true });
    expect(Y.encodeStateVector(serverDoc())).toEqual(state);
  });

  it('serialises two requests sent at once: one restores, the other reads `present`', async () => {
    const first = await connect();
    const second = await connect();
    const { free, copy, ids } = await deletedCards(first);
    const answers = await Promise.all([first.ask(copy), second.ask(copy)]);
    expect(answers.map((a) => a.outcome).sort()).toEqual(['present', 'restored']);
    const present = answers.find((a) => a.outcome === 'present');
    expect(present?.outcome === 'present' && present.present.sort()).toEqual([...ids].sort());
    expect(onServer(ids)).toEqual(ids);
    expect(roots(serverDoc()).elements._map.get(free)?.deleted).toBe(false);
  });

  it('reads `present` for cards already back on the server that the requester lacks', async () => {
    const asker = await connect();
    const { free, copy, ids } = await deletedCards(asker);
    // Someone else puts them back, on the server, just before the request leaves.
    const direct = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
    const rival = direct.transact((doc) => {
      restoreElements(doc, copy, { x: 0, y: 0 });
    });
    const theirs = roots(serverDoc()).elements._map.get(free)?.id;
    expect(roots(asker.doc).elements.has(free)).toBe(false);
    const answer = await asker.ask(copy);
    await rival;
    await direct.disconnect({ unloadImmediately: false });
    expect(answer).toMatchObject({ outcome: 'present' });
    expect(answer.outcome === 'present' && answer.present.sort()).toEqual([...ids].sort());
    expect(roots(serverDoc()).elements._map.get(free)?.id).toEqual(theirs);
  });

  it('applies the updates the requester sent before the request first', async () => {
    const asker = await connect();
    const { free, copy } = await deletedCards(asker);
    // A column made just now, and a card put back into it in the next message.
    const column = createElement(asker.doc, 'column', at, { title: 'New' }, { userId: ownerId }).id;
    const into: ClipboardData = {
      ...copy,
      elements: copy.elements.filter((e) => e.id === free).map((e) => ({ ...e, parent: column })),
    };
    const answer = await asker.ask(into);
    expect(answer).toMatchObject({ outcome: 'restored', ids: [free], outside: [] });
    expect(listElements(serverDoc()).find((e) => e.id === free)?.parent).toBe(column);
  });

  it('refuses a card whose data moved to another board (decision 0141)', async () => {
    const asker = await connect();
    const { free, copy, ids } = await deletedCards(asker);
    await db.execute(
      sql`insert into element_move (board_id, element_id, to_board_id)
          values (${boardId}, ${free}, ${otherBoardId})`,
    );
    expect(await asker.ask(copy)).toMatchObject({ outcome: 'refused', reason: 'moved' });
    expect(onServer(ids)).toEqual([]);
  });

  it('refuses a connection that may only read', async () => {
    const owner = await connect();
    const viewer = await connect({ as: viewerCookie });
    const { copy, ids } = await deletedCards(owner);
    expect(await viewer.ask(copy)).toMatchObject({ outcome: 'refused', reason: 'role' });
    expect(onServer(ids)).toEqual([]);
  });

  it('refuses malformed requests and copies, writing nothing', async () => {
    const asker = await connect();
    const { free, copy, ids } = await deletedCards(asker);
    const broken: ClipboardData = {
      ...copy,
      elements: copy.elements.map((e) =>
        e.id === free ? { ...e, x: 'left' as unknown as number } : e,
      ),
    };
    expect(await asker.ask(broken)).toMatchObject({ outcome: 'refused', reason: 'invalid' });
    expect(await asker.ask({ version: 2 } as unknown as ClipboardData)).toMatchObject({
      outcome: 'refused',
      reason: 'invalid',
    });
    expect(onServer(ids)).toEqual([]);
    // A request whose id cannot be read gets nothing; the connection goes on.
    const before = asker.answers.length;
    asker.send('{"type":"restoreCards","requestId":"not-a-uuid"}');
    expect((await asker.ask(copy)).outcome).toBe('restored');
    expect(asker.answers.length).toBe(before + 1);
  });
});
