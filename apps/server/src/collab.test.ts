import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { addElement, boardDocName, newElementId, readElement, roots } from '@inkadra/doc-schema';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from './auth.ts';
import { attachCollab, createCollabServer } from './collab.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { boardDoc } from './db/schema.ts';
import { createApp } from './http/app.ts';
import { testDeps } from './test-deps.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

describe.skipIf(!url)('collab (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 2);
  const auth = createAuth(config, db);
  const collab = createCollabServer({ db, auth, log, publicUrl: config.PUBLIC_URL });
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';
  let cookie = '';
  let boardId = '';

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth, log, ...testDeps(db, log) });
    attachCollab(app.server, collab);
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: 'a@example.com', password: 'correct-horse-battery', name: 'A' },
    });
    cookie = String(signUp.headers['set-cookie']).split(';')[0] ?? '';
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie },
      payload: { name: 'Collab' },
    });
    boardId = project.json().rootBoardId;
  });

  afterAll(async () => {
    await collab.destroy();
    await app?.close();
    await client.end();
  });

  function connect(withCookie: string, origin?: string) {
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, {
          headers: { cookie: withCookie },
          ...(origin ? { origin } : {}),
        });
      }
    }
    const doc = new Y.Doc();
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://${base}/collab`,
      WebSocketPolyfill: CookieSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: boardDocName(boardId),
      document: doc,
    });
    provider.attach();
    return { doc, provider, websocketProvider };
  }

  it('syncs a board between two clients and stores it', async () => {
    const a = connect(cookie);
    const b = connect(cookie);
    await Promise.all(
      [a, b].map((c) => new Promise<void>((resolve) => c.provider.on('synced', () => resolve()))),
    );
    expect(roots(a.doc).meta.get('schemaVersion')).toBe(1);

    const id = newElementId();
    addElement(a.doc, {
      id,
      type: 'column',
      title: 'Location',
      x: 0,
      y: 0,
      w: 280,
      z: 'a0',
      parent: null,
      createdBy: null,
      createdAt: Date.now(),
    });
    await expect.poll(() => roots(b.doc).elements.has(id), { timeout: 5000 }).toBe(true);
    expect(readElement(roots(b.doc).elements.get(id)!)?.type).toBe('column');

    for (const c of [a, b]) {
      c.provider.destroy();
      c.websocketProvider.destroy();
    }
    collab.hocuspocus.flushPendingStores();
    await expect
      .poll(
        async () => (await db.select().from(boardDoc).where(eq(boardDoc.boardId, boardId))).length,
        {
          timeout: 5000,
        },
      )
      .toBe(1);
  });

  it.each([
    ['anonymous connections', '', undefined],
    ['other origins', 'COOKIE', 'https://evil.example.com'],
  ])('refuses %s', async (_label, withCookie, origin) => {
    const c = connect(withCookie === 'COOKIE' ? cookie : withCookie, origin);
    const failed = await new Promise<boolean>((resolve) => {
      c.provider.on('authenticationFailed', () => resolve(true));
      setTimeout(() => resolve(false), 4000);
    });
    c.provider.destroy();
    c.websocketProvider.destroy();
    expect(failed).toBe(true);
  });
});
