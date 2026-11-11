import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from './auth.ts';
import { directBoardNotifier, NOTICE_TTL_MS } from './board-notices.ts';
import { directBoardWriter } from './board-writer.ts';
import { attachCollab, createCollabServer } from './collab.ts';
import { loadConfig } from './config.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { boardDoc, boardElementIndex, notification, projectMember } from './db/schema.ts';
import { createApp } from './http/app.ts';
import * as drawings from './image-drawing.ts';
import { createRedis, QUEUES, queuedBoardNotifier, startBoardWorker } from './queues.ts';
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
  ) {
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
      url: `ws://${base}/collab${schemaVersion === null ? '' : `?schemaVersion=${schemaVersion}`}`,
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
    const conn = {
      doc,
      provider,
      websocketProvider,
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
    expect(await closed).toBe('token_revoked');
    c.close();
    const retry = connect({ token: created.json().token });
    const reason = await new Promise<string>((resolve) => {
      retry.provider.on('authenticationFailed', ({ reason }: { reason: string }) => resolve(reason));
      setTimeout(() => resolve('timeout'), 4000);
    });
    retry.close();
    expect(reason).toBe('token_revoked');
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
    // The client was told, so its editor turns read-only too.
    expect(notices).toEqual([{ type: 'access', readOnly: true }]);

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
