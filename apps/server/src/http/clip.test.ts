import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import {
  type AddressInfo,
  connect as connectTcp,
  createServer as createNetServer,
  type Socket,
} from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { Queue, QueueEvents } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createAuth } from '../auth.ts';
import { directBoardReader } from '../board-content.ts';
import { BoardEditNotStarted, type BoardWriter, directBoardWriter } from '../board-writer.ts';
import { attachCollab, createCollabServer } from '../collab.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, boardElementIndex } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import {
  CardOutcomeUnknown,
  createQueues,
  createRedis,
  QUEUES,
  queuedBoardWriter,
  startBoardWorker,
} from '../queues.ts';
import { fragmentText } from '../search/index-doc.ts';
import { testDeps } from '../test-deps.ts';
import { issueToken } from '../tokens.ts';
import { createApp } from './app.ts';
import { sweepClipTemp } from './clip-routes.ts';

const url = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * A TCP proxy to Valkey that can hold its traffic back or go away for good, as Valkey does in
 * an outage that starts after the connection was made.
 */
async function valkeyProxy(target: string) {
  const to = new URL(target);
  const sockets = new Set<Socket>();
  let held: Array<() => void> | null = null;
  let repliesOnly = false;
  const server = createNetServer((client) => {
    const upstream = connectTcp(Number(to.port || 6379), to.hostname);
    for (const [from, into] of [
      [client, upstream],
      [upstream, client],
    ] as const) {
      sockets.add(from);
      from.on('data', (chunk) =>
        held && (!repliesOnly || from === upstream)
          ? held.push(() => into.write(chunk))
          : into.write(chunk),
      );
      from.on('close', () => into.destroy());
      from.on('error', () => into.destroy());
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxied = new URL(target);
  proxied.hostname = '127.0.0.1';
  proxied.port = String((server.address() as AddressInfo).port);
  return {
    url: proxied.toString(),
    hold() {
      repliesOnly = false;
      held ??= [];
    },
    holdReplies() {
      repliesOnly = true;
      held ??= [];
    },
    release() {
      const queued = held ?? [];
      held = null;
      for (const send of queued) send();
    },
    cut() {
      server.close();
      for (const socket of sockets) socket.destroy();
    },
  };
}

describe('sweepClipTemp', () => {
  it('removes clip folders left for more than an hour, and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-sweep-'));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const name of ['clip-old', 'clip-new', 'media-old']) mkdirSync(join(dir, name));
    utimesSync(join(dir, 'clip-old'), old, old);
    utimesSync(join(dir, 'media-old'), old, old);
    expect(await sweepClipTemp(dir)).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['clip-new', 'media-old']);
    expect(await sweepClipTemp(join(dir, 'missing'))).toBe(0);
  });

  it('keeps an old folder whose file is still being received, by another replica', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-sweep-'));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const name of ['clip-receiving', 'clip-crashed']) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'file'), 'chunk');
    }
    // A long upload: the folder was made hours ago, its file grew a moment ago.
    utimesSync(join(dir, 'clip-receiving'), old, old);
    utimesSync(join(dir, 'clip-crashed', 'file'), old, old);
    utimesSync(join(dir, 'clip-crashed'), old, old);
    expect(await sweepClipTemp(dir)).toBe(1);
    expect(readdirSync(dir)).toEqual(['clip-receiving']);
  });

  it('keeps future timestamps and recent writes despite clock skew between replicas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkadra-sweep-'));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const [name, offset] of [
      ['clip-ahead', 5000],
      ['clip-behind', -5000],
    ] as const) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'file'), 'chunk');
      const modified = new Date(Date.now() + offset);
      utimesSync(join(dir, name, 'file'), modified, modified);
      utimesSync(join(dir, name), old, old);
    }
    expect(await sweepClipTemp(dir)).toBe(0);
  });
});

describe.skipIf(!url)('clip (needs DATABASE_URL)', () => {
  const env = {
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
    UPLOAD_MAX_SIZE: '1MB',
  };
  const config = loadConfig(env);
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
  /** Requests that reached the site's /secret page, which no clip may fetch. */
  let secretHits = 0;
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
    at = base,
  ) {
    const headers: Record<string, string> = {};
    if (auth.cookie) Object.assign(headers, { cookie: auth.cookie, origin: config.PUBLIC_URL });
    if (auth.token) headers.authorization = `Bearer ${auth.token}`;
    if (!(body instanceof FormData)) headers['content-type'] = 'application/json';
    const res = await fetch(`http://${at}/api/v1/clip`, {
      method: 'POST',
      headers,
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    // A ClipResult, or an ApiError: tests look at whichever they expect.
    type Reply = {
      boardId: string;
      elementId: string;
      assetId: string;
      error: { message: string; details?: { reason?: string } };
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

  /** Another app on the same database and collaboration server, with its own settings. */
  async function otherApp(opts: {
    env?: Record<string, string>;
    boards?: BoardWriter;
    jobs?: Jobs;
  }) {
    const other = await createApp({
      config: loadConfig({ ...env, ...opts.env }),
      db,
      auth,
      log,
      ...deps,
      jobs: opts.jobs ?? deps.jobs,
      boards: opts.boards ?? directBoardWriter(collab),
      tmpDir: deps.root,
      allowAddresses: ['127.0.0.1'],
    });
    await other.listen({ host: '127.0.0.1', port: 0 });
    return { app: other, base: `127.0.0.1:${(other.server.address() as AddressInfo).port}` };
  }

  const tempDirs = () => readdirSync(deps.root).filter((name) => name.startsWith('clip-'));
  const projectAssets = async () =>
    (await db.select({ id: asset.id }).from(asset).where(eq(asset.projectId, projectId))).length;

  /** Text of every note on the board, as stored. */
  async function boardTexts() {
    const connection = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
    try {
      const texts: string[] = [];
      for (const map of connection.document?.getMap<Y.Map<unknown>>('elements').values() ?? []) {
        const body = map.get('body');
        if (body instanceof Y.XmlFragment) texts.push(fragmentText(body));
      }
      return texts;
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
      boardReader: directBoardReader(collab, db),
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
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
      payload: { name: 'Clip' },
    });
    boardId = project.json().rootBoardId;
    projectId = project.json().id;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/members/${people.viewer?.id}`,
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
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
      } else if (req.url === '/secret') {
        secretHits += 1;
        res.setHeader('content-type', 'text/html');
        res.end('<title>Internal</title>');
      } else if (req.url === '/to-private') {
        res.statusCode = 302;
        res.setHeader(
          'location',
          `http://localhost:${(site.address() as AddressInfo).port}/secret`,
        );
        res.end();
      } else if (req.url === '/huge') {
        // Over the 1 MB a page may have, though well under the image limit.
        res.setHeader('content-type', 'text/html');
        res.end(`<title>Enorme</title>${'x'.repeat(2 * 1024 * 1024)}`);
      } else if (req.url === '/fake.png') {
        res.setHeader('content-type', 'image/png');
        res.end('<html><title>Not a picture</title></html>');
      } else if (req.url === '/cut') {
        res.setHeader('content-type', 'text/html');
        res.setHeader('content-length', '100000');
        res.write('<title>Interrotta</title>');
        setTimeout(() => res.socket?.destroy(), 20);
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
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
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
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
    });
    expect(Buffer.from(await file.arrayBuffer()).equals(png)).toBe(true);
  });

  it('keeps a PDF note as its caption and finds the file by that caption', async () => {
    const caption = 'Call sheet for the observatory';
    const pdf = Buffer.from('%PDF-1.4\n% shooting schedule\n');
    const res = await clip(
      form({ boardId, note: caption }, [pdf, 'schedule.pdf', 'application/pdf']),
    );
    expect(res.status).toBe(201);
    const { element } = await boardElement(res.json.elementId);
    expect(element).toMatchObject({ type: 'file', assetId: res.json.assetId, caption });
    const [row] = await db.select().from(asset).where(eq(asset.id, res.json.assetId));
    expect(row).toMatchObject({ kind: 'file', mime: 'application/pdf', size: pdf.length });
    expect(await indexRow(res.json.elementId)).toMatchObject({
      title: 'schedule.pdf',
      text: `schedule.pdf ${caption}`,
    });
    const search = await fetch(`http://${base}/api/v1/search?q=observatory`, {
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
    });
    expect(search.status).toBe(200);
    expect(((await search.json()) as { items: unknown[] }).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ elementId: res.json.elementId, elementType: 'file' }),
      ]),
    );
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

  it('keeps a link card with the bare address when the page cannot be read', async () => {
    const port = (site.address() as AddressInfo).port;
    for (const page of [
      // Private, directly or through a redirect: never fetched.
      `http://localhost:${port}/secret`,
      `${siteUrl}/to-private`,
      // An image that is not one, a connection cut mid-page.
      `${siteUrl}/fake.png`,
      `${siteUrl}/cut`,
    ]) {
      const res = await clip({ boardId, url: page });
      expect(res.status, page).toBe(201);
      expect(res.json.assetId, page).toBeNull();
      const { element } = await boardElement(res.json.elementId);
      expect(element, page).toMatchObject({ type: 'link', url: page });
      expect((element as Extract<Element, { type: 'link' }>).title, page).toBeUndefined();
    }
    expect(secretHits).toBe(0);
  });

  it('reads the title from the start of a page over 1 MB', async () => {
    const page = `${siteUrl}/huge`;
    const res = await clip({ boardId, url: page });
    expect(res.status).toBe(201);
    const { element } = await boardElement(res.json.elementId);
    expect(element).toMatchObject({ type: 'link', url: page, title: 'Enorme' });
  });

  it('refuses a sourceUrl that is not a web address', async () => {
    for (const sourceUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
      const res = await clip({ boardId, text: 'Citazione', sourceUrl });
      expect(res.status, sourceUrl).toBe(400);
    }
  });

  it('refuses a board in the trash', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/boards`,
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
      payload: { parentBoardId: boardId, title: 'Scartata' },
    });
    const trashed = created.json().id as string;
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/boards/${trashed}`,
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
    });
    expect((await clip({ boardId: trashed, text: 'Nel cestino' })).status).toBe(404);
    const sent = await clip(form({ boardId: trashed }, [png, 'x.png', 'image/png']));
    expect(sent.status).toBe(404);
    expect(tempDirs()).toEqual([]);
  });

  it('needs boardId before the file, and stores nothing it may not keep', async () => {
    const before = await projectAssets();
    // The file first: refused before a byte of it is written, whoever sends it.
    const fileFirst = new FormData();
    fileFirst.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
    fileFirst.append('boardId', boardId);
    const early = await clip(fileFirst);
    expect(early.status).toBe(400);
    expect(early.json.error.message).toMatch(/boardId/);
    // A viewer, in the right order: refused before the file is written.
    const viewer = await clip(form({ boardId }, [png, 'x.png', 'image/png']), {
      cookie: people.viewer?.cookie,
    });
    expect(viewer.status).toBe(403);
    // Too large, empty, two files.
    const big = await clip(
      form({ boardId }, [Buffer.alloc(1024 * 1024 + 1, 1), 'big.bin', 'application/octet-stream']),
    );
    expect(big.status).toBe(413);
    const empty = await clip(form({ boardId }, [Buffer.alloc(0), 'empty.txt', 'text/plain']));
    expect(empty.status).toBe(400);
    const two = form({ boardId }, [png, 'a.png', 'image/png']);
    two.append('file', new Blob([png], { type: 'image/png' }), 'b.png');
    expect((await clip(two)).status).toBe(400);
    await deps.jobs.idle();
    expect(await projectAssets()).toBe(before);
    await expect.poll(tempDirs).toEqual([]);
  });

  it('removes the temporary file once a sent file is stored', async () => {
    const res = await clip(form({ boardId }, [png, 'tmp.png', 'image/png']));
    expect(res.status).toBe(201);
    await expect.poll(tempDirs).toEqual([]);
  });

  it('takes files of any size with UPLOAD_MAX_SIZE=0', async () => {
    const other = await otherApp({ env: { UPLOAD_MAX_SIZE: '0' } });
    try {
      // Over Fastify's 1 MiB body limit, which multipart would otherwise fall back to.
      const big = Buffer.alloc(3 * 1024 * 1024, 7);
      const res = await clip(
        form({ boardId }, [big, 'scan.bin', 'application/octet-stream']),
        { token },
        other.base,
      );
      expect(res.status).toBe(201);
      const [row] = await db.select().from(asset).where(eq(asset.id, res.json.assetId));
      expect(row).toMatchObject({ kind: 'file', size: big.length });
    } finally {
      await other.app.close();
    }
  });

  it('keeps the files when the board may have the card but did not confirm it', async () => {
    const unsure: BoardWriter = {
      async addCard() {
        throw new CardOutcomeUnknown('no answer');
      },
    };
    const other = await otherApp({ boards: unsure });
    try {
      const res = await clip(
        form({ boardId }, [png, 'forse.png', 'image/png']),
        { token },
        other.base,
      );
      expect(res.status).toBe(500);
      expect(res.json.error.message).toMatch(/check/);
      expect(res.json.error.details).toEqual({ reason: 'outcome_unknown' });
      const rows = await db.select().from(asset).where(eq(asset.filename, 'forse.png'));
      expect(rows.length).toBe(1);
    } finally {
      await other.app.close();
    }
  });

  it('answers a refused file at once, without reading it first', async () => {
    const other = await otherApp({ env: { UPLOAD_MAX_SIZE: '0' } });
    try {
      // Far more than the socket buffers hold: unread, the sender would wait forever.
      const big = Buffer.alloc(32 * 1024 * 1024, 7);
      const started = Date.now();
      const res = await clip(
        form({ boardId }, [big, 'grande.bin', 'application/octet-stream']),
        { cookie: people.viewer?.cookie },
        other.base,
      );
      expect(res.status).toBe(403);
      expect(Date.now() - started).toBeLessThan(5000);
      await expect.poll(tempDirs).toEqual([]);
    } finally {
      await other.app.close();
    }
  });

  it('ignores an empty tags field, as forms send for a blank input', async () => {
    const res = await clip(form({ boardId, tags: '' }, [png, 'senza-tag.png', 'image/png']));
    expect(res.status).toBe(201);
    expect((await boardElement(res.json.elementId)).element?.tags).toBeUndefined();
  });

  it('answers a link preview when its image cannot be queued', async () => {
    const down: Jobs = {
      async processAsset() {
        throw new Error('queue down');
      },
      async deleteFiles() {},
    };
    const other = await otherApp({ jobs: down });
    try {
      const res = await fetch(`http://${other.base}/api/v1/link-previews`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, boardId, url: `${siteUrl}/article` }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ title: 'Sopralluogo al faro' });
    } finally {
      await other.app.close();
    }
  });

  /** GET on the API as one of the people, over a real socket. */
  async function get(path: string, who?: string) {
    const headers: Record<string, string> = {};
    const cookie = who ? people[who]?.cookie : undefined;
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`http://${base}/api/v1${path}`, { headers });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  /** A board of its own, so the columns of other tests do not get in the way. */
  async function columnsBoard(title: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/boards`,
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
      payload: { parentBoardId: boardId, title },
    });
    return res.json().id as string;
  }

  function column(id: string, title: string, x: number, y: number, parent: string | null = null) {
    return {
      id,
      type: 'column' as const,
      title,
      x,
      y,
      w: 260,
      z: 'a0',
      parent,
      createdBy: null,
      createdAt: Date.now(),
    };
  }

  it('lists the columns of a live board, left to right then top to bottom', async () => {
    const board = await columnsBoard('Colonne');
    const [left, low, high, right] = [
      newElementId(),
      newElementId(),
      newElementId(),
      newElementId(),
    ];
    // Held open, as by a browser: nothing is stored yet, the live document has it all.
    const connection = await collab.hocuspocus.openDirectConnection(boardDocName(board));
    try {
      await connection.transact((doc) => {
        addElement(doc, column(right, 'Dopo', 900, 0));
        addElement(doc, column(low, 'Sotto', 300, 500));
        addElement(doc, column(high, '', 300, 100));
        addElement(doc, column(left, 'Prima', -200, 40));
        addElement(doc, {
          id: newElementId(),
          type: 'color',
          hex: '#FF0000',
          x: 0,
          y: 0,
          w: 100,
          z: 'a1',
          parent: null,
          createdBy: null,
          createdAt: Date.now(),
        });
      });
      const res = await get(`/boards/${board}/columns`, 'owner');
      expect(res.status).toBe(200);
      expect(res.json).toEqual({
        items: [
          { id: left, title: 'Prima' },
          { id: high, title: '' },
          { id: low, title: 'Sotto' },
          { id: right, title: 'Dopo' },
        ],
      });
      // Each one can be clipped to.
      const other = await otherApp({});
      const placed = await clip(
        { boardId: board, columnId: high, text: 'Qui' },
        { token },
        other.base,
      );
      await other.app.close();
      expect(placed.status).toBe(201);
      const card = connection.document
        ?.getMap<Y.Map<unknown>>('elements')
        .get(placed.json.elementId);
      expect(card?.get('parent')).toBe(high);
    } finally {
      await connection.disconnect();
    }
    // A board never opened has no columns, and no "Non ordinati" among them.
    expect((await get(`/boards/${await columnsBoard('Vuota')}/columns`, 'owner')).json).toEqual({
      items: [],
    });
  });

  it('lists columns to viewers and board guests, and to nobody else', async () => {
    const board = await columnsBoard('Permessi');
    for (const name of ['boardguest']) if (!people[name]) await signUp(name);
    const grant = await app.inject({
      method: 'PUT',
      url: `/api/v1/boards/${board}/grants/${people.boardguest?.id}`,
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
      payload: { role: 'viewer' },
    });
    expect(grant.statusCode).toBe(200);
    const path = `/boards/${board}/columns`;
    expect((await get(path, 'owner')).status).toBe(200);
    expect((await get(path, 'viewer')).status).toBe(200);
    // Given this board only: its columns, not those of the board above it.
    expect((await get(path, 'boardguest')).status).toBe(200);
    expect((await get(`/boards/${boardId}/columns`, 'boardguest')).status).toBe(404);
    expect((await get(path, 'stranger')).status).toBe(404);
    expect((await get(path)).status).toBe(401);
    // A board of another project, to its own owner but not to ours.
    const theirs = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: people.stranger?.cookie ?? '', origin: config.PUBLIC_URL },
      payload: { name: 'Altro' },
    });
    const otherBoard = theirs.json().rootBoardId as string;
    expect((await get(`/boards/${otherBoard}/columns`, 'stranger')).status).toBe(200);
    expect((await get(`/boards/${otherBoard}/columns`, 'owner')).status).toBe(404);
  });

  it('tells each person their role in search results', async () => {
    const owner = await get(`/search?q=${encodeURIComponent('Clip')}`, 'owner');
    const viewer = await get(`/search?q=${encodeURIComponent('Clip')}`, 'viewer');
    type Hit = { kind: string; myRole?: string };
    const roles = (res: { json: Record<string, unknown> }) =>
      (res.json.items as Hit[]).map((h) => [h.kind, h.myRole]);
    expect(roles(owner)).toContainEqual(['project', 'owner']);
    expect(roles(viewer)).toContainEqual(['project', 'viewer']);
    expect(roles(await get('/search?q=Permessi', 'owner'))).toEqual([['board', 'owner']]);
    expect(roles(await get('/search?q=Permessi', 'viewer'))).toEqual([['board', 'viewer']]);
    const cards = await get('/search?q=Qui', 'viewer');
    expect(roles(cards)).toContainEqual(['element', 'viewer']);
  });

  it('titles a saved link with the title it is sent, not the page one', async () => {
    const other = await otherApp({});
    try {
      const res = await clip(
        { boardId, url: `${siteUrl}/article`, title: '  Faro — scheda  ' },
        { token },
        other.base,
      );
      expect(res.status).toBe(201);
      expect((await boardElement(res.json.elementId)).element).toMatchObject({
        type: 'link',
        title: 'Faro — scheda',
        description: 'Luce radente alle sei',
      });
      // Ignored for anything that is not a link.
      const text = await clip({ boardId, text: 'Citazione', title: 'No' }, { token }, other.base);
      expect((await boardElement(text.json.elementId)).element).not.toHaveProperty('title');
    } finally {
      await other.app.close();
    }
  });

  it('uses the root board role for project hits and hides ancestors of partial grants', async () => {
    await signUp('searchpartial');
    const child = await columnsBoard('Partial role');
    const grant = async (id: string, role: string) => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/boards/${id}/grants/${people.searchpartial?.id}`,
        headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
        payload: { role },
      });
      expect(res.statusCode).toBe(200);
    };
    await grant(child, 'editor');
    expect((await get('/search?q=Partial', 'searchpartial')).json.items).toEqual([
      expect.objectContaining({ kind: 'board', boardId: child, myRole: 'editor' }),
    ]);
    expect((await get('/search?q=Clip', 'searchpartial')).json.items).toEqual([]);
    const membership = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/members/${people.searchpartial?.id}`,
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
      payload: { role: 'commenter' },
    });
    expect(membership.statusCode).toBe(200);
    expect((await get('/search?q=Clip', 'searchpartial')).json.items).toContainEqual(
      expect.objectContaining({ kind: 'project', projectId, myRole: 'commenter' }),
    );
    expect((await get('/search?q=Partial', 'searchpartial')).json.items).toEqual([
      expect.objectContaining({ kind: 'board', boardId: child, myRole: 'editor' }),
    ]);
  });

  it('says outcome_unknown only when the clip may be on the board', async () => {
    const halfway: BoardWriter = {
      async addCard() {
        throw new Error('write failed halfway');
      },
    };
    const unopened: BoardWriter = {
      async addCard() {
        throw new BoardEditNotStarted('The board document could not be opened.');
      },
    };
    const late: BoardWriter = {
      async addCard() {
        return { ok: false, reason: 'expired' };
      },
    };
    const send = async (boards: BoardWriter, name: string) => {
      const other = await otherApp({ boards });
      try {
        const res = await clip(form({ boardId }, [png, name, 'image/png']), { token }, other.base);
        const rows = await db.select().from(asset).where(eq(asset.filename, name));
        return { status: res.status, details: res.json.error.details, rows: rows.length };
      } finally {
        await other.app.close();
      }
    };
    expect(await send(halfway, 'meta.png')).toEqual({
      status: 500,
      details: { reason: 'outcome_unknown' },
      rows: 1,
    });
    // Certainly not on the board: no reason, and its files go.
    expect(await send(unopened, 'chiusa.png')).toEqual({
      status: 500,
      details: undefined,
      rows: 0,
    });
    expect(await send(late, 'tardi.png')).toEqual({ status: 500, details: undefined, rows: 0 });
  });

  it('answers 429 after 30 clips a minute', async () => {
    const other = await otherApp({});
    try {
      const statuses: number[] = [];
      // Refused for being empty, but counted: the limit comes before anything else.
      for (let i = 0; i < 31; i++)
        statuses.push((await clip({ boardId }, { token }, other.base)).status);
      expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
      const last = await clip({ boardId, text: 'Uno di troppo' }, { token }, other.base);
      expect(last.status).toBe(429);
      expect(statuses[30]).toBe(429);
    } finally {
      await other.app.close();
    }
  });

  describe.skipIf(!redisUrl)('when collab runs on its own (needs REDIS_URL)', () => {
    const prefix = `inkadra-test-${process.pid}`;
    const userId = () => people.owner?.id ?? '';

    it('lists the live columns through the queue', async () => {
      const board = await columnsBoard('Colonne in coda');
      const id = newElementId();
      const worker = startBoardWorker(redisUrl ?? '', directBoardWriter(collab), log, {
        prefix,
        reader: directBoardReader(collab, db),
      });
      const queued = queuedBoardWriter(redisUrl ?? '', { prefix });
      const other = await createApp({
        config,
        db,
        auth,
        log,
        ...deps,
        boardReader: queued.reader,
      });
      await other.listen({ host: '127.0.0.1', port: 0 });
      const connection = await collab.hocuspocus.openDirectConnection(boardDocName(board));
      try {
        await connection.transact((doc) => addElement(doc, column(id, 'Appena fatta', 0, 0)));
        const res = await fetch(
          `http://127.0.0.1:${(other.server.address() as AddressInfo).port}/api/v1/boards/${board}/columns`,
          { headers: { cookie: people.viewer?.cookie ?? '' } },
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ items: [{ id, title: 'Appena fatta' }] });
      } finally {
        await connection.disconnect();
        await other.close();
        await queued.close();
        await worker.close();
      }
    });

    it('authorizes before queueing columns and removes timed-out reads before falling back', async () => {
      const readPrefix = `${prefix}-read-fallback`;
      const board = await columnsBoard('Stored columns');
      const id = newElementId();
      const doc = await collab.hocuspocus.openDirectConnection(boardDocName(board));
      await doc.transact((state) => addElement(state, column(id, 'Stored', 0, 0)));
      await doc.disconnect();
      const queued = queuedBoardWriter(redisUrl ?? '', {
        prefix: readPrefix,
        timeoutMs: 300,
        graceMs: 300,
      });
      const connection = createRedis(redisUrl ?? '');
      const queue = new Queue(QUEUES.collab, { connection, prefix: readPrefix });
      const other = await createApp({ config, db, auth, log, ...deps, boardReader: queued.reader });
      await other.listen({ host: '127.0.0.1', port: 0 });
      const path = `http://127.0.0.1:${(other.server.address() as AddressInfo).port}/api/v1/boards/${board}/columns`;
      try {
        const denied = await fetch(path, { headers: { cookie: people.stranger?.cookie ?? '' } });
        expect(denied.status).toBe(404);
        expect(await queue.getJobCounts('waiting', 'active', 'completed', 'failed')).toEqual({
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
        });
        const started = Date.now();
        for (let i = 0; i < 3; i++) {
          const res = await fetch(path, { headers: { cookie: people.viewer?.cookie ?? '' } });
          expect(res.status).toBe(200);
          expect(await res.json()).toEqual({ items: [{ id, title: 'Stored' }] });
        }
        expect(Date.now() - started).toBeLessThan(4000);
        expect(await queue.getJobCounts('waiting', 'active', 'completed', 'failed')).toEqual({
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
        });
      } finally {
        await other.close();
        await queued.close();
        await queue.close();
        connection.disconnect();
      }
    });

    it('goes through the queue', async () => {
      const worker = startBoardWorker(redisUrl ?? '', directBoardWriter(collab), log, { prefix });
      const queued = queuedBoardWriter(redisUrl ?? '', { prefix });
      try {
        const placed = await queued.writer.addCard({
          boardId,
          userId: userId(),
          card: { type: 'note', fields: {}, body: [{ kind: 'paragraph', text: 'Dalla coda' }] },
        });
        expect(placed.ok).toBe(true);
        if (!placed.ok) return;
        expect((await boardElement(placed.elementId)).text).toBe('Dalla coda');
        expect(
          await queued.writer.addCard({
            boardId,
            columnId: 'not-a-column-0001',
            userId: userId(),
            card: { type: 'note', fields: {} },
          }),
        ).toEqual({ ok: false, reason: 'column' });
      } finally {
        await queued.close();
        await worker.close();
      }
    });

    it('never applies a card after telling the sender it timed out', async () => {
      // No worker: collab is down or busy.
      const queued = queuedBoardWriter(redisUrl ?? '', { prefix, timeoutMs: 300, graceMs: 300 });
      const connection = createRedis(redisUrl ?? '');
      const queue = new Queue(QUEUES.collab, { connection, prefix });
      const events = new QueueEvents(QUEUES.collab, {
        connection: createRedis(redisUrl ?? ''),
        prefix,
      });
      let worker: ReturnType<typeof startBoardWorker> | undefined;
      try {
        expect(
          await queued.writer.addCard({
            boardId,
            userId: userId(),
            card: { type: 'note', fields: {}, body: [{ kind: 'paragraph', text: 'Troppo tardi' }] },
          }),
        ).toEqual({ ok: false, reason: 'expired' });
        // A job that outlived its deadline, as if its removal had failed: refused on arrival.
        const stale = await queue.add('add-card', {
          boardId,
          userId: userId(),
          card: { type: 'note', fields: {}, body: [{ kind: 'paragraph', text: 'Scaduta' }] },
          expiresAt: Date.now() - 1,
        });
        // collab comes back.
        worker = startBoardWorker(redisUrl ?? '', directBoardWriter(collab), log, { prefix });
        expect(await stale.waitUntilFinished(events, 5000)).toEqual({
          ok: false,
          reason: 'expired',
        });
        const texts = await boardTexts();
        expect(texts).not.toContain('Troppo tardi');
        expect(texts).not.toContain('Scaduta');
      } finally {
        await worker?.close();
        await queued.close();
        await Promise.all([queue.close(), events.close()]);
        connection.disconnect();
      }
    });

    it('gives up instead of hanging when the queue does not answer', async () => {
      // Accepts connections and never says a word, like a Valkey that is stuck.
      const sockets: Socket[] = [];
      const silent = createNetServer((socket) => {
        sockets.push(socket);
      });
      await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
      const port = (silent.address() as AddressInfo).port;
      const queued = queuedBoardWriter(`redis://127.0.0.1:${port}`, { prefix, timeoutMs: 300 });
      try {
        const started = Date.now();
        await expect(
          queued.writer.addCard({ boardId, userId: userId(), card: { type: 'note', fields: {} } }),
        ).rejects.toThrow(/unreachable/);
        expect(Date.now() - started).toBeLessThan(2000);
      } finally {
        for (const socket of sockets) socket.destroy();
        silent.close();
        void queued.close().catch(() => {});
      }
    });

    it('keeps a written card and its file when the enqueue acknowledgement is lost', async () => {
      const proxy = await valkeyProxy(redisUrl ?? '');
      const queued = queuedBoardWriter(proxy.url, { prefix, timeoutMs: 1000, graceMs: 300 });
      const worker = startBoardWorker(redisUrl ?? '', directBoardWriter(collab), log, { prefix });
      const other = await otherApp({ boards: queued.writer });
      try {
        // Establish both connections before losing only server-to-client traffic.
        expect(
          (
            await queued.writer.addCard({
              boardId,
              userId: userId(),
              card: { type: 'note', fields: {} },
            })
          ).ok,
        ).toBe(true);
        proxy.holdReplies();
        const res = await clip(
          form({ boardId }, [png, 'lost-ack.png', 'image/png']),
          { token },
          other.base,
        );
        const doc = collab.hocuspocus.documents.get(boardDocName(boardId));
        const written = [...roots(doc!).elements.values()].find(
          (el) => el.get('type') === 'image' && el.get('assetId'),
        );
        expect(written).toBeDefined();
        expect(res.status).toBe(500);
        expect(res.json.error.details).toEqual({ reason: 'outcome_unknown' });
        const [saved] = await db.select().from(asset).where(eq(asset.filename, 'lost-ack.png'));
        expect(saved).toBeDefined();
        expect(
          [...roots(doc!).elements.values()].some((el) => el.get('assetId') === saved?.id),
        ).toBe(true);
        expect(await deps.storage.size(saved!.storageKey)).toBe(png.length);
      } finally {
        proxy.release();
        await other.app.close();
        await queued.close();
        await worker.close();
        proxy.cut();
      }
    });

    it('removes a card whose add reaches the queue after the deadline', async () => {
      const proxy = await valkeyProxy(redisUrl ?? '');
      // Long enough for the first add to open its connection on a slow runner.
      const queued = queuedBoardWriter(proxy.url, { prefix, timeoutMs: 1000, graceMs: 300 });
      const connection = createRedis(redisUrl ?? '');
      const queue = new Queue(QUEUES.collab, { connection, prefix });
      const events = new QueueEvents(QUEUES.collab, {
        connection: createRedis(redisUrl ?? ''),
        prefix,
      });
      const note = (text: string) => ({
        boardId,
        userId: userId(),
        card: { type: 'note' as const, fields: {}, body: [{ kind: 'paragraph' as const, text }] },
      });
      try {
        // Connected and ready; no worker, so it expires.
        expect(await queued.writer.addCard(note('Prima'))).toEqual({
          ok: false,
          reason: 'expired',
        });
        await events.waitUntilReady();
        proxy.hold();
        await expect(queued.writer.addCard(note('In ritardo'))).rejects.toThrow(/unreachable/);
        const added = new Promise<string>((resolve) =>
          events.on('added', ({ jobId }) => resolve(jobId)),
        );
        const removed = new Set<string>();
        events.on('removed', ({ jobId }) => removed.add(jobId));
        // Valkey answers again: the add lands late, and is taken back.
        proxy.release();
        const jobId = await added;
        await expect.poll(() => removed.has(jobId)).toBe(true);
        expect(await queue.getJob(jobId)).toBeUndefined();
      } finally {
        proxy.cut();
        void queued.close().catch(() => {});
        await Promise.all([queue.close(), events.close()]);
        connection.disconnect();
      }
    });

    it('answers every clip in time when Valkey goes away after the first add', async () => {
      const proxy = await valkeyProxy(redisUrl ?? '');
      const queues = createQueues(proxy.url, { prefix });
      const unsure: BoardWriter = {
        async addCard() {
          throw new CardOutcomeUnknown('no answer');
        },
      };
      const failing: BoardWriter = {
        async addCard() {
          throw new BoardEditNotStarted('The collaboration queue is unreachable.');
        },
      };
      const apps = [
        await otherApp({ jobs: queues.jobs }),
        await otherApp({ jobs: queues.jobs, boards: unsure }),
        await otherApp({ jobs: queues.jobs, boards: failing }),
      ] as const;
      const timed = async (name: string, at: string) => {
        const started = Date.now();
        const res = await clip(form({ boardId }, [png, name, 'image/png']), { token }, at);
        return { ...res, ms: Date.now() - started };
      };
      const rows = async (filename: string) =>
        (await db.select().from(asset).where(eq(asset.filename, filename))).length;
      const originals = () => readdirSync(join(deps.root, 'files', 'originals')).length;
      try {
        // The first add goes through, so the queue's connection is up when Valkey goes away.
        expect((await timed('prima.png', apps[0].base)).status).toBe(201);
        proxy.cut();

        // Written straight to the board: a success, even though its media are not queued.
        const written = await timed('dopo.png', apps[0].base);
        expect(written.status).toBe(201);
        expect(written.ms).toBeLessThan(5000);
        expect((await boardElement(written.json.elementId)).element?.type).toBe('image');
        expect(await rows('dopo.png')).toBe(1);

        // Maybe on the board: the answer that says to look before trying again, files kept.
        const unknown = await timed('forse-coda.png', apps[1].base);
        expect(unknown.status).toBe(500);
        expect(unknown.json.error.message).toMatch(/check/);
        expect(unknown.json.error.details).toEqual({ reason: 'outcome_unknown' });
        expect(unknown.ms).toBeLessThan(5000);
        expect(await rows('forse-coda.png')).toBe(1);

        // Not on the board: rows and files go, removed here since the queue cannot take them.
        const files = originals();
        const failed = await timed('persa.png', apps[2].base);
        expect(failed.status).toBe(500);
        expect(failed.json.error.details).toBeUndefined();
        expect(failed.ms).toBeLessThan(5000);
        expect(await rows('persa.png')).toBe(0);
        expect(originals()).toBe(files);
      } finally {
        for (const other of apps) await other.app.close();
        queues.connection.disconnect();
        void queues.close().catch(() => {});
      }
    });
  });
});
