import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  addElement,
  boardDocName,
  type Element,
  readBoardNotice,
  readElement,
  roots,
} from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { directBoardNotifier } from '../board-notices.ts';
import { attachCollab, createCollabServer } from '../collab.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { board, boardDoc, boardVersion, elementReview } from '../db/schema.ts';
import { CardOutcomeUnknown, queuedBoardWriter, startBoardWorker } from '../queues.ts';
import { fragmentText } from '../search/index-doc.ts';
import { testDeps } from '../test-deps.ts';
import * as versionStorage from '../versions.ts';
import {
  applyVersionRetention,
  DAILY_KEEP_MS,
  directVersionWriter,
  HOURLY_KEEP_MS,
} from '../versions.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)('board versions (needs DATABASE_URL)', () => {
  const env = {
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  };
  const config = loadConfig(env);
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  const deps = testDeps(db, log);
  /** The collaboration server's clock, moved by the cadence tests. */
  let clock: Date | null = null;
  const collab = createCollabServer({
    db,
    auth,
    log,
    publicUrl: config.PUBLIC_URL,
    now: () => clock ?? new Date(),
  });
  const versions = directVersionWriter(collab, db, log);
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';
  const people: Record<string, { cookie: string; id: string }> = {};
  /** Root board of the main project, a sub-board of it, and a board of another project. */
  let boardId = '';
  let subBoardId = '';
  let otherBoardId = '';
  let projectId = '';
  const open: Array<{ close(): void }> = [];

  const cookie = (name: string) => people[name]?.cookie ?? '';

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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    as: string | null,
    payload?: unknown,
    on = app,
  ) {
    return on.inject({
      method,
      url: `/api/v1${path}`,
      // Same-origin like the web app (decision 0013 refuses cross-site cookie writes).
      headers: as ? { cookie: cookie(as), origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }

  /** Edits the board where it is live, then closes, storing it right away. */
  async function edit(id: string, change: (doc: Y.Doc) => void) {
    const connection = await collab.hocuspocus.openDirectConnection(boardDocName(id));
    try {
      await connection.transact((doc) => change(doc));
    } finally {
      await connection.disconnect();
    }
  }

  /** The live board, read through a direct connection. */
  async function read<T>(id: string, look: (doc: Y.Doc) => T): Promise<T> {
    const connection = await collab.hocuspocus.openDirectConnection(boardDocName(id));
    try {
      return look(connection.document as Y.Doc);
    } finally {
      await connection.disconnect();
    }
  }

  function note(id: string, fields: Partial<Element> = {}): Element {
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
      ...fields,
    } as Element;
  }

  function setText(doc: Y.Doc, id: string, text: string) {
    const body = roots(doc).elements.get(id)?.get('body') as Y.XmlFragment;
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    body.delete(0, body.length);
    body.insert(0, [p]);
  }

  const textOf = (doc: Y.Doc, id: string) => {
    const body = roots(doc).elements.get(id)?.get('body');
    return body instanceof Y.XmlFragment ? fragmentText(body) : null;
  };
  const elementOf = (doc: Y.Doc, id: string) => {
    const map = roots(doc).elements.get(id);
    return map ? readElement(map) : null;
  };

  async function clearBoard(id: string) {
    await edit(id, (doc) => {
      for (const key of [...roots(doc).elements.keys()]) roots(doc).elements.delete(key);
    });
    await db.delete(boardVersion).where(eq(boardVersion.boardId, id));
  }

  /** A version row written directly, for retention and listing tests. */
  async function insertVersion(
    values: Partial<typeof boardVersion.$inferInsert> & { createdAt: Date },
  ) {
    const doc = new Y.Doc();
    roots(doc).meta.set('schemaVersion', 3);
    const state = Y.encodeStateAsUpdate(doc);
    const [row] = await db
      .insert(boardVersion)
      .values({
        boardId,
        kind: 'auto',
        state,
        schemaVersion: 3,
        size: state.byteLength,
        elementCount: 0,
        expiresAt: new Date(values.createdAt.getTime() + HOURLY_KEEP_MS),
        ...values,
      })
      .returning();
    if (!row) throw new Error('no row');
    return row;
  }

  const versionsOf = (id: string) =>
    db
      .select()
      .from(boardVersion)
      .where(eq(boardVersion.boardId, id))
      .orderBy(boardVersion.createdAt);

  function connect(as: string, id: string) {
    const header = cookie(as);
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie: header } });
      }
    }
    const doc = new Y.Doc();
    const notices: unknown[] = [];
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://${base}/collab`,
      WebSocketPolyfill: CookieSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: boardDocName(id),
      document: doc,
      onStateless: ({ payload }) => notices.push(readBoardNotice(payload)),
    });
    provider.attach();
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    const conn = {
      doc,
      notices,
      synced,
      close() {
        provider.destroy();
        websocketProvider.destroy();
      },
    };
    open.push(conn);
    return conn;
  }

  async function until(check: () => boolean, ms = 5000) {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth,
      log,
      ...deps,
      versions,
      notices: directBoardNotifier(collab),
    });
    attachCollab(app.server, collab);
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    for (const name of ['owner', 'editor', 'commenter', 'viewer', 'stranger', 'saver'])
      await signUp(name);
    const project = await request('POST', '/projects', 'owner', { name: 'Versions' });
    projectId = project.json().id;
    boardId = project.json().rootBoardId;
    for (const role of ['editor', 'commenter', 'viewer'] as const)
      await request('PUT', `/projects/${projectId}/members/${people[role]?.id}`, 'owner', {
        role,
      });
    await request('PUT', `/projects/${projectId}/members/${people.saver?.id}`, 'owner', {
      role: 'editor',
    });
    const sub = await request('POST', `/projects/${projectId}/boards`, 'owner', {
      parentBoardId: boardId,
      title: 'Sub',
    });
    subBoardId = sub.json().id;
    const other = await request('POST', '/projects', 'stranger', { name: 'Elsewhere' });
    otherBoardId = other.json().rootBoardId;
  });

  afterAll(async () => {
    for (const conn of open) conn.close();
    await app?.close();
    await collab.destroy();
    await client.end();
  });

  beforeEach(() => {
    clock = null;
  });

  describe('automatic versions', () => {
    it('seeds a fresh process from the DB time and skips checks until that version is an hour old', async () => {
      await clearBoard(boardId);
      const t0 = Date.parse('2026-10-22T08:00:00.000Z');
      await insertVersion({ createdAt: new Date(t0) });
      let now = new Date(t0 + HOUR / 2);
      const fresh = createCollabServer({
        db,
        auth,
        log,
        publicUrl: config.PUBLIC_URL,
        now: () => now,
      });
      const taking = vi.spyOn(versionStorage, 'takeAutoVersion');
      async function store(id: string) {
        const connection = await fresh.hocuspocus.openDirectConnection(boardDocName(boardId));
        await connection.transact((doc) => addElement(doc, note(id)));
        await connection.disconnect();
      }
      try {
        await store('cache001');
        expect(taking).toHaveBeenCalledTimes(1);
        now = new Date(t0 + HOUR - 1);
        const transactions = vi.spyOn(db, 'transaction');
        try {
          await store('cache002');
          expect(taking).toHaveBeenCalledTimes(1);
          // Only search indexing transacts; automatic versioning performs no DB work.
          expect(transactions).toHaveBeenCalledTimes(1);
        } finally {
          transactions.mockRestore();
        }
        now = new Date(t0 + HOUR);
        await store('cache003');
        expect(taking).toHaveBeenCalledTimes(2);
        expect((await versionsOf(boardId)).map((v) => v.createdAt.getTime())).toEqual([
          t0,
          t0 + HOUR,
        ]);
      } finally {
        taking.mockRestore();
        await fresh.destroy();
      }
    });

    it('stores the board successfully even if automatic versioning fails, then retries', async () => {
      await clearBoard(boardId);
      clock = new Date(Date.now() + 2 * HOUR);
      const taking = vi
        .spyOn(versionStorage, 'takeAutoVersion')
        .mockRejectedValueOnce(new Error('Version failed'));
      try {
        await expect(
          edit(boardId, (doc) => addElement(doc, note('safe0001'))),
        ).resolves.toBeUndefined();
        expect(taking).toHaveBeenCalledTimes(1);
        const [row] = await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId));
        const stored = new Y.Doc();
        Y.applyUpdate(stored, row!.state);
        expect(roots(stored).elements.has('safe0001')).toBe(true);
        expect((await versionsOf(boardId)).filter((v) => v.kind === 'auto')).toEqual([]);
        await edit(boardId, (doc) => addElement(doc, note('safe0002')));
        expect(taking).toHaveBeenCalledTimes(2);
        expect((await versionsOf(boardId)).filter((v) => v.kind === 'auto')).toHaveLength(1);
      } finally {
        taking.mockRestore();
      }
    });

    it('are taken when the board is stored and the last one is over an hour old', async () => {
      await clearBoard(boardId);
      const autos = async () =>
        (await versionsOf(boardId)).filter((v) => v.kind === 'auto').map((v) => v.createdAt);
      const t0 = new Date('2026-10-20T08:00:00.000Z');
      clock = t0;
      await edit(boardId, (doc) => addElement(doc, note('cadence1')));
      expect(await autos()).toEqual([t0]);

      clock = new Date(t0.getTime() + 30 * 60 * 1000);
      await edit(boardId, (doc) => addElement(doc, note('cadence2')));
      expect(await autos()).toEqual([t0]);

      clock = new Date(t0.getTime() + HOUR - 1);
      await edit(boardId, (doc) => addElement(doc, note('cadence3')));
      expect(await autos()).toEqual([t0]);

      const t1 = new Date(t0.getTime() + HOUR);
      clock = t1;
      await edit(boardId, (doc) => addElement(doc, note('cadence4')));
      const rows = (await versionsOf(boardId)).filter((v) => v.kind === 'auto');
      expect(rows.map((v) => v.createdAt)).toEqual([t0, t1]);
      // The newest of the day is the one kept for 30 days; the earlier one goes after 48 hours.
      expect(rows[0]?.expiresAt).toEqual(new Date(t0.getTime() + HOURLY_KEEP_MS));
      expect(rows[1]?.expiresAt).toEqual(new Date(t1.getTime() + DAILY_KEEP_MS));
      expect(rows[1]?.elementCount).toBe(4);
      expect(rows[1]?.createdBy).toBeNull();

      // The stored state is the board as it was saved.
      const doc = new Y.Doc();
      Y.applyUpdate(doc, rows[1]?.state as Uint8Array);
      expect([...roots(doc).elements.keys()].sort()).toEqual([
        'cadence1',
        'cadence2',
        'cadence3',
        'cadence4',
      ]);
    });

    it('do not count named versions towards the cadence', async () => {
      await clearBoard(boardId);
      const t0 = new Date('2026-10-21T08:00:00.000Z');
      await insertVersion({ kind: 'named', name: 'Recent', createdAt: t0, expiresAt: null });
      clock = new Date(t0.getTime() + 60_000);
      await edit(boardId, (doc) => addElement(doc, note('named001')));
      expect((await versionsOf(boardId)).map((v) => v.kind)).toEqual(['named', 'auto']);
    });
  });

  describe('retention', () => {
    it('does not set an expiry when a version is named while retention waits for its row lock', async () => {
      await clearBoard(boardId);
      const now = new Date();
      const auto = await insertVersion({ createdAt: new Date(now.getTime() - HOUR) });
      let release = () => {};
      let locked = (_pid: number) => {};
      const ready = new Promise<number>((resolve) => {
        locked = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const naming = db.transaction(async (tx) => {
        await tx
          .update(boardVersion)
          .set({ kind: 'named', name: 'Keep', expiresAt: null })
          .where(eq(boardVersion.id, auto.id));
        const [row] = await tx.execute(sql`select pg_backend_pid() as pid`);
        locked(Number(row!.pid));
        await hold;
      });
      let retention: Promise<unknown> | undefined;
      try {
        const pid = await ready;
        retention = applyVersionRetention(db, now);
        await expect
          .poll(async () => {
            const rows = await db.execute(sql`
            select 1 from pg_stat_activity
            where ${pid} = any(pg_blocking_pids(pid))
              and query like '%update board_version v set expires_at%'
          `);
            return rows.length;
          })
          .toBe(1);
        release();
        await naming;
        await retention;
        const [row] = await db.select().from(boardVersion).where(eq(boardVersion.id, auto.id));
        expect(row).toMatchObject({ kind: 'named', name: 'Keep', expiresAt: null });
      } finally {
        release();
        await naming;
        await retention;
      }
    });

    it('thins restore backups like automatic versions and keeps a named backup', async () => {
      await clearBoard(boardId);
      const now = new Date('2026-10-24T12:30:00.000Z');
      const early = await insertVersion({
        kind: 'restore',
        createdAt: new Date('2026-10-20T08:00:00.000Z'),
      });
      const late = await insertVersion({
        kind: 'restore',
        createdAt: new Date('2026-10-20T09:00:00.000Z'),
      });
      const recent = await insertVersion({
        kind: 'restore',
        createdAt: new Date('2026-10-24T08:00:00.000Z'),
      });
      const newest = await insertVersion({
        kind: 'restore',
        createdAt: new Date('2026-10-24T09:00:00.000Z'),
      });
      const auto = await insertVersion({ createdAt: new Date('2026-10-20T10:00:00.000Z') });
      const named = await insertVersion({
        kind: 'restore',
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
      });
      expect(
        (
          await request('PATCH', `/boards/${boardId}/versions/${named.id}`, 'owner', {
            name: 'Keep this backup',
          })
        ).statusCode,
      ).toBe(200);
      await applyVersionRetention(db, now);
      expect((await versionsOf(boardId)).map((v) => v.id)).toEqual([
        named.id,
        late.id,
        auto.id,
        recent.id,
        newest.id,
      ]);
      expect((await versionsOf(boardId)).some((v) => v.id === early.id)).toBe(false);
    });

    it('keeps automatic versions hourly for 48 hours, then the newest of each day for 30 days', async () => {
      await clearBoard(boardId);
      const now = new Date('2026-10-24T12:30:00.000Z');
      // Hourly automatic versions over the last 5 days, all set to expire after 48 hours.
      for (let h = 1; h <= 5 * 24; h += 1)
        await insertVersion({ createdAt: new Date(now.getTime() - h * HOUR) });
      // Older ones, one a day: the 29-day one stays, the 31-day one goes.
      const day29 = await insertVersion({ createdAt: new Date(now.getTime() - 29 * 24 * HOUR) });
      const day31 = await insertVersion({ createdAt: new Date(now.getTime() - 31 * 24 * HOUR) });
      const named = await insertVersion({
        kind: 'named',
        name: 'Old but named',
        createdAt: new Date(now.getTime() - 90 * 24 * HOUR),
        expiresAt: null,
      });
      const restoreOld = await insertVersion({
        kind: 'restore',
        createdAt: new Date(now.getTime() - 31 * 24 * HOUR),
        expiresAt: new Date(now.getTime() - 24 * HOUR),
      });
      const restoreNew = await insertVersion({
        kind: 'restore',
        createdAt: new Date(now.getTime() - 10 * 24 * HOUR),
        expiresAt: new Date(now.getTime() + 20 * 24 * HOUR),
      });

      await applyVersionRetention(db, now);
      const left = await versionsOf(boardId);
      const ids = new Set(left.map((v) => v.id));
      expect(ids.has(named.id)).toBe(true);
      expect(ids.has(restoreNew.id)).toBe(true);
      expect(ids.has(restoreOld.id)).toBe(false);
      expect(ids.has(day29.id)).toBe(true);
      expect(ids.has(day31.id)).toBe(false);

      const autos = left.filter((v) => v.kind === 'auto');
      const recent = autos.filter((v) => now.getTime() - v.createdAt.getTime() < HOURLY_KEEP_MS);
      const older = autos.filter((v) => now.getTime() - v.createdAt.getTime() >= HOURLY_KEEP_MS);
      // Every hour of the last 48 hours (the one exactly 48 hours old has just gone).
      expect(recent).toHaveLength(47);
      // Before that, one per day: the last of each day.
      const days = older.map((v) => v.createdAt.toISOString().slice(0, 10));
      expect(new Set(days).size).toBe(days.length);
      for (const v of older) if (v.id !== day29.id) expect(v.createdAt.getUTCHours()).toBe(23);
      expect(days).toEqual(['2026-09-25', '2026-10-19', '2026-10-20', '2026-10-21']);
      for (const v of autos) {
        const isLastOfDay =
          v.createdAt.getUTCHours() === 23 ||
          v.id === day29.id ||
          v.createdAt.getTime() === now.getTime() - HOUR;
        expect(v.expiresAt?.getTime()).toBe(
          v.createdAt.getTime() + (isLastOfDay ? DAILY_KEEP_MS : HOURLY_KEEP_MS),
        );
      }
    });

    it('keeps the next newest of a day whose kept version was deleted', async () => {
      await clearBoard(boardId);
      const now = new Date('2026-10-24T12:30:00.000Z');
      const early = await insertVersion({ createdAt: new Date('2026-10-23T09:00:00.000Z') });
      const late = await insertVersion({ createdAt: new Date('2026-10-23T10:00:00.000Z') });
      await applyVersionRetention(db, now);
      const expiry = async (id: string) =>
        (await db.select().from(boardVersion).where(eq(boardVersion.id, id)))[0]?.expiresAt;
      expect(await expiry(late.id)).toEqual(new Date(late.createdAt.getTime() + DAILY_KEEP_MS));
      expect(await expiry(early.id)).toEqual(new Date(early.createdAt.getTime() + HOURLY_KEEP_MS));
      await request('DELETE', `/boards/${boardId}/versions/${late.id}`, 'editor');
      await applyVersionRetention(db, now);
      expect(await expiry(early.id)).toEqual(new Date(early.createdAt.getTime() + DAILY_KEEP_MS));
    });

    it('never removes an automatic version once it is named', async () => {
      await clearBoard(boardId);
      const now = new Date();
      const auto = await insertVersion({ createdAt: new Date(now.getTime() - 3 * HOUR) });
      const res = await request('PATCH', `/boards/${boardId}/versions/${auto.id}`, 'editor', {
        name: '  Before the client call  ',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: auto.id,
        kind: 'named',
        name: 'Before the client call',
        expiresAt: null,
      });
      await applyVersionRetention(db, new Date(now.getTime() + 365 * 24 * HOUR));
      expect((await versionsOf(boardId)).map((v) => v.id)).toEqual([auto.id]);
    });
  });

  describe('listing', () => {
    it('pages versions newest first, with their author, and filters by kind', async () => {
      await clearBoard(boardId);
      const t = Date.parse('2026-10-22T10:00:00.000Z');
      const made: string[] = [];
      for (let i = 0; i < 5; i += 1)
        made.push(
          (
            await insertVersion(
              i % 2 === 0
                ? { createdAt: new Date(t + i * HOUR) }
                : {
                    kind: 'named',
                    name: `Named ${i}`,
                    createdBy: people.editor?.id,
                    createdAt: new Date(t + i * HOUR),
                    expiresAt: null,
                  },
            )
          ).id,
        );
      // Same time as another one: the id breaks the tie, microseconds are kept.
      const twin = await insertVersion({ createdAt: new Date(t + 4 * HOUR) });
      await db.execute(
        sql`update board_version set created_at = created_at + interval '7 microseconds' where id = ${made[0]}`,
      );

      const seen: BoardVersion[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = cursor ? `&cursor=${cursor}` : '';
        const res = await request('GET', `/boards/${boardId}/versions?limit=2${query}`, 'editor');
        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: BoardVersion[]; nextCursor: string | null };
        expect(body.items.length).toBeLessThanOrEqual(2);
        seen.push(...body.items);
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toHaveLength(6);
      const order = seen.map((v) => v.createdAt + v.id);
      expect([...order].sort().reverse()).toEqual(order);
      expect(new Set(seen.map((v) => v.id)).size).toBe(6);
      expect(seen.map((v) => v.id)).toContain(twin.id);

      const namedOne = seen.find((v) => v.kind === 'named');
      expect(namedOne?.createdBy).toEqual({ id: people.editor?.id, name: 'editor', image: null });
      const autoOne = seen.find((v) => v.kind === 'auto');
      expect(autoOne).toMatchObject({ createdBy: null, docSchemaVersion: 3, elementCount: 0 });
      expect(autoOne?.expiresAt).not.toBeNull();
      expect(autoOne).not.toHaveProperty('state');

      const named = await request('GET', `/boards/${boardId}/versions?kind=named`, 'owner');
      expect(named.json().items.map((v: BoardVersion) => v.kind)).toEqual(['named', 'named']);
      expect(named.json().nextCursor).toBeNull();

      for (const bad of ['nope', Buffer.from('["x","y"]').toString('base64url')])
        expect(
          (await request('GET', `/boards/${boardId}/versions?cursor=${bad}`, 'editor')).statusCode,
        ).toBe(400);
      expect(
        (await request('GET', `/boards/${boardId}/versions?limit=101`, 'editor')).statusCode,
      ).toBe(400);
      expect(
        (await request('GET', `/boards/${boardId}/versions?kind=x`, 'editor')).statusCode,
      ).toBe(400);
    });
  });

  describe('one version', () => {
    it('returns the same metadata as the list, and 404 for unknown ids', async () => {
      await clearBoard(boardId);
      const named = await insertVersion({
        kind: 'named',
        name: 'Single',
        createdBy: people.editor?.id,
        createdAt: new Date(),
        expiresAt: null,
      });
      const res = await request('GET', `/boards/${boardId}/versions/${named.id}`, 'editor');
      expect(res.statusCode).toBe(200);
      const listed = (await request('GET', `/boards/${boardId}/versions?limit=100`, 'editor'))
        .json()
        .items.find((v: BoardVersion) => v.id === named.id);
      expect(res.json()).toEqual(listed);
      expect(res.json()).not.toHaveProperty('state');
      const missing = await request(
        'GET',
        `/boards/${boardId}/versions/0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10`,
        'editor',
      );
      expect(missing.statusCode).toBe(404);
      await request('DELETE', `/boards/${boardId}/versions/${named.id}`, 'editor');
      expect(
        (await request('GET', `/boards/${boardId}/versions/${named.id}`, 'editor')).statusCode,
      ).toBe(404);
    });
  });

  describe('unconfirmed changes', () => {
    it('mark saves and restores the board may have made, and say nothing to open boards', async () => {
      const version = (await insertVersion({ createdAt: new Date() })).id;
      const unknown = () => Promise.reject(new CardOutcomeUnknown('stalled'));
      const notified = vi.fn();
      const stalled = await createApp({
        config,
        db,
        auth,
        log,
        ...deps,
        versions: { ...versions, save: unknown, restore: unknown },
        notices: { notify: notified },
      });
      try {
        for (const path of [
          `/boards/${boardId}/versions`,
          `/boards/${boardId}/versions/${version}/restore`,
        ]) {
          const res = await request('POST', path, 'saver', { name: 'Maybe' }, stalled);
          expect(res.statusCode, path).toBe(500);
          expect(res.json().error.details, path).toEqual({ reason: 'outcome_unknown' });
        }
        expect(notified).not.toHaveBeenCalled();
      } finally {
        await stalled.close();
      }
    });
  });

  describe('notices', () => {
    it('tells open boards when a version is saved, renamed or deleted', async () => {
      await clearBoard(subBoardId);
      const viewer = connect('viewer', subBoardId);
      await viewer.synced;
      const saved = await request('POST', `/boards/${subBoardId}/versions`, 'editor', {
        name: 'Noticed',
      });
      expect(saved.statusCode).toBe(201);
      const id = saved.json().id as string;
      const notice = { type: 'versions', versionId: id };
      await until(() => viewer.notices.length === 1);
      expect(viewer.notices).toEqual([notice]);
      await request('PATCH', `/boards/${subBoardId}/versions/${id}`, 'editor', { name: 'Again' });
      await until(() => viewer.notices.length === 2);
      await request('DELETE', `/boards/${subBoardId}/versions/${id}`, 'editor');
      await until(() => viewer.notices.length === 3);
      expect(viewer.notices).toEqual([notice, notice, notice]);
      // Refused changes say nothing.
      await request('DELETE', `/boards/${subBoardId}/versions/${id}`, 'editor');
      await request('PATCH', `/boards/${subBoardId}/versions/${id}`, 'viewer', { name: 'No' });
      await new Promise((r) => setTimeout(r, 200));
      expect(viewer.notices).toHaveLength(3);
      viewer.close();
    });
  });

  describe('saving named versions', () => {
    it('refuses a queued save that expires while waiting for the board lock', async () => {
      await clearBoard(boardId);
      let release = () => {};
      let locked = () => {};
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transaction = db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`board_version:${boardId}`}))`,
        );
        locked();
        await hold;
      });
      try {
        await ready;
        const saving = versions.save({
          boardId,
          name: 'Expired while waiting',
          userId: people.editor?.id ?? '',
          expiresAt: Date.now() + 100,
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        release();
        await transaction;
        expect(await saving).toEqual({ ok: false, reason: 'expired' });
        expect((await versionsOf(boardId)).filter((v) => v.kind === 'named')).toEqual([]);
      } finally {
        release();
        await transaction;
      }
    });

    it('saves what is live on the board, even before it is stored', async () => {
      await clearBoard(boardId);
      const connection = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
      try {
        await connection.transact((doc) => {
          addElement(doc, note('livecard'));
          setText(doc, 'livecard', 'not stored yet');
        });
        const res = await request('POST', `/boards/${boardId}/versions`, 'editor', {
          name: 'Live',
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({
          boardId,
          kind: 'named',
          name: 'Live',
          createdBy: { id: people.editor?.id, name: 'editor' },
          elementCount: 1,
          docSchemaVersion: 3,
          expiresAt: null,
        });
        const state = await request(
          'GET',
          `/boards/${boardId}/versions/${res.json().id}/state`,
          'editor',
        );
        const doc = new Y.Doc();
        Y.applyUpdate(doc, state.rawPayload);
        expect(textOf(doc, 'livecard')).toBe('not stored yet');
      } finally {
        await connection.disconnect();
      }
    });

    it('saves a board nobody has open from what is stored', async () => {
      await clearBoard(subBoardId);
      await edit(subBoardId, (doc) => addElement(doc, note('stored00')));
      expect(collab.hocuspocus.documents.has(boardDocName(subBoardId))).toBe(false);
      const res = await request('POST', `/boards/${subBoardId}/versions`, 'owner', {
        name: 'Stored',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().elementCount).toBe(1);
      // Reading it did not load the board.
      expect(collab.hocuspocus.documents.has(boardDocName(subBoardId))).toBe(false);
    });

    it('refuses empty names and more than 100 named versions per board', async () => {
      await clearBoard(boardId);
      expect(
        (await request('POST', `/boards/${boardId}/versions`, 'editor', { name: '   ' }))
          .statusCode,
      ).toBe(400);
      expect(
        (await request('POST', `/boards/${boardId}/versions`, 'editor', { name: 'x'.repeat(121) }))
          .statusCode,
      ).toBe(400);
      const t = Date.now() - 10 * HOUR;
      for (let i = 0; i < 100; i += 1)
        await insertVersion({
          kind: 'named',
          name: `N${i}`,
          createdAt: new Date(t + i),
          expiresAt: null,
        });
      const auto = await insertVersion({ createdAt: new Date() });
      const full = await request('POST', `/boards/${boardId}/versions`, 'editor', {
        name: 'One more',
      });
      expect(full.statusCode).toBe(409);
      expect(full.json().error.details).toEqual({ reason: 'named_versions_limit' });
      // Naming an automatic one would make a 101st.
      const naming = await request('PATCH', `/boards/${boardId}/versions/${auto.id}`, 'editor', {
        name: 'Kept',
      });
      expect(naming.statusCode).toBe(409);
      expect(naming.json().error.details).toEqual({ reason: 'named_versions_limit' });
      // Renaming one that is already named is fine.
      const [first] = await db
        .select()
        .from(boardVersion)
        .where(and(eq(boardVersion.boardId, boardId), eq(boardVersion.kind, 'named')))
        .limit(1);
      expect(
        (
          await request('PATCH', `/boards/${boardId}/versions/${first?.id}`, 'editor', {
            name: 'Renamed',
          })
        ).json().name,
      ).toBe('Renamed');
      // Other boards are not affected.
      expect(
        (await request('POST', `/boards/${subBoardId}/versions`, 'editor', { name: 'Free' }))
          .statusCode,
      ).toBe(201);
    });

    it('lets a person save 20 an hour', async () => {
      const res = [];
      for (let i = 0; i < 21; i += 1)
        res.push(
          (await request('POST', `/boards/${subBoardId}/versions`, 'saver', { name: `S${i}` }))
            .statusCode,
        );
      expect(res.slice(0, 20).every((s) => s === 201)).toBe(true);
      expect(res[20]).toBe(429);
      // Someone else still can.
      expect(
        (await request('POST', `/boards/${subBoardId}/versions`, 'owner', { name: 'Mine' }))
          .statusCode,
      ).toBe(201);
    });

    it('is refused without a collaboration server', async () => {
      const bare = await createApp({ config, db, auth, log, ...deps });
      try {
        expect(
          (await request('POST', `/boards/${boardId}/versions`, 'editor', { name: 'X' }, bare))
            .statusCode,
        ).toBe(500);
      } finally {
        await bare.close();
      }
    });
  });

  describe('preview', () => {
    it('returns a Yjs update that rebuilds the board as it was, in the current schema', async () => {
      await clearBoard(boardId);
      await edit(boardId, (doc) => {
        addElement(doc, note('preview1', { x: 5, guestHidden: true }));
        setText(doc, 'preview1', 'as it was');
        roots(doc).meta.set('aspect', '4:3');
      });
      const saved = await request('POST', `/boards/${boardId}/versions`, 'editor', {
        name: 'Before',
      });
      await edit(boardId, (doc) => {
        roots(doc).elements.delete('preview1');
        addElement(doc, note('preview2'));
      });
      const res = await request(
        'GET',
        `/boards/${boardId}/versions/${saved.json().id}/state`,
        'editor',
      );
      const [savedRow] = await db
        .select()
        .from(boardVersion)
        .where(eq(boardVersion.id, saved.json().id));
      expect(res.rawPayload).toEqual(Buffer.from(savedRow!.state));
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      const doc = new Y.Doc();
      Y.applyUpdate(doc, res.rawPayload);
      expect([...roots(doc).elements.keys()]).toEqual(['preview1']);
      expect(elementOf(doc, 'preview1')).toMatchObject({ x: 5, guestHidden: true });
      expect(textOf(doc, 'preview1')).toBe('as it was');
      expect(roots(doc).meta.get('aspect')).toBe('4:3');
      expect(roots(doc).meta.get('schemaVersion')).toBe(3);
    });

    it('migrates versions saved by an older schema, and refuses ones from a newer build', async () => {
      const old = new Y.Doc();
      roots(old).meta.set('schemaVersion', 2);
      roots(old).meta.set('boardId', boardId);
      const v2 = await insertVersion({
        createdAt: new Date(),
        schemaVersion: 2,
        state: Y.encodeStateAsUpdate(old),
      });
      const res = await request('GET', `/boards/${boardId}/versions/${v2.id}/state`, 'editor');
      const doc = new Y.Doc();
      Y.applyUpdate(doc, res.rawPayload);
      expect(roots(doc).meta.get('schemaVersion')).toBe(3);

      const future = new Y.Doc();
      roots(future).meta.set('schemaVersion', 99);
      const v99 = await insertVersion({
        createdAt: new Date(),
        schemaVersion: 99,
        state: Y.encodeStateAsUpdate(future),
      });
      for (const [method, path] of [
        ['GET', `/boards/${boardId}/versions/${v99.id}/state`],
        ['POST', `/boards/${boardId}/versions/${v99.id}/restore`],
      ] as const) {
        const res = await request(method, path, 'editor');
        expect(res.statusCode, path).toBe(409);
        expect(res.json().error.details, path).toEqual({ reason: 'newer_schema' });
      }
    });
  });

  /** A board with a version saved, then changed: what every restore test starts from. */
  async function changedBoard(id: string, as = 'editor', on = app) {
    await clearBoard(id);
    await edit(id, (doc) => {
      addElement(doc, note('restore1', { x: 10 }));
      setText(doc, 'restore1', 'original text');
      addElement(doc, note('restore2', { x: 20 }));
      addElement(doc, note('restore3', { x: 30, guestHidden: true }));
    });
    const saved = await request('POST', `/boards/${id}/versions`, as, { name: 'Good' }, on);
    expect(saved.statusCode).toBe(201);
    await edit(id, (doc) => {
      roots(doc).elements.delete('restore1');
      roots(doc).elements.get('restore2')?.set('x', 99);
      roots(doc).elements.get('restore2')?.set('guestHidden', true);
      roots(doc).elements.get('restore3')?.delete('guestHidden');
      addElement(doc, note('restore4'));
    });
    return saved.json() as BoardVersion;
  }

  function expectRestored(doc: Y.Doc) {
    expect([...roots(doc).elements.keys()].sort()).toEqual(['restore1', 'restore2', 'restore3']);
    expect(textOf(doc, 'restore1')).toBe('original text');
    expect(elementOf(doc, 'restore1')?.x).toBe(10);
    expect(elementOf(doc, 'restore2')?.x).toBe(20);
    // Hidden since the version was taken: still hidden. Shown since: still shown.
    expect(elementOf(doc, 'restore2')?.guestHidden).toBe(true);
    expect(elementOf(doc, 'restore3')?.guestHidden).toBeUndefined();
  }

  describe('restore', () => {
    it('limits restores to ten per hour per board across editors', async () => {
      const version = await insertVersion({ createdAt: new Date() });
      const other = await insertVersion({ boardId: subBoardId, createdAt: new Date() });
      const restore = vi
        .fn<typeof versions.restore>()
        .mockResolvedValue({ ok: false, reason: 'expired' });
      const limited = await createApp({
        config,
        db,
        auth,
        log,
        ...deps,
        versions: { ...versions, restore },
      });
      try {
        for (let i = 0; i < 10; i += 1)
          expect(
            (
              await request(
                'POST',
                `/boards/${boardId}/versions/${version.id}/restore`,
                i % 2 ? 'owner' : 'editor',
                undefined,
                limited,
              )
            ).statusCode,
          ).toBe(500);
        expect(
          (
            await request(
              'POST',
              `/boards/${boardId}/versions/${version.id}/restore`,
              'owner',
              undefined,
              limited,
            )
          ).statusCode,
        ).toBe(429);
        expect(restore).toHaveBeenCalledTimes(10);
        expect(
          (
            await request(
              'POST',
              `/boards/${subBoardId}/versions/${other.id}/restore`,
              'owner',
              undefined,
              limited,
            )
          ).statusCode,
        ).toBe(500);
        expect(restore).toHaveBeenCalledTimes(11);
      } finally {
        await limited.close();
      }
    });

    it('bounds direct restores on a continuously edited board and removes the unused backup', async () => {
      const version = await changedBoard(boardId);
      const before = (await versionsOf(boardId)).map((v) => v.id);
      const openDirect = collab.hocuspocus.openDirectConnection.bind(collab.hocuspocus);
      const opening = vi.spyOn(collab.hocuspocus, 'openDirectConnection');
      let attempts = 0;
      opening.mockImplementationOnce(async (...args) => {
        const connection = await openDirect(...args);
        const transact = connection.transact.bind(connection);
        vi.spyOn(connection, 'transact').mockImplementation(async (callback) =>
          transact((live) => {
            roots(live).elements.get('restore4')?.set('x', ++attempts);
            return callback(live);
          }),
        );
        return connection;
      });
      try {
        expect(
          await versions.restore({
            boardId,
            versionId: version.id,
            userId: people.editor?.id ?? '',
          }),
        ).toEqual({ ok: false, reason: 'expired' });
        expect(attempts).toBeGreaterThan(1);
        expect(attempts).toBeLessThanOrEqual(10);
        expect((await versionsOf(boardId)).map((v) => v.id)).toEqual(before);
        expect(await read(boardId, (doc) => roots(doc).elements.has('restore4'))).toBe(true);
      } finally {
        opening.mockRestore();
      }
    });

    for (const change of ['edit', 'delete'] as const) {
      it(`backs up a concurrent ${change} before replacing the live state`, async () => {
        const version = await changedBoard(boardId);
        const openDirect = collab.hocuspocus.openDirectConnection.bind(collab.hocuspocus);
        const opening = vi.spyOn(collab.hocuspocus, 'openDirectConnection');
        opening.mockImplementationOnce(async (...args) => {
          const connection = await openDirect(...args);
          const transact = connection.transact.bind(connection);
          vi.spyOn(connection, 'transact').mockImplementationOnce(async (callback) =>
            transact((live) => {
              if (change === 'delete') roots(live).elements.delete('restore4');
              else roots(live).elements.get('restore4')?.set('x', 123);
              return callback(live);
            }),
          );
          return connection;
        });
        try {
          const result = await versions.restore({
            boardId,
            versionId: version.id,
            userId: people.editor?.id ?? '',
          });
          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error('restore failed');
          const state = await request(
            'GET',
            `/boards/${boardId}/versions/${result.backupId}/state`,
            'editor',
          );
          const backup = new Y.Doc();
          Y.applyUpdate(backup, state.rawPayload);
          if (change === 'delete') expect(elementOf(backup, 'restore4')).toBeNull();
          else expect(elementOf(backup, 'restore4')?.x).toBe(123);
          expectRestored(await read(boardId, (doc) => doc));
        } finally {
          opening.mockRestore();
        }
      });
    }

    it('leaves the live board alone if persisting a concurrent edit in the backup fails', async () => {
      const version = await changedBoard(boardId);
      const openDirect = collab.hocuspocus.openDirectConnection.bind(collab.hocuspocus);
      const opening = vi.spyOn(collab.hocuspocus, 'openDirectConnection');
      opening.mockImplementationOnce(async (...args) => {
        const connection = await openDirect(...args);
        const transact = connection.transact.bind(connection);
        vi.spyOn(connection, 'transact').mockImplementationOnce(async (callback) =>
          transact((live) => {
            roots(live).elements.get('restore4')?.set('x', 456);
            return callback(live);
          }),
        );
        return connection;
      });
      const updating = vi.spyOn(db, 'update').mockImplementationOnce(() => {
        throw new Error('Backup write failed');
      });
      try {
        await expect(
          versions.restore({ boardId, versionId: version.id, userId: people.editor?.id ?? '' }),
        ).rejects.toThrow('Backup write failed');
        expect((await versionsOf(boardId)).filter((v) => v.kind === 'restore')).toEqual([]);
        expect(await read(boardId, (doc) => elementOf(doc, 'restore4')?.x)).toBe(456);
        expect(await read(boardId, (doc) => roots(doc).elements.has('restore1'))).toBe(false);
      } finally {
        updating.mockRestore();
        opening.mockRestore();
      }
    });

    it('removes the backup if the direct connection transaction fails', async () => {
      const version = await changedBoard(boardId);
      const openDirect = collab.hocuspocus.openDirectConnection.bind(collab.hocuspocus);
      const opening = vi.spyOn(collab.hocuspocus, 'openDirectConnection');
      opening.mockImplementationOnce(async (...args) => {
        const connection = await openDirect(...args);
        vi.spyOn(connection, 'transact').mockRejectedValueOnce(new Error('Connection failed'));
        return connection;
      });
      try {
        await expect(
          versions.restore({ boardId, versionId: version.id, userId: people.editor?.id ?? '' }),
        ).rejects.toThrow('Connection failed');
        expect((await versionsOf(boardId)).filter((v) => v.kind === 'restore')).toEqual([]);
      } finally {
        opening.mockRestore();
      }
    });

    it('writes the version over the live board, saves what it replaced and tells open boards', async () => {
      const version = await changedBoard(boardId);
      const [review] = await db
        .insert(elementReview)
        .values({
          boardId,
          projectId,
          elementId: 'restore4',
          status: 'approved',
          changedBy: people.editor?.id,
        })
        .returning();

      const viewer = connect('viewer', boardId);
      await viewer.synced;
      expect(roots(viewer.doc).elements.has('restore4')).toBe(true);

      const res = await request(
        'POST',
        `/boards/${boardId}/versions/${version.id}/restore`,
        'editor',
      );
      expect(res.statusCode).toBe(200);
      const body = res.json() as { restored: BoardVersion; backup: BoardVersion };
      expect(body.restored).toMatchObject({ id: version.id, kind: 'named', name: 'Good' });
      expect(body.backup).toMatchObject({
        boardId,
        kind: 'restore',
        name: null,
        createdBy: { id: people.editor?.id },
        elementCount: 3,
      });
      expect(Date.parse(body.backup.expiresAt ?? '')).toBeGreaterThan(Date.now() + 29 * 24 * HOUR);

      expectRestored(await read(boardId, (doc) => doc));
      // The open board follows without a reload, and is told why.
      await until(() => !roots(viewer.doc).elements.has('restore4'));
      expectRestored(viewer.doc);
      await until(() => viewer.notices.length > 0);
      expect(viewer.notices).toContainEqual({ type: 'restored', versionId: version.id });

      // The backup holds the board as it was just before.
      const state = await request(
        'GET',
        `/boards/${boardId}/versions/${body.backup.id}/state`,
        'editor',
      );
      const before = new Y.Doc();
      Y.applyUpdate(before, state.rawPayload);
      expect([...roots(before).elements.keys()].sort()).toEqual([
        'restore2',
        'restore3',
        'restore4',
      ]);
      expect(elementOf(before, 'restore2')?.x).toBe(99);

      // Reviews are not touched, not even those of cards the restore removed.
      const reviews = await db
        .select()
        .from(elementReview)
        .where(eq(elementReview.id, review?.id ?? ''));
      expect(reviews).toHaveLength(1);

      // Restoring the backup brings the board back to before the restore.
      expect(
        (await request('POST', `/boards/${boardId}/versions/${body.backup.id}/restore`, 'owner'))
          .statusCode,
      ).toBe(200);
      expect(await read(boardId, (doc) => [...roots(doc).elements.keys()].sort())).toEqual([
        'restore2',
        'restore3',
        'restore4',
      ]);
    });

    it('is refused without a collaboration server', async () => {
      const version = await changedBoard(boardId);
      const bare = await createApp({ config, db, auth, log, ...deps });
      try {
        const res = await request(
          'POST',
          `/boards/${boardId}/versions/${version.id}/restore`,
          'editor',
          undefined,
          bare,
        );
        expect(res.statusCode).toBe(500);
      } finally {
        await bare.close();
      }
    });

    describe.skipIf(!redisUrl)('in split mode (needs REDIS_URL)', () => {
      const prefix = `inkadra-versions-test-${process.pid}`;

      it('goes through the collab queue to the collaboration server', async () => {
        const worker = startBoardWorker(
          redisUrl ?? '',
          { addCard: async () => ({ ok: false, reason: 'column' }) },
          log,
          {
            prefix,
            versions,
          },
        );
        const queued = queuedBoardWriter(redisUrl ?? '', { prefix });
        const web = await createApp({ config, db, auth, log, ...deps, versions: queued.versions });
        try {
          const version = await changedBoard(boardId, 'owner', web);
          const viewer = connect('viewer', boardId);
          await viewer.synced;
          const res = await request(
            'POST',
            `/boards/${boardId}/versions/${version.id}/restore`,
            'owner',
            undefined,
            web,
          );
          expect(res.statusCode).toBe(200);
          expect(res.json().backup.kind).toBe('restore');
          expectRestored(await read(boardId, (doc) => doc));
          await until(() => viewer.notices.length > 0);
          expect(viewer.notices).toContainEqual({ type: 'restored', versionId: version.id });
          // A version deleted meanwhile is a 404 from the collaboration server too.
          const gone = await queued.versions.restore({
            boardId,
            versionId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
            userId: people.owner?.id ?? '',
          });
          expect(gone).toEqual({ ok: false, reason: 'missing' });
        } finally {
          await web.close();
          await queued.close();
          await worker.close();
        }
      });

      it('changes nothing when the collaboration server does not take the job in time', async () => {
        const version = await changedBoard(boardId);
        const before = (await versionsOf(boardId)).length;
        const queued = queuedBoardWriter(redisUrl ?? '', {
          prefix: `${prefix}-idle`,
          timeoutMs: 300,
          graceMs: 300,
        });
        const web = await createApp({ config, db, auth, log, ...deps, versions: queued.versions });
        try {
          const res = await request(
            'POST',
            `/boards/${boardId}/versions/${version.id}/restore`,
            'editor',
            undefined,
            web,
          );
          expect(res.statusCode).toBe(500);
          // A worker that starts afterwards finds nothing to do.
          const worker = startBoardWorker(
            redisUrl ?? '',
            { addCard: async () => ({ ok: false, reason: 'column' }) },
            log,
            {
              prefix: `${prefix}-idle`,
              versions,
            },
          );
          await new Promise((r) => setTimeout(r, 500));
          await worker.close();
          expect((await versionsOf(boardId)).length).toBe(before);
          expect(await read(boardId, (doc) => roots(doc).elements.has('restore4'))).toBe(true);
        } finally {
          await web.close();
          await queued.close();
        }
      });

      it('refuses a job past its deadline without saving a backup', async () => {
        const version = await changedBoard(boardId);
        const before = (await versionsOf(boardId)).length;
        const late = await versions.restore({
          boardId,
          versionId: version.id,
          userId: people.editor?.id ?? '',
          expiresAt: Date.now() - 1,
        });
        expect(late).toEqual({ ok: false, reason: 'expired' });
        const save = await versions.save({
          boardId,
          name: 'Late',
          userId: people.editor?.id ?? '',
          expiresAt: Date.now() - 1,
        });
        expect(save).toEqual({ ok: false, reason: 'expired' });
        expect((await versionsOf(boardId)).length).toBe(before);
      });
    });
  });

  describe('access', () => {
    let version = '';
    let subVersion = '';
    let otherVersion = '';

    beforeAll(async () => {
      await clearBoard(boardId);
      version = (await insertVersion({ createdAt: new Date() })).id;
      subVersion = (await insertVersion({ boardId: subBoardId, createdAt: new Date() })).id;
      otherVersion = (await insertVersion({ boardId: otherBoardId, createdAt: new Date() })).id;
    });

    type Call = [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown];
    const calls = (b: string, v: string): Call[] => [
      ['GET', `/boards/${b}/versions`],
      ['POST', `/boards/${b}/versions`, { name: 'Mine' }],
      ['GET', `/boards/${b}/versions/${v}`],
      ['PATCH', `/boards/${b}/versions/${v}`, { name: 'Renamed' }],
      ['GET', `/boards/${b}/versions/${v}/state`],
      ['POST', `/boards/${b}/versions/${v}/restore`],
      ['DELETE', `/boards/${b}/versions/${v}`],
    ];

    it('needs editor: commenters and viewers get 403, outsiders 404, anonymous 401', async () => {
      for (const [method, path, payload] of calls(boardId, version)) {
        expect((await request(method, path, null, payload)).statusCode, path).toBe(401);
        expect((await request(method, path, 'stranger', payload)).statusCode, path).toBe(404);
        expect((await request(method, path, 'viewer', payload)).statusCode, path).toBe(403);
        expect((await request(method, path, 'commenter', payload)).statusCode, path).toBe(403);
      }
    });

    it('lets editors and owners do everything', async () => {
      for (const who of ['editor', 'owner']) {
        const id = (await insertVersion({ createdAt: new Date() })).id;
        for (const [method, path, payload] of calls(boardId, id)) {
          const res = await request(method, path, who, payload);
          expect(res.statusCode, `${who} ${method} ${path}`).toBeLessThan(300);
        }
      }
    });

    it('follows board grants: an editor lowered to viewer on a sub-board loses it there', async () => {
      await request('PUT', `/boards/${subBoardId}/grants/${people.editor?.id}`, 'owner', {
        role: 'viewer',
      });
      try {
        for (const suffix of ['', `/${subVersion}`])
          expect(
            (await request('GET', `/boards/${subBoardId}/versions${suffix}`, 'editor')).statusCode,
          ).toBe(403);
        expect((await request('GET', `/boards/${boardId}/versions`, 'editor')).statusCode).toBe(
          200,
        );
      } finally {
        await request('DELETE', `/boards/${subBoardId}/grants/${people.editor?.id}`, 'owner');
      }
    });

    it('answers 404 for a version of another board or project, and leaves it alone', async () => {
      for (const v of [subVersion, otherVersion])
        for (const [method, path, payload] of calls(boardId, v).slice(2)) {
          expect((await request(method, path, 'owner', payload)).statusCode, path).toBe(404);
        }
      // The other project's board itself is out of reach.
      for (const [method, path, payload] of calls(otherBoardId, otherVersion))
        expect((await request(method, path, 'owner', payload)).statusCode, path).toBe(404);
      const rows = await db.select().from(boardVersion).where(eq(boardVersion.id, otherVersion));
      expect(rows[0]?.name).toBeNull();
      expect(
        (await db.select().from(boardVersion).where(eq(boardVersion.id, subVersion))).length,
      ).toBe(1);
      // Unknown and malformed ids.
      expect(
        (
          await request(
            'GET',
            `/boards/${boardId}/versions/0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10/state`,
            'owner',
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await request('GET', `/boards/${boardId}/versions/nope/state`, 'owner')).statusCode,
      ).toBe(400);
    });

    it('follows the board to the trash, and goes with it when it is deleted', async () => {
      const trashed = await request('POST', `/projects/${projectId}/boards`, 'owner', {
        parentBoardId: boardId,
        title: 'Doomed',
      });
      const id = trashed.json().id as string;
      const v = (await insertVersion({ boardId: id, createdAt: new Date() })).id;
      expect((await request('DELETE', `/boards/${id}`, 'owner')).statusCode).toBe(204);
      for (const [method, path, payload] of calls(id, v))
        expect((await request(method, path, 'owner', payload)).statusCode, path).toBe(404);
      // Kept while the board is in the trash, so restoring the board brings them back.
      expect((await versionsOf(id)).length).toBe(1);
      await db.delete(board).where(eq(board.id, id));
      expect((await versionsOf(id)).length).toBe(0);
    });
  });
});
