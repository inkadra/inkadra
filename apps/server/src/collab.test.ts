import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  addElement,
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  newElementId,
  readElement,
  readPresence,
  roots,
} from '@inkadra/doc-schema';
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

  const as = (name: string) => ({ cookie: people[name]?.cookie ?? '' });

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

  function connect(credentials: { cookie?: string; token?: string }, origin?: string) {
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, {
          headers: credentials.cookie ? { cookie: credentials.cookie } : {},
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
      ...(credentials.token ? { token: credentials.token } : {}),
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

  /** Why the server closed the document, or null if it stays open for 4 s. */
  function closedWith(c: ReturnType<typeof connect>) {
    return new Promise<string | null>((resolve) => {
      c.provider.on('close', ({ event }: { event: { reason: string } }) => resolve(event.reason));
      setTimeout(() => resolve(null), 4000);
    });
  }

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

  it('closes the connection when access is removed and applies a lower role', async () => {
    const editor = connect(as('editor'));
    await editor.synced;
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
});
