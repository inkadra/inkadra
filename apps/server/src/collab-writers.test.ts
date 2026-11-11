import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  newElementId,
  roots,
} from '@inkadra/doc-schema';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from './auth.ts';
import { attachCollab, createCollabServer, writeRefusal } from './collab.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { createApp } from './http/app.ts';
import { testDeps } from './test-deps.ts';

// Counts the snapshots of whole documents the server takes (Hocuspocus has its own yjs import).
vi.mock('yjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yjs')>();
  return { ...actual, snapshot: vi.fn(actual.snapshot) };
});

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

const column = (title: string) => ({
  id: newElementId(),
  type: 'column' as const,
  title,
  x: 0,
  y: 0,
  w: 280,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: Date.now(),
});

it('tells a client that may not edit only that, whatever else holds the board', () => {
  expect(writeRefusal({ canEdit: false, frozen: true, schemaVersion: 30 })).toEqual({
    reason: 'role',
  });
  expect(writeRefusal({ canEdit: true, frozen: true, schemaVersion: 30 })).toEqual({
    reason: 'frozen',
  });
  expect(writeRefusal({ canEdit: true, frozen: false, schemaVersion: 30 })).toEqual({
    reason: 'schema',
    schemaVersion: 30,
  });
});

/**
 * Decision 0102 with a lowered `minWriterSchema`, as a release that declares a change safe for
 * older writers would set it: clients of that schema that declare the strict card check write;
 * the others, and older ones, read, and are told why their edits were refused.
 */
describe.skipIf(!url)('collab writers by schema (needs DATABASE_URL)', () => {
  const MIN = CURRENT_SCHEMA_VERSION - 1;
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
  const collab = createCollabServer({
    db,
    auth,
    log,
    publicUrl: config.PUBLIC_URL,
    recheckMs: 200,
    minWriterSchema: MIN,
  });
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';
  let boardId = '';
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
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: 'owner@example.com', password: 'correct-horse-battery', name: 'owner' },
    });
    cookie = String(res.headers['set-cookie']).split(';')[0] ?? '';
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie, origin: config.PUBLIC_URL },
      payload: { name: 'Writers' },
    });
    boardId = project.json().rootBoardId;
    const viewer = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: 'viewer@example.com', password: 'correct-horse-battery', name: 'viewer' },
    });
    viewerCookie = String(viewer.headers['set-cookie']).split(';')[0] ?? '';
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${project.json().id}/members/${viewer.json().user.id}`,
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

  function connect(schemaVersion: number, { strict = false, doc = new Y.Doc(), as = cookie } = {}) {
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie: as }, origin: config.PUBLIC_URL });
      }
    }
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://${base}/collab?schemaVersion=${schemaVersion}${strict ? '&strictCards=1' : ''}`,
      WebSocketPolyfill: CookieSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: boardDocName(boardId),
      document: doc,
    });
    provider.attach();
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    const notices: unknown[] = [];
    provider.on('stateless', ({ payload }: { payload: string }) =>
      notices.push(JSON.parse(payload)),
    );
    const conn = {
      doc,
      provider,
      synced,
      notices,
      close() {
        provider.destroy();
        websocketProvider.destroy();
      },
    };
    open.push(conn);
    return conn;
  }

  /** Whether an edit of `writer` reaches a client of the current schema. */
  async function writes(writer: ReturnType<typeof connect>) {
    const current = connect(CURRENT_SCHEMA_VERSION);
    await Promise.all([current.synced, writer.synced]);
    const el = column('Probe');
    addElement(writer.doc, el);
    const marker = column('Marker');
    addElement(current.doc, marker);
    await expect.poll(() => roots(writer.doc).elements.has(marker.id)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const arrived = roots(current.doc).elements.has(el.id);
    current.close();
    return arrived;
  }

  it.each([
    ['the current schema, with the strict check', CURRENT_SCHEMA_VERSION, true, true],
    ['the current schema, without it', CURRENT_SCHEMA_VERSION, false, true],
    ['minWriterSchema, with the strict check', MIN, true, true],
    ['minWriterSchema, without it', MIN, false, false],
    ['older than minWriterSchema, with the strict check', MIN - 1, true, false],
  ])('a client of %s writes only if allowed', async (_, schema, strict, expected) => {
    const writer = connect(schema, { strict });
    expect(await writes(writer)).toBe(expected);
    expect(writer.provider.authorizedScope).toBe(expected ? 'read-write' : 'readonly');
    writer.close();
  });

  it('keeps a client of minWriterSchema with the strict check writing after the rechecks', async () => {
    const writer = connect(MIN, { strict: true });
    await writer.synced;
    // The test server rechecks every 200 ms.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(await writes(writer)).toBe(true);
    writer.close();
  });

  it('says why the edits of a client were refused', async () => {
    const tooOld = connect(MIN - 1, { strict: true });
    const unchecked = connect(MIN);
    const viewer = connect(CURRENT_SCHEMA_VERSION, { as: viewerCookie });
    for (const c of [tooOld, unchecked, viewer]) expect(await writes(c)).toBe(false);
    await expect
      .poll(() => tooOld.notices)
      .toContainEqual({
        type: 'writeRefused',
        reason: 'schema',
        schemaVersion: MIN,
      });
    await expect
      .poll(() => unchecked.notices)
      .toContainEqual({
        type: 'writeRefused',
        reason: 'schema',
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
    await expect
      .poll(() => viewer.notices)
      .toContainEqual({ type: 'writeRefused', reason: 'role' });
    for (const c of [tooOld, unchecked, viewer]) c.close();
  });

  it('reads no whole document to answer a read-only client', async () => {
    const snapshot = vi.mocked(Y.snapshot);
    snapshot.mockClear();
    const viewer = connect(CURRENT_SCHEMA_VERSION, { as: viewerCookie });
    expect(await writes(viewer)).toBe(false);
    // Reconnecting sends the whole sync again.
    viewer.close();
    const again = connect(CURRENT_SCHEMA_VERSION, { as: viewerCookie, doc: viewer.doc });
    await again.synced;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(snapshot).not.toHaveBeenCalled();
    again.close();
  });

  it('accepts what a client of minWriterSchema with the strict check edited offline', async () => {
    const current = connect(CURRENT_SCHEMA_VERSION);
    const older = connect(MIN, { strict: true });
    await Promise.all([current.synced, older.synced]);
    older.close();
    // Offline: the edit waits in the client's document until it connects again.
    const offline = column('Edited offline');
    addElement(older.doc, offline);
    const back = connect(MIN, { strict: true, doc: older.doc });
    await back.synced;
    await expect.poll(() => roots(current.doc).elements.has(offline.id)).toBe(true);
    current.close();
    back.close();
  });
});
