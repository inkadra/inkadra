import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  getMinWriterSchema,
  newElementId,
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

/**
 * Decision 0102 with a lowered `minWriterSchema`, as a release that declares a change safe for
 * older writers would set it: clients of that schema write, older ones read.
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
  });

  afterAll(async () => {
    for (const c of open) c.close();
    await collab.destroy();
    await app?.close();
    await client.end();
  });

  function connect(schemaVersion: number, doc = new Y.Doc()) {
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie }, origin: config.PUBLIC_URL });
      }
    }
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://${base}/collab?schemaVersion=${schemaVersion}`,
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

  it('records the lowered minimum in the document for clients', async () => {
    const current = connect(CURRENT_SCHEMA_VERSION);
    await current.synced;
    expect(getMinWriterSchema(current.doc)).toBe(MIN);
    current.close();
  });

  it('lets a client of minWriterSchema write, also after the access rechecks', async () => {
    const current = connect(CURRENT_SCHEMA_VERSION);
    const older = connect(MIN);
    await Promise.all([current.synced, older.synced]);
    expect(older.provider.authorizedScope).toBe('read-write');
    const first = column('Older writer');
    addElement(older.doc, first);
    await expect.poll(() => roots(current.doc).elements.has(first.id)).toBe(true);
    // The test server rechecks every 200 ms.
    await new Promise((resolve) => setTimeout(resolve, 450));
    const second = column('Still writing');
    addElement(older.doc, second);
    await expect.poll(() => roots(current.doc).elements.has(second.id)).toBe(true);
    current.close();
    older.close();
  });

  it('keeps a client older than minWriterSchema read-only', async () => {
    const current = connect(CURRENT_SCHEMA_VERSION);
    const tooOld = connect(MIN - 1);
    await Promise.all([current.synced, tooOld.synced]);
    expect(tooOld.provider.authorizedScope).toBe('readonly');
    const forged = column('Too old');
    addElement(tooOld.doc, forged);
    const real = column('Current');
    addElement(current.doc, real);
    await expect.poll(() => roots(tooOld.doc).elements.has(real.id)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(roots(current.doc).elements.has(forged.id)).toBe(false);
    current.close();
    tooOld.close();
  });

  it('accepts what a client of minWriterSchema edited offline', async () => {
    const current = connect(CURRENT_SCHEMA_VERSION);
    const older = connect(MIN);
    await Promise.all([current.synced, older.synced]);
    older.close();
    // Offline: the edit waits in the client's document until it connects again.
    const offline = column('Edited offline');
    addElement(older.doc, offline);
    const back = connect(MIN, older.doc);
    await back.synced;
    await expect.poll(() => roots(current.doc).elements.has(offline.id)).toBe(true);
    current.close();
    back.close();
  });
});
