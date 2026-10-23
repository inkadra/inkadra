import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  addElement,
  boardDocName,
  type Element,
  newElementId,
  readElement,
  roots,
  UNSORTED,
} from '@inkadra/doc-schema';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { directBoardWriter } from '../board-writer.ts';
import { attachCollab, createCollabServer } from '../collab.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, boardElementIndex } from '../db/schema.ts';
import { queuedBoardWriter, startBoardWorker } from '../queues.ts';
import { fragmentText } from '../search/index-doc.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe.skipIf(!url)('clip (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
    UPLOAD_MAX_SIZE: '1MB',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const auth = createAuth(config, db);
  const deps = testDeps(db, log);
  const collab = createCollabServer({ db, auth, log, publicUrl: config.PUBLIC_URL });
  let app: Awaited<ReturnType<typeof createApp>>;
  let site: Server;
  let siteUrl = '';
  let base = '';
  let boardId = '';
  let projectId = '';
  let token = '';
  let png = Buffer.alloc(0);
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

  /** Over a real socket: forms and their files are streamed. */
  async function clip(
    body: Record<string, unknown> | FormData,
    auth: { cookie?: string; token?: string } = { token },
  ) {
    const headers: Record<string, string> = {};
    if (auth.cookie) headers.cookie = auth.cookie;
    if (auth.token) headers.authorization = `Bearer ${auth.token}`;
    if (!(body instanceof FormData)) headers['content-type'] = 'application/json';
    const res = await fetch(`http://${base}/api/v1/clip`, {
      method: 'POST',
      headers,
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    // A ClipResult, or an ApiError: tests look at whichever they expect.
    type Reply = {
      boardId: string;
      elementId: string;
      assetId: string;
      error: { message: string };
    };
    return { status: res.status, json: (await res.json()) as Reply };
  }

  function form(fields: Record<string, string | string[]>, file?: [Buffer, string, string]) {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields))
      for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
    if (file) data.append('file', new Blob([file[0]], { type: file[2] }), file[1]);
    return data;
  }

  function connect(cookie: string) {
    class CookieSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: { cookie } });
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
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    const conn = {
      doc,
      synced,
      close() {
        provider.destroy();
        websocketProvider.destroy();
      },
    };
    open.push(conn);
    return conn;
  }

  /** The board document as stored, read through a direct connection. */
  async function boardElement(elementId: string) {
    const connection = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
    try {
      const map = connection.document?.getMap<Y.Map<unknown>>('elements').get(elementId);
      const body = map?.get('body');
      return {
        element: map ? readElement(map) : null,
        body: body instanceof Y.XmlFragment ? body : null,
        text: body instanceof Y.XmlFragment ? fragmentText(body) : '',
        xml: body instanceof Y.XmlFragment ? body.toString() : '',
      };
    } finally {
      await connection.disconnect();
    }
  }

  const indexRow = async (elementId: string) =>
    (
      await db
        .select()
        .from(boardElementIndex)
        .where(
          and(eq(boardElementIndex.boardId, boardId), eq(boardElementIndex.elementId, elementId)),
        )
    )[0];

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth,
      log,
      ...deps,
      boards: directBoardWriter(collab),
      tmpDir: deps.root,
      allowAddresses: ['127.0.0.1'],
    });
    attachCollab(app.server, collab);
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    for (const name of ['owner', 'viewer', 'stranger']) await signUp(name);
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: people.owner?.cookie ?? '' },
      payload: { name: 'Clip' },
    });
    boardId = project.json().rootBoardId;
    projectId = project.json().id;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/members/${people.viewer?.id}`,
      headers: { cookie: people.owner?.cookie ?? '' },
      payload: { role: 'viewer' },
    });
    token = (await issueToken(db, people.owner?.id ?? '', { name: 'Clipper', expiresAt: null }))
      .token;

    png = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#3060d0' } })
      .png()
      .toBuffer();
    site = createServer((req, res) => {
      if (req.url === '/article') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html><head><title>Fallback</title>
          <meta property="og:title" content="Sopralluogo al faro">
          <meta name="description" content="Luce radente alle sei">
          <meta property="og:image" content="/cover.png"></head><body>…</body></html>`);
      } else if (req.url === '/cover.png' || req.url === '/still') {
        res.setHeader('content-type', 'image/png');
        res.end(png);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const c of open) c.close();
    site?.close();
    await collab.destroy();
    await app?.close();
    await client.end();
  });

  it('saves a link with its preview, a note and tags, with a token', async () => {
    const res = await clip({
      boardId,
      url: `${siteUrl}/article`,
      note: 'Per la scena 12',
      tags: ['#Location', 'location', 'Faro  Nord'],
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ boardId, assetId: null });
    const { element } = await boardElement(res.json.elementId);
    expect(element).toMatchObject({
      type: 'link',
      url: `${siteUrl}/article`,
      title: 'Sopralluogo al faro',
      description: 'Per la scena 12',
      parent: UNSORTED,
      tags: ['location', 'faro nord'],
      createdBy: people.owner?.id,
    });
    // The page's image is copied into the project and processed.
    await deps.jobs.idle();
    const [cover] = await db
      .select()
      .from(asset)
      .where(eq(asset.id, (element as Extract<Element, { type: 'link' }>).imageAssetId ?? ''));
    expect(cover).toMatchObject({ status: 'ready', projectId, width: 640 });
    // Search sees it like any other edit.
    expect(await indexRow(res.json.elementId)).toMatchObject({
      type: 'link',
      title: 'Sopralluogo al faro',
      tags: ['location', 'faro nord'],
    });
  });

  it('saves a quoted text as a note that links to its page', async () => {
    const res = await clip(
      {
        boardId,
        text: 'La luce entra di taglio\ndalla finestra a est.',
        sourceUrl: 'https://example.com/diario/faro',
        note: 'Da provare in scouting',
      },
      { cookie: people.owner?.cookie },
    );
    expect(res.status).toBe(201);
    const { element, xml, text } = await boardElement(res.json.elementId);
    expect(element).toMatchObject({ type: 'note', parent: UNSORTED });
    expect(xml).toContain('<blockquote><paragraph>La luce entra di taglio</paragraph>');
    expect(xml).toContain('https://example.com/diario/faro');
    expect(text).toContain('Da provare in scouting');
    expect(text).toContain('example.com');
    expect((await indexRow(res.json.elementId))?.text).toContain('La luce entra di taglio');
  });

  it('downloads an image address into an image card', async () => {
    const res = await clip({
      boardId,
      url: `${siteUrl}/still`,
      sourceUrl: 'https://example.com/gallery',
      note: 'Palette fredda',
    });
    expect(res.status).toBe(201);
    expect(res.json.assetId).toEqual(expect.any(String));
    const { element } = await boardElement(res.json.elementId);
    expect(element).toMatchObject({
      type: 'image',
      assetId: res.json.assetId,
      caption: 'Palette fredda',
    });
    await deps.jobs.idle();
    const [row] = await db.select().from(asset).where(eq(asset.id, res.json.assetId));
    expect(row).toMatchObject({
      kind: 'image',
      status: 'ready',
      sourceUrl: 'https://example.com/gallery',
      width: 640,
    });
  });

  it('stores a sent image like an upload, thumbnails included', async () => {
    // Declared vaguely, as share sheets often do: the first bytes say it is a PNG.
    const res = await clip(
      form({ boardId, note: 'Dal telefono', tags: ['Mood'] }, [
        png,
        'IMG_0042.png',
        'application/octet-stream',
      ]),
    );
    expect(res.status).toBe(201);
    const { element } = await boardElement(res.json.elementId);
    expect(element).toMatchObject({ type: 'image', caption: 'Dal telefono', tags: ['mood'] });
    await deps.jobs.idle();
    const detail = await app.inject({
      url: `/api/v1/assets/${res.json.assetId}`,
      headers: { cookie: people.owner?.cookie ?? '' },
    });
    expect(detail.json()).toMatchObject({
      status: 'ready',
      kind: 'image',
      mime: 'image/png',
      filename: 'IMG_0042.png',
      size: png.length,
    });
    expect(detail.json().variants.length).toBeGreaterThan(0);
    const file = await fetch(`http://${base}/api/v1/assets/${res.json.assetId}/file`, {
      headers: { cookie: people.owner?.cookie ?? '' },
    });
    expect(Buffer.from(await file.arrayBuffer()).equals(png)).toBe(true);
  });

  it('stores any other file as a file card, found by its name', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% shooting schedule\n');
    const res = await clip(form({ boardId }, [pdf, 'odg-giorno-3.pdf', 'application/pdf']));
    expect(res.status).toBe(201);
    const { element } = await boardElement(res.json.elementId);
    expect(element).toMatchObject({ type: 'file', assetId: res.json.assetId });
    const [row] = await db.select().from(asset).where(eq(asset.id, res.json.assetId));
    expect(row).toMatchObject({ kind: 'file', mime: 'application/pdf', size: pdf.length });
    expect((await indexRow(res.json.elementId))?.title).toBe('odg-giorno-3.pdf');
  });

  it('puts the card at the bottom of the column it is given', async () => {
    const columnId = newElementId();
    const connection = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
    await connection.transact((doc) => {
      addElement(doc, {
        id: columnId,
        type: 'column',
        title: 'Riferimenti',
        x: 0,
        y: 0,
        w: 260,
        z: 'a0',
        parent: null,
        createdBy: null,
        createdAt: Date.now(),
      });
    });
    await connection.disconnect();
    const first = await clip({ boardId, columnId, text: 'Uno' });
    const second = await clip({ boardId, columnId, text: 'Due' });
    expect([first.status, second.status]).toEqual([201, 201]);
    const a = (await boardElement(first.json.elementId)).element;
    const b = (await boardElement(second.json.elementId)).element;
    expect(a?.parent).toBe(columnId);
    expect(b?.parent).toBe(columnId);
    expect((b?.z ?? '') > (a?.z ?? '')).toBe(true);
  });

  it('refuses a column that is not on the board, and keeps no file', async () => {
    const before = await db.select().from(asset).where(eq(asset.projectId, projectId));
    const json = await clip({ boardId, columnId: 'not-a-column-0001', text: 'Persa' });
    expect(json.status).toBe(400);
    expect(json.json.error.message).toMatch(/column/);
    const sent = await clip(
      form({ boardId, columnId: 'not-a-column-0001' }, [png, 'x.png', 'image/png']),
    );
    expect(sent.status).toBe(400);
    await deps.jobs.idle();
    const after = await db.select().from(asset).where(eq(asset.projectId, projectId));
    expect(after.length).toBe(before.length);
  });

  it('refuses viewers, strangers, anonymous requests and empty clips', async () => {
    const viewer = await clip({ boardId, text: 'No' }, { cookie: people.viewer?.cookie });
    expect(viewer.status).toBe(403);
    const sentByViewer = await clip(form({ boardId }, [png, 'x.png', 'image/png']), {
      cookie: people.viewer?.cookie,
    });
    expect(sentByViewer.status).toBe(403);
    expect((await clip({ boardId, text: 'No' }, { cookie: people.stranger?.cookie })).status).toBe(
      404,
    );
    expect((await clip({ boardId, text: 'No' }, {})).status).toBe(401);
    expect((await clip({ boardId })).status).toBe(400);
    expect((await clip(form({ boardId }))).status).toBe(400);
    expect((await clip({ boardId, url: 'ftp://example.com/a.jpg' })).status).toBe(400);
  });

  it('refuses files over UPLOAD_MAX_SIZE', async () => {
    const big = Buffer.alloc(1024 * 1024 + 1, 1);
    const res = await clip(form({ boardId }, [big, 'big.bin', 'application/octet-stream']));
    expect(res.status).toBe(413);
  });

  it('shows the card on open boards within two seconds', async () => {
    const live = connect(people.owner?.cookie ?? '');
    await live.synced;
    const res = await clip({ boardId, text: 'In diretta' });
    expect(res.status).toBe(201);
    await expect
      .poll(() => roots(live.doc).elements.has(res.json.elementId), { timeout: 2000 })
      .toBe(true);
    const map = roots(live.doc).elements.get(res.json.elementId);
    expect(map && readElement(map)).toMatchObject({ type: 'note', createdBy: people.owner?.id });
    live.close();
  });

  it.skipIf(!redisUrl)('goes through the queue when collab runs on its own', async () => {
    const prefix = `inkadra-test-${process.pid}`;
    const worker = startBoardWorker(redisUrl ?? '', directBoardWriter(collab), log, { prefix });
    const queued = queuedBoardWriter(redisUrl ?? '', { prefix });
    try {
      const placed = await queued.writer.addCard({
        boardId,
        userId: people.owner?.id ?? '',
        card: { type: 'note', fields: {}, body: [{ kind: 'paragraph', text: 'Dalla coda' }] },
      });
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;
      expect((await boardElement(placed.elementId)).text).toBe('Dalla coda');
      expect(
        await queued.writer.addCard({
          boardId,
          columnId: 'not-a-column-0001',
          userId: people.owner?.id ?? '',
          card: { type: 'note', fields: {} },
        }),
      ).toEqual({ ok: false, reason: 'column' });
    } finally {
      await queued.close();
      await worker.close();
    }
  });
});
