import {
  createServer,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { clientAssetUploadId } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, assetVariant, creationRequest } from '../db/schema.ts';
import { purgeUploads } from '../queues.ts';
import { originalKey, proxyKey } from '../storage.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe.skipIf(!url)('projects, boards, uploads and assets (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
    UPLOAD_MAX_SIZE: '5MB',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  const deps = testDeps(db, log);
  let app: Awaited<ReturnType<typeof createApp>>;
  let site: Server;
  let siteUrl = '';
  const as: Record<'owner' | 'viewer' | 'stranger', { cookie: string; id: string }> = {
    owner: { cookie: '', id: '' },
    viewer: { cookie: '', id: '' },
    stranger: { cookie: '', id: '' },
  };
  let projectId = '';
  let rootBoardId = '';

  /**
   * A request as the given person. Over a real socket rather than inject(), because the tus
   * server streams the request and response through the Node objects itself.
   */
  const call = async (
    who: keyof typeof as,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD',
    path: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const body =
      payload === undefined
        ? undefined
        : Buffer.isBuffer(payload)
          ? payload
          : JSON.stringify(payload);
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        cookie: as[who].cookie,
        origin: config.PUBLIC_URL,
        ...(body !== undefined && !Buffer.isBuffer(payload)
          ? { 'content-type': 'application/json' }
          : {}),
        ...headers,
      },
      body,
    });
    const rawPayload = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: res.status,
      headers: Object.fromEntries(res.headers) as Record<string, string>,
      rawPayload,
      json: () => JSON.parse(rawPayload.toString('utf8')),
    };
  };
  let base = '';

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log,
      ...deps,
      allowAddresses: ['127.0.0.1'],
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    for (const who of Object.keys(as) as Array<keyof typeof as>) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${who}@example.com`, password: 'correct-horse-battery', name: who },
      });
      as[who] = {
        cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
        id: res.json().user.id,
      };
    }
    const red = await sharp({
      create: { width: 700, height: 400, channels: 3, background: '#d03030' },
    })
      .png()
      .toBuffer();
    site = createServer((req, res) => {
      if (req.url?.startsWith('/geocode?')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            { lat: '45.46', lon: '9.19', display_name: 'Via Roma, Milano' },
            { lat: '46.16', lon: '9.87', display_name: 'Via Roma, Sondrio' },
          ]),
        );
      } else if (req.url === '/article') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html><head><title>Fallback</title>
          <meta property="og:title" content="Location scouting &amp; light">
          <meta name="description" content="Golden hour on the Alps">
          <meta property="og:site_name" content="Scout">
          <meta property="og:image" content="/cover.png"></head><body>…</body></html>`);
      } else if (req.url === '/cover.png') {
        res.setHeader('content-type', 'image/png');
        res.end(red);
      } else if (req.url?.startsWith('/tiles/')) {
        res.setHeader('content-type', 'image/png');
        res.end(red);
      } else if (req.url === '/loop') {
        res.statusCode = 302;
        res.setHeader('location', '/loop');
        res.end();
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    site?.close();
    await app?.close();
    await client.end();
  });

  // Projects ---------------------------------------------------------------------

  it('creates, pages, renames and shares a project', async () => {
    for (const name of ['Ultima corsa', 'Spot Alpi 2027', 'Lookbook']) {
      const res = await call('owner', 'POST', '/api/v1/projects', { name });
      expect(res.statusCode).toBe(201);
    }
    const first = await call('owner', 'GET', '/api/v1/projects?limit=2');
    expect(first.json().items).toHaveLength(2);
    const second = await call(
      'owner',
      'GET',
      `/api/v1/projects?limit=2&cursor=${first.json().nextCursor}`,
    );
    expect(second.json()).toMatchObject({ items: [{ name: 'Lookbook' }], nextCursor: null });

    projectId = first.json().items[0].id;
    rootBoardId = first.json().items[0].rootBoardId;
    const renamed = await call('owner', 'PATCH', `/api/v1/projects/${projectId}`, {
      name: 'Ultima corsa (director’s cut)',
    });
    expect(renamed.json().name).toBe('Ultima corsa (director’s cut)');

    expect((await call('stranger', 'GET', `/api/v1/projects/${projectId}`)).statusCode).toBe(404);
    const added = await call(
      'owner',
      'PUT',
      `/api/v1/projects/${projectId}/members/${as.viewer.id}`,
      {
        role: 'viewer',
      },
    );
    expect(added.json()).toMatchObject({ role: 'viewer', user: { name: 'viewer' } });
    const members = await call('viewer', 'GET', `/api/v1/projects/${projectId}/members`);
    expect(members.json().items.map((m: { role: string }) => m.role)).toEqual(['owner', 'viewer']);
    expect(
      (await call('viewer', 'PATCH', `/api/v1/projects/${projectId}`, { name: 'Mine' })).statusCode,
    ).toBe(403);
  });

  it('keeps at least one owner', async () => {
    const res = await call('owner', 'PUT', `/api/v1/projects/${projectId}/members/${as.owner.id}`, {
      role: 'editor',
    });
    expect(res.statusCode).toBe(409);
    expect(
      (await call('owner', 'DELETE', `/api/v1/projects/${projectId}/members/${as.owner.id}`))
        .statusCode,
    ).toBe(409);
  });

  it('keeps an owner when two owners demote each other at once', async () => {
    const members = (who: string) =>
      `/api/v1/projects/${projectId}/members/${as[who as keyof typeof as].id}`;
    await call('owner', 'PUT', members('viewer'), { role: 'owner' });
    const results = await Promise.all([
      call('owner', 'PUT', members('viewer'), { role: 'editor' }),
      call('viewer', 'PUT', members('owner'), { role: 'editor' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    const list = await call('owner', 'GET', `/api/v1/projects/${projectId}/members`);
    expect(list.json().items.filter((m: { role: string }) => m.role === 'owner')).toHaveLength(1);
    // Put both back as the later tests expect.
    const owner = list.json().items.find((m: { role: string }) => m.role === 'owner').user.id;
    const asOwner = owner === as.owner.id ? 'owner' : 'viewer';
    await call(asOwner, 'PUT', members('owner'), { role: 'owner' });
    await call('owner', 'PUT', members('viewer'), { role: 'viewer' });
  });

  // Boards -----------------------------------------------------------------------

  it('nests boards, gives breadcrumbs and refuses cycles', async () => {
    const root = await call('owner', 'GET', `/api/v1/boards/${rootBoardId}`);
    expect(root.json()).toMatchObject({ title: 'Ultima corsa (director’s cut)', breadcrumb: [] });

    const scenes = await call('owner', 'POST', `/api/v1/projects/${projectId}/boards`, {
      parentBoardId: rootBoardId,
      title: 'Scene',
    });
    expect(scenes.statusCode).toBe(201);
    const shots = await call('owner', 'POST', `/api/v1/projects/${projectId}/boards`, {
      parentBoardId: scenes.json().id,
      title: 'Scena 1',
      kind: 'storyboard',
    });
    const detail = await call('viewer', 'GET', `/api/v1/boards/${shots.json().id}`);
    expect(detail.json()).toMatchObject({
      kind: 'storyboard',
      myRole: 'viewer',
      breadcrumb: [{ id: rootBoardId }, { id: scenes.json().id, title: 'Scene' }],
    });

    const cycle = await call('owner', 'PATCH', `/api/v1/boards/${scenes.json().id}`, {
      parentBoardId: shots.json().id,
    });
    expect(cycle.statusCode).toBe(400);
    expect(
      (
        await call('owner', 'PATCH', `/api/v1/boards/${rootBoardId}`, {
          parentBoardId: scenes.json().id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('viewer', 'POST', `/api/v1/projects/${projectId}/boards`, {
          parentBoardId: rootBoardId,
          title: 'Nope',
        })
      ).statusCode,
    ).toBe(403);

    // Deleting a board trashes what is under it.
    expect((await call('owner', 'DELETE', `/api/v1/boards/${scenes.json().id}`)).statusCode).toBe(
      204,
    );
    expect((await call('owner', 'GET', `/api/v1/boards/${shots.json().id}`)).statusCode).toBe(404);
    const list = await call('owner', 'GET', `/api/v1/projects/${projectId}/boards`);
    expect(list.json().items.map((b: { id: string }) => b.id)).toEqual([rootBoardId]);
    expect((await call('owner', 'DELETE', `/api/v1/boards/${rootBoardId}`)).statusCode).toBe(400);
  });

  it('replays board and comment creations without duplicates and rejects changed payloads', async () => {
    const headers = { 'idempotency-key': 'offline-create' };
    const path = `/api/v1/projects/${projectId}/boards`;
    const input = { parentBoardId: rootBoardId, kind: 'board', title: 'Offline board' };
    const boards = await Promise.all([0, 1].map(() => call('owner', 'POST', path, input, headers)));
    expect(boards.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(boards[0]!.json()).toEqual(boards[1]!.json());
    expect(
      (await call('owner', 'POST', path, { ...input, title: 'Changed' }, headers)).statusCode,
    ).toBe(409);
    const commentsPath = `/api/v1/boards/${boards[0]!.json().id}/comments`;
    const comments = await Promise.all(
      [0, 1].map(() => call('owner', 'POST', commentsPath, { body: 'Queued' }, headers)),
    );
    expect(comments.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(comments[0]!.json()).toEqual(comments[1]!.json());

    // A replay answers with the resource as it is now, never with a remembered snapshot.
    const boardId = boards[0]!.json().id;
    await call('owner', 'PATCH', `/api/v1/boards/${boardId}`, { title: 'Renamed' });
    const renamed = await call('owner', 'POST', path, input, headers);
    expect(renamed.statusCode).toBe(201);
    expect(renamed.json()).toMatchObject({ id: boardId, title: 'Renamed' });
    const commentId = comments[0]!.json().id;
    await call('owner', 'PATCH', `/api/v1/comments/${commentId}`, { body: 'Edited' });
    const edited = await call('owner', 'POST', commentsPath, { body: 'Queued' }, headers);
    expect(edited.statusCode).toBe(201);
    expect(edited.json()).toMatchObject({ id: commentId, body: 'Edited' });
    await call('owner', 'DELETE', `/api/v1/comments/${commentId}`);
    expect(
      (await call('owner', 'POST', commentsPath, { body: 'Queued' }, headers)).statusCode,
    ).toBe(404);
    await call('owner', 'DELETE', `/api/v1/boards/${boardId}`);
    expect((await call('owner', 'POST', path, input, headers)).statusCode).toBe(404);

    await db.update(creationRequest).set({ expiresAt: new Date(Date.now() - 1000) });
    const afterExpiry = await call('owner', 'POST', path, input, headers);
    expect(afterExpiry.statusCode).toBe(201);
    expect(afterExpiry.json().id).not.toBe(boardId);

    expect((await call('owner', 'POST', path, input, { 'idempotency-key': ' ' })).statusCode).toBe(
      400,
    );
  });

  it('replays project, crew member and shooting day creations like board creations', async () => {
    const key = (name: string) => ({ 'idempotency-key': name });
    const invalid = { 'idempotency-key': ' ' };
    const rejects = async (path: string, payload: unknown) => {
      expect((await call('owner', 'POST', path, payload, invalid)).statusCode).toBe(400);
    };

    // Projects: concurrent retries make one, a replay reads the project as it is now.
    const projectInput = { name: 'Offline project' };
    const projects = await Promise.all(
      [0, 1].map(() => call('owner', 'POST', '/api/v1/projects', projectInput, key('p'))),
    );
    expect(projects.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(projects[0]!.json()).toEqual(projects[1]!.json());
    const created = projects[0]!.json();
    expect(
      (await call('owner', 'POST', '/api/v1/projects', { name: 'Changed' }, key('p'))).statusCode,
    ).toBe(409);
    await rejects('/api/v1/projects', projectInput);
    const own = await call('owner', 'GET', '/api/v1/projects?limit=100');
    expect(
      own.json().items.filter((p: { name: string }) => p.name === 'Offline project'),
    ).toHaveLength(1);
    // Another person with the same key and body makes their own project and learns nothing.
    const theirs = await call('stranger', 'POST', '/api/v1/projects', projectInput, key('p'));
    expect(theirs.statusCode).toBe(201);
    expect(theirs.json().id).not.toBe(created.id);
    await call('owner', 'PATCH', `/api/v1/projects/${created.id}`, { name: 'Renamed project' });
    const renamed = await call('owner', 'POST', '/api/v1/projects', projectInput, key('p'));
    expect(renamed.statusCode).toBe(201);
    expect(renamed.json()).toMatchObject({ id: created.id, name: 'Renamed project' });

    // Crew members and shooting days of that project.
    const crewPath = `/api/v1/projects/${created.id}/crew`;
    const crewInput = {
      name: 'Anna',
      department: 'Camera',
      role: '1st AC',
      phone: '',
      email: '',
      notes: '',
      pickup: '',
      character: null,
      userId: null,
      onSetContact: false,
      position: 0,
    };
    const crew = await Promise.all(
      [0, 1].map(() => call('owner', 'POST', crewPath, crewInput, key('c'))),
    );
    expect(crew.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(crew[0]!.json()).toEqual(crew[1]!.json());
    const memberId = crew[0]!.json().id;
    expect((await call('owner', 'GET', crewPath)).json().items).toHaveLength(1);
    expect(
      (await call('owner', 'POST', crewPath, { ...crewInput, name: 'Changed' }, key('c')))
        .statusCode,
    ).toBe(409);
    await rejects(crewPath, crewInput);

    const dayPath = `/api/v1/boards/${created.rootBoardId}/schedule`;
    const dayInput = {
      date: '2026-12-01',
      callTime: '08:00',
      wrap: null,
      location: 'Station',
      notes: '',
      blocks: [],
    };
    const days = await Promise.all(
      [0, 1].map(() => call('owner', 'POST', dayPath, dayInput, key('d'))),
    );
    expect(days.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(days[0]!.json()).toEqual(days[1]!.json());
    const dayId = days[0]!.json().id;
    expect((await call('owner', 'GET', dayPath)).json().items).toHaveLength(1);
    expect(
      (await call('owner', 'POST', dayPath, { ...dayInput, location: 'Changed' }, key('d')))
        .statusCode,
    ).toBe(409);
    await rejects(dayPath, dayInput);

    // Permissions run on every attempt: a person without access is refused, key or not.
    for (const [path, payload, name] of [
      [crewPath, crewInput, 'c'],
      [dayPath, dayInput, 'd'],
    ] as const)
      expect((await call('stranger', 'POST', path, payload, key(name))).statusCode).toBe(404);

    // A key is scoped to the endpoint and its parent: the same owner, key and body on another
    // project (crew) or board (shooting day) creates a new resource, and so does a person
    // with access to their own project and board. Neither learns anything of the first.
    const other = (
      await call('owner', 'POST', '/api/v1/projects', { name: 'Second' }, key('p2'))
    ).json();
    const ownerCrew = await call(
      'owner',
      'POST',
      `/api/v1/projects/${other.id}/crew`,
      crewInput,
      key('c'),
    );
    expect(ownerCrew.statusCode).toBe(201);
    expect(ownerCrew.json().id).not.toBe(memberId);
    const ownerDay = await call(
      'owner',
      'POST',
      `/api/v1/boards/${other.rootBoardId}/schedule`,
      dayInput,
      key('d'),
    );
    expect(ownerDay.statusCode).toBe(201);
    expect(ownerDay.json().id).not.toBe(days[0]!.json().id);
    const mine = theirs.json();
    const theirCrew = await call(
      'stranger',
      'POST',
      `/api/v1/projects/${mine.id}/crew`,
      crewInput,
      key('c'),
    );
    expect(theirCrew.statusCode).toBe(201);
    expect(theirCrew.json()).toMatchObject({ projectId: mine.id });
    expect(theirCrew.json().id).not.toBe(memberId);
    const theirDay = await call(
      'stranger',
      'POST',
      `/api/v1/boards/${mine.rootBoardId}/schedule`,
      dayInput,
      key('d'),
    );
    expect(theirDay.statusCode).toBe(201);
    expect(theirDay.json().id).not.toBe(days[0]!.json().id);
    expect((await call('owner', 'GET', crewPath)).json().items).toHaveLength(1);
    expect((await call('owner', 'GET', dayPath)).json().items).toHaveLength(1);
    await call('owner', 'DELETE', `/api/v1/projects/${other.id}`);

    // A replay reads the resource as it is now, and answers 404 once it is gone.
    await call('owner', 'PUT', `${crewPath}/${memberId}`, {
      ...crewInput,
      name: 'Anna R.',
      revision: crew[0]!.json().revision,
    });
    const crewNow = await call('owner', 'POST', crewPath, crewInput, key('c'));
    expect(crewNow.statusCode).toBe(201);
    expect(crewNow.json()).toMatchObject({ id: memberId, name: 'Anna R.' });
    await call('owner', 'PUT', `${dayPath}/${dayId}`, {
      ...dayInput,
      location: 'Studio',
      revision: days[0]!.json().revision,
    });
    const dayNow = await call('owner', 'POST', dayPath, dayInput, key('d'));
    expect(dayNow.statusCode).toBe(201);
    expect(dayNow.json()).toMatchObject({ id: dayId, location: 'Studio' });
    expect(
      (await call('owner', 'DELETE', `${crewPath}/${memberId}`, { revision: 2 })).statusCode,
    ).toBe(204);
    expect((await call('owner', 'POST', crewPath, crewInput, key('c'))).statusCode).toBe(404);
    expect((await call('owner', 'DELETE', `${dayPath}/${dayId}`, { revision: 2 })).statusCode).toBe(
      204,
    );
    expect((await call('owner', 'POST', dayPath, dayInput, key('d'))).statusCode).toBe(404);
    await call('owner', 'DELETE', `/api/v1/projects/${created.id}`);
    expect(
      (await call('owner', 'POST', '/api/v1/projects', projectInput, key('p'))).statusCode,
    ).toBe(404);

    // After expiry the same key creates again.
    await db.update(creationRequest).set({ expiresAt: new Date(Date.now() - 1000) });
    const again = await call('owner', 'POST', '/api/v1/projects', projectInput, key('p'));
    expect(again.statusCode).toBe(201);
    expect(again.json().id).not.toBe(created.id);
    await call('owner', 'DELETE', `/api/v1/projects/${again.json().id}`);
    await call('stranger', 'DELETE', `/api/v1/projects/${theirs.json().id}`);
  });

  // Uploads ----------------------------------------------------------------------

  const tus = { 'tus-resumable': '1.0.0' };
  const metadata = (filename: string, filetype: string, project = projectId) =>
    `projectId ${b64(project)},filename ${b64(filename)},filetype ${b64(filetype)}`;

  it('derives client asset ids per uploader, retries without a second asset, also after a purge', async () => {
    const clientAssetId = crypto.randomUUID();
    const id = clientAssetUploadId(as.owner.id, clientAssetId);
    const headers = {
      ...tus,
      'upload-length': '100',
      'upload-metadata': `${metadata('offline.jpg', 'image/jpeg')},clientAssetId ${b64(clientAssetId)}`,
    };
    const create = (who: keyof typeof as = 'owner', extra = {}) =>
      call(who, 'POST', '/api/v1/uploads', undefined, { ...headers, ...extra });
    // Concurrent creations of the same id: one asset, every answer points at it.
    const results = await Promise.all(Array.from({ length: 6 }, () => create()));
    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(201));
    for (const r of results) {
      expect(r.headers['inkadra-asset-id']).toBe(id);
      expect(r.headers.location).toBe(`/api/v1/uploads/${id}`);
    }
    expect(await db.select().from(asset).where(eq(asset.id, id))).toHaveLength(1);
    const head = await call('owner', 'HEAD', `/api/v1/uploads/${id}`, undefined, tus);
    expect(head.headers['upload-offset']).toBe('0');
    // A retry after some bytes keeps them: the offset tells where to resume.
    const patch = await call('owner', 'PATCH', `/api/v1/uploads/${id}`, Buffer.alloc(40), {
      ...tus,
      'upload-offset': '0',
      'content-type': 'application/offset+octet-stream',
    });
    expect(patch.statusCode).toBe(204);
    const again = await create();
    expect(again.statusCode).toBe(201);
    expect(again.headers['upload-offset']).toBe('40');

    // The pending-upload purge removes it; the same client id starts it again.
    await db
      .update(asset)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000) })
      .where(eq(asset.id, id));
    await purgeUploads(db, deps.storage, deps.jobs);
    expect(await db.select().from(asset).where(eq(asset.id, id))).toEqual([]);
    const restarted = await create();
    expect(restarted.statusCode).toBe(201);
    expect(restarted.headers['inkadra-asset-id']).toBe(id);
    expect(restarted.headers['upload-offset']).toBeUndefined();

    // Another person's same client id is another asset in their own project, never a 409.
    const theirs = (await call('stranger', 'POST', '/api/v1/projects', { name: 'Theirs' })).json();
    const stranger = await create('stranger', {
      'upload-metadata': `${metadata('offline.jpg', 'image/jpeg', theirs.id)},clientAssetId ${b64(clientAssetId)}`,
    });
    expect(stranger.statusCode).toBe(201);
    expect(stranger.headers['inkadra-asset-id']).toBe(
      clientAssetUploadId(as.stranger.id, clientAssetId),
    );
    // Without access to the project, nothing is made or told; the owner's upload stays theirs.
    expect((await create('stranger')).statusCode).toBe(404);
    expect(
      (await call('stranger', 'HEAD', `/api/v1/uploads/${id}`, undefined, tus)).statusCode,
    ).toBe(404);

    // The same id for another file, a bad id, a refusal by tus after the asset was made.
    expect((await create('owner', { 'upload-length': '101' })).statusCode).toBe(409);
    const bad = `${metadata('bad.jpg', 'image/jpeg')},clientAssetId ${b64('invalid')}`;
    expect((await create('owner', { 'upload-metadata': bad })).statusCode).toBe(400);
    const tooBig = crypto.randomUUID();
    const refused = await create('owner', {
      'upload-length': String(6 * 1024 * 1024),
      'upload-metadata': `${metadata('big.jpg', 'image/jpeg')},clientAssetId ${b64(tooBig)}`,
    });
    expect(refused.statusCode).toBe(413);
    const bigId = clientAssetUploadId(as.owner.id, tooBig);
    expect(await db.select().from(asset).where(eq(asset.id, bigId))).toEqual([]);
  });

  it('holds no transaction while the body of a client-id creation arrives', async () => {
    const clientAssetId = crypto.randomUUID();
    const id = clientAssetUploadId(as.owner.id, clientAssetId);
    const headers = {
      cookie: as.owner.cookie,
      origin: config.PUBLIC_URL,
      ...tus,
      'upload-length': '100',
      'upload-metadata': `${metadata('slow.jpg', 'image/jpeg')},clientAssetId ${b64(clientAssetId)}`,
    };
    const slow = request(`${base}/api/v1/uploads`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/offset+octet-stream' },
    });
    const answered = new Promise<IncomingMessage>((resolve, reject) => {
      slow.on('response', resolve);
      slow.on('error', reject);
    });
    slow.write(Buffer.alloc(30));
    // Mid-body, the pending asset is already committed: another connection sees it.
    await expect
      .poll(async () => (await db.select().from(asset).where(eq(asset.id, id))).length)
      .toBe(1);
    // A client that timed out and retries is answered at once, not queued behind the body.
    const retry = await call('owner', 'POST', '/api/v1/uploads', undefined, {
      ...tus,
      'upload-length': '100',
      'upload-metadata': headers['upload-metadata'],
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['inkadra-asset-id']).toBe(id);
    slow.end(Buffer.alloc(20));
    const res = await answered;
    res.resume();
    expect(res.statusCode).toBe(201);
    expect(res.headers['upload-offset']).toBe('50');
  });

  it('checks access again when a client-id creation is retried', async () => {
    const member = `/api/v1/projects/${projectId}/members/${as.viewer.id}`;
    await call('owner', 'PUT', member, { role: 'editor' });
    const headers = {
      ...tus,
      'upload-length': '10',
      'upload-metadata': `${metadata('mine.jpg', 'image/jpeg')},clientAssetId ${b64(crypto.randomUUID())}`,
    };
    try {
      expect((await call('viewer', 'POST', '/api/v1/uploads', undefined, headers)).statusCode).toBe(
        201,
      );
      await call('owner', 'PUT', member, { role: 'viewer' });
      expect((await call('viewer', 'POST', '/api/v1/uploads', undefined, headers)).statusCode).toBe(
        403,
      );
    } finally {
      await call('owner', 'PUT', member, { role: 'viewer' });
    }
  });

  /** A tus creation carrying a fresh clientAssetId, and the asset id it derives. */
  const clientCreation = (filename = 'offline.txt', filetype = 'text/plain', length = '5') => {
    const clientAssetId = crypto.randomUUID();
    const headers: Record<string, string> = {
      ...tus,
      'upload-length': length,
      'upload-metadata': `${metadata(filename, filetype)},clientAssetId ${b64(clientAssetId)}`,
    };
    const id = clientAssetUploadId(as.owner.id, clientAssetId);
    const post = (extra: Record<string, string | undefined> = {}) => {
      const sent = { ...headers, ...extra };
      for (const [k, v] of Object.entries(sent)) if (v === undefined) delete sent[k];
      return call('owner', 'POST', '/api/v1/uploads', undefined, sent as Record<string, string>);
    };
    return { id, post };
  };
  const patchBytes = (id: string, offset: number, bytes: Buffer) =>
    call('owner', 'PATCH', `/api/v1/uploads/${id}`, bytes, {
      ...tus,
      'upload-offset': String(offset),
      'content-type': 'application/offset+octet-stream',
    });

  it('recovers a client-id creation that tus refused early or that lost its stored state', async () => {
    const { id, post } = clientCreation();
    // Refused by tus before any hook: nothing is made, nothing reserved.
    expect((await post({ 'tus-resumable': undefined })).statusCode).toBe(412);
    expect(await db.select().from(asset).where(eq(asset.id, id))).toEqual([]);
    expect((await post()).statusCode).toBe(201);
    const head = await call('owner', 'HEAD', `/api/v1/uploads/${id}`, undefined, tus);
    expect(head.statusCode).toBe(200);
    expect(head.headers['upload-offset']).toBe('0');
    // A row whose stored upload is gone (a crash between the two) is made usable again.
    await deps.storage.remove([originalKey(id)]);
    expect((await post()).statusCode).toBe(201);
    expect((await patchBytes(id, 0, Buffer.from('hello'))).statusCode).toBe(204);
  });

  it('answers a finished client-id upload as it is and never makes a deleted id again', async () => {
    const { id, post } = clientCreation();
    expect((await post()).statusCode).toBe(201);
    expect((await patchBytes(id, 0, Buffer.from('hello'))).statusCode).toBe(204);
    await expect
      .poll(async () => (await db.select().from(asset).where(eq(asset.id, id)))[0]?.status)
      .not.toBe('pending');
    const [finished] = await db.select().from(asset).where(eq(asset.id, id));
    const processAsset = deps.jobs.processAsset;
    let processed = 0;
    deps.jobs.processAsset = async (assetId) => {
      processed += 1;
      return processAsset.call(deps.jobs, assetId);
    };
    try {
      const again = await post();
      expect(again.statusCode).toBe(201);
      expect(again.headers['upload-offset']).toBe('5');
      expect(again.headers['upload-expires']).toBeUndefined();
      expect((await db.select().from(asset).where(eq(asset.id, id)))[0]).toEqual(finished);
      // Deleted (trash emptied, card removed): a blind retry must not make it again.
      await db.delete(asset).where(eq(asset.id, id));
      const gone = await post();
      expect(gone.statusCode).toBe(409);
      expect(JSON.parse(gone.rawPayload.toString())).toMatchObject({
        error: { details: { reason: 'client_asset_deleted' } },
      });
      expect(await db.select().from(asset).where(eq(asset.id, id))).toEqual([]);
      expect(processed).toBe(0);
    } finally {
      deps.jobs.processAsset = processAsset;
    }
  });

  it('keeps a client-id upload made again while the pending purge runs', async () => {
    const { id, post } = clientCreation('stale.txt', 'text/plain', '100');
    expect((await post()).statusCode).toBe(201);
    await db
      .update(asset)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000) })
      .where(eq(asset.id, id));
    // The purge stops between choosing the stale upload and removing it.
    let release = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = () => {};
    const atBarrier = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const slowStorage = new Proxy(deps.storage, {
      get(target, prop) {
        if (prop === 'size')
          return async (key: string) => {
            reached();
            await paused;
            return target.size(key);
          };
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const purge = purgeUploads(db, slowStorage, deps.jobs);
    await atBarrier;
    const retry = post();
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await purge;
    expect((await retry).statusCode).toBe(201);
    // Whatever the order, the upload the client was just told about is there and usable.
    const head = await call('owner', 'HEAD', `/api/v1/uploads/${id}`, undefined, tus);
    expect(head.statusCode).toBe(200);
    expect(head.headers['upload-offset']).toBe('0');
  });

  it('validates a client-id retry like a creation and answers with the same tus headers', async () => {
    const { id, post } = clientCreation('same.txt', 'text/plain', '100');
    const first = await post();
    expect(first.statusCode).toBe(201);
    expect(first.headers['upload-expires']).toBeDefined();
    expect((await post({ 'tus-resumable': undefined })).statusCode).toBe(412);
    expect((await post({ 'upload-defer-length': '1' })).statusCode).toBe(400);
    const retry = await post();
    expect(retry.statusCode).toBe(201);
    for (const header of ['location', 'tus-resumable', 'upload-expires', 'inkadra-asset-id'])
      expect(retry.headers[header]).toBe(first.headers[header]);
    expect(retry.headers['inkadra-asset-id']).toBe(id);
  });

  it('uploads in chunks, resumes, then processes the image', async () => {
    const jpeg = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#203040' },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const created = await call('owner', 'POST', '/api/v1/uploads', undefined, {
      ...tus,
      'upload-length': String(jpeg.length),
      'upload-metadata': metadata('frame.jpg', 'image/jpeg'),
    });
    expect(created.statusCode).toBe(201);
    const assetId = String(created.headers['inkadra-asset-id']);
    expect(created.headers.location).toBe(`/api/v1/uploads/${assetId}`);

    const half = Math.floor(jpeg.length / 2);
    const patch = (from: number, to: number) =>
      call('owner', 'PATCH', `/api/v1/uploads/${assetId}`, jpeg.subarray(from, to), {
        ...tus,
        'upload-offset': String(from),
        'content-type': 'application/offset+octet-stream',
      });
    expect((await patch(0, half)).statusCode).toBe(204);
    const pending = await call('owner', 'GET', `/api/v1/assets/${assetId}`);
    expect(pending.json()).toMatchObject({ status: 'pending', variants: [] });

    // An interrupted client asks where to resume.
    const head = await call('owner', 'HEAD', `/api/v1/uploads/${assetId}`, undefined, tus);
    expect(head.headers['upload-offset']).toBe(String(half));
    expect(
      (await call('viewer', 'HEAD', `/api/v1/uploads/${assetId}`, undefined, tus)).statusCode,
    ).toBe(403);

    const done = await patch(half, jpeg.length);
    expect(done.statusCode).toBe(204);
    expect(done.headers['inkadra-asset-id']).toBe(assetId);
    await deps.jobs.idle();

    const ready = (await call('viewer', 'GET', `/api/v1/assets/${assetId}`)).json();
    expect(ready).toMatchObject({
      status: 'ready',
      kind: 'image',
      mime: 'image/jpeg',
      width: 1600,
      height: 900,
      size: jpeg.length,
      url: `/api/v1/assets/${assetId}/file`,
    });
    expect(ready.variants.map((v: { size: string; url: string }) => [v.size, v.url])).toEqual(
      ['256', '512', '1024'].map((s) => [s, `/api/v1/assets/${assetId}/variants/${s}`]),
    );

    const thumb = await call('viewer', 'GET', ready.variants[0].url);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['cache-control']).toContain('immutable');
    expect((await sharp(thumb.rawPayload).metadata()).width).toBe(256);

    // Viewers look at images through thumbnails and never download originals.
    expect((await call('viewer', 'GET', ready.url)).statusCode).toBe(403);
    expect((await call('viewer', 'GET', `${ready.url}?download=1`)).statusCode).toBe(403);
    // What the export asks before it downloads one file.
    expect((await call('viewer', 'HEAD', `${ready.url}?download=1`)).statusCode).toBe(403);
    expect((await call('owner', 'HEAD', `${ready.url}?download=1`)).statusCode).toBe(200);
    const file = await call('owner', 'GET', ready.url);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.rawPayload.equals(jpeg)).toBe(true);
    const part = await call('owner', 'GET', ready.url, undefined, { range: 'bytes=10-19' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 10-19/${jpeg.length}`);
    expect(part.rawPayload.equals(jpeg.subarray(10, 20))).toBe(true);
    expect(
      (await call('owner', 'GET', ready.url, undefined, { range: 'bytes=99999999-' })).statusCode,
    ).toBe(416);
    expect((await call('stranger', 'GET', ready.url)).statusCode).toBe(404);
  });

  it('serves the moving variant of a GIF, and only when there is one', async () => {
    const frames = await Promise.all(
      [0, 1, 2].map((i) =>
        sharp({
          create: {
            width: 120,
            height: 80,
            channels: 4,
            background: { r: i * 70, g: 40, b: 160, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
      ),
    );
    const gif = await sharp(frames, { join: { animated: true } })
      .gif({ loop: 0 })
      .toBuffer();
    const upload = async (body: Buffer, filename: string, filetype: string) => {
      const created = await call('owner', 'POST', '/api/v1/uploads', body, {
        ...tus,
        'upload-length': String(body.length),
        'upload-metadata': metadata(filename, filetype),
        'content-type': 'application/offset+octet-stream',
      });
      expect(created.statusCode).toBe(201);
      await deps.jobs.idle();
      const assetId = String(created.headers['inkadra-asset-id']);
      return (await call('viewer', 'GET', `/api/v1/assets/${assetId}`)).json();
    };

    const ready = await upload(gif, 'loop.gif', 'image/gif');
    expect(ready).toMatchObject({ status: 'ready', mime: 'image/gif', animated: true });
    const poster = ready.variants[0].url as string;
    const moving = await call('viewer', 'GET', `${poster}?animated=1`);
    expect(moving.statusCode).toBe(200);
    expect(moving.headers['content-type']).toBe('image/webp');
    expect((await sharp(moving.rawPayload).metadata()).pages).toBe(3);
    // Its own immutable file, never the poster.
    expect(moving.headers.etag).toContain('animated');
    expect(
      (
        await call('viewer', 'GET', `${poster}?animated=1`, undefined, {
          'if-none-match': moving.headers.etag ?? '',
        })
      ).statusCode,
    ).toBe(304);
    const still = await sharp((await call('viewer', 'GET', poster)).rawPayload).metadata();
    expect(still.pages).toBeUndefined();
    expect((await call('stranger', 'GET', `${poster}?animated=1`)).statusCode).toBe(404);

    const png = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#445566' },
    })
      .png()
      .toBuffer();
    const flat = await upload(png, 'flat.png', 'image/png');
    expect(flat).toMatchObject({ status: 'ready', mime: 'image/png', animated: false });
    expect((await call('viewer', 'GET', `${flat.variants[0].url}?animated=1`)).statusCode).toBe(
      404,
    );
  });

  it('serves the playable copy of a video to viewers, never as a thumbnail', async () => {
    const id = crypto.randomUUID();
    const original = Buffer.from('not really ProRes');
    const mp4 = Buffer.from('0123456789 pretend this is an MP4');
    await deps.storage.write(originalKey(id), original, 'video/quicktime');
    await db.insert(asset).values({
      id,
      projectId,
      kind: 'video',
      mime: 'video/quicktime',
      filename: 'A001.mov',
      size: original.length,
      storageKey: originalKey(id),
      status: 'ready',
      videoCodec: 'prores',
      audioCodec: 'pcm_s16le',
      frameRate: 23.976,
      proxyStatus: 'processing',
      proxyProgress: 40,
    });
    let body = (await call('viewer', 'GET', `/api/v1/assets/${id}`)).json();
    expect(body).toMatchObject({
      videoCodec: 'prores',
      frameRate: 23.976,
      proxy: { status: 'processing', progress: 40, url: null, mime: 'video/mp4' },
    });
    expect((await call('viewer', 'GET', `/api/v1/assets/${id}/proxy`)).statusCode).toBe(404);

    await deps.storage.write(proxyKey(id), mp4, 'video/mp4');
    await db.insert(assetVariant).values({
      assetId: id,
      size: 'proxy',
      width: 1920,
      height: 1080,
      storageKey: proxyKey(id),
      mime: 'video/mp4',
      bytes: mp4.length,
    });
    await db
      .update(asset)
      .set({ proxyStatus: 'ready', proxyProgress: 100 })
      .where(eq(asset.id, id));
    body = (await call('viewer', 'GET', `/api/v1/assets/${id}`)).json();
    expect(body.variants).toEqual([]);
    expect(body.proxy).toEqual({
      status: 'ready',
      progress: 100,
      url: `/api/v1/assets/${id}/proxy`,
      mime: 'video/mp4',
      width: 1920,
      height: 1080,
      size: mp4.length,
    });
    const whole = await call('viewer', 'GET', body.proxy.url);
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toBe('video/mp4');
    expect(whole.headers['content-disposition']).toContain('inline; filename="A001.mp4"');
    expect(whole.rawPayload).toEqual(mp4);
    const part = await call('viewer', 'GET', body.proxy.url, undefined, { range: 'bytes=0-9' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-9/${mp4.length}`);
    expect(part.rawPayload.toString()).toBe('0123456789');
    // The original is still the original.
    expect((await call('owner', 'GET', `/api/v1/assets/${id}/file`)).rawPayload).toEqual(original);
    expect((await call('stranger', 'GET', body.proxy.url)).statusCode).toBe(404);
  });

  it('serves anything that could run in a browser as a sandboxed download', async () => {
    const html = Buffer.from('<script>alert(document.cookie)</script>');
    const created = await call('owner', 'POST', '/api/v1/uploads', html, {
      ...tus,
      'upload-length': String(html.length),
      'upload-metadata': metadata('evil.html', 'text/html'),
      'content-type': 'application/offset+octet-stream',
    });
    expect(created.statusCode).toBe(201);
    await deps.jobs.idle();
    const file = await call(
      'owner',
      'GET',
      `/api/v1/assets/${created.headers['inkadra-asset-id']}/file`,
    );
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="evil.html"/);
    expect(file.headers['content-security-policy']).toContain('sandbox');
  });

  it('refuses uploads from viewers, without metadata or over the limit', async () => {
    const headers = { ...tus, 'upload-length': '10' };
    expect(
      (
        await call('viewer', 'POST', '/api/v1/uploads', undefined, {
          ...headers,
          'upload-metadata': metadata('a.jpg', 'image/jpeg'),
        })
      ).statusCode,
    ).toBe(403);
    expect((await call('owner', 'POST', '/api/v1/uploads', undefined, headers)).statusCode).toBe(
      400,
    );
    expect(
      (
        await call('owner', 'POST', '/api/v1/uploads', undefined, {
          ...tus,
          'upload-length': String(6 * 1024 * 1024),
          'upload-metadata': metadata('big.mov', 'video/quicktime'),
        })
      ).statusCode,
    ).toBe(413);
    expect((await fetch(`${base}/api/v1/uploads`, { method: 'POST', headers })).status).toBe(401);
  });

  it('cancels an upload and its pending asset', async () => {
    // A project of its own makes this regression runnable without the preceding tests.
    const project = await call('owner', 'POST', '/api/v1/projects', { name: 'Cancellation' });
    expect(project.statusCode).toBe(201);
    const created = await call('owner', 'POST', '/api/v1/uploads', undefined, {
      ...tus,
      'upload-length': '100',
      'upload-metadata': metadata('clip.mp4', 'video/mp4', project.json().id),
    });
    expect(created.statusCode).toBe(201);
    const id = String(created.headers['inkadra-asset-id']);
    expect((await call('owner', 'GET', `/api/v1/assets/${id}`)).json().status).toBe('pending');
    let cancellation: ReturnType<typeof call> | undefined;
    let response: ServerResponse | undefined;
    try {
      await db.transaction(async (tx) => {
        // Hold the row so cleanup cannot finish. Waiting for a real blocked query below
        // proves the DELETE reached the database, without relying on a sleep or fast SQL.
        await tx.execute(sql`select id from asset where id = ${id} for update`);
        const [connection] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        const observe = (_req: unknown, res: ServerResponse) => {
          response = res;
        };
        app.server.once('request', observe);
        try {
          cancellation = call('owner', 'DELETE', `/api/v1/uploads/${id}`, undefined, tus);
          await expect
            .poll(async () => {
              const [blocked] = await db.execute<{ count: number }>(sql`
              select count(*)::int as count from pg_stat_activity
              where ${connection!.pid} = any(pg_blocking_pids(pid))
            `);
              return blocked!.count;
            })
            .toBe(1);
          // Before #24, tus had already ended the 204 response at this point, even though
          // the asset still existed. Observe the real socket response, not app.inject().
          expect(response).toBeDefined();
          expect(response!.writableEnded).toBe(false);
        } finally {
          app.server.removeListener('request', observe);
        }
      });
    } finally {
      // Always release the transaction lock and finish the request, including on failure.
      await cancellation;
    }
    expect((await cancellation)!.statusCode).toBe(204);
    expect((await call('owner', 'GET', `/api/v1/assets/${id}`)).statusCode).toBe(404);
  });

  // Link previews ----------------------------------------------------------------

  it('reads a page preview and copies its image into the project', async () => {
    const res = await call('owner', 'POST', '/api/v1/link-previews', {
      projectId,
      url: `${siteUrl}/article`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      url: `${siteUrl}/article`,
      title: 'Location scouting & light',
      description: 'Golden hour on the Alps',
      siteName: 'Scout',
    });
    await deps.jobs.idle();
    const image = await call('owner', 'GET', `/api/v1/assets/${res.json().imageAssetId}`);
    expect(image.json()).toMatchObject({
      status: 'ready',
      width: 700,
      sourceUrl: `${siteUrl}/article`,
    });
  });

  it('refuses previews of private addresses, endless redirects and for viewers', async () => {
    // The real routes refuse loopback; this app only allows it for the local test site.
    expect(
      (
        await call('viewer', 'POST', '/api/v1/link-previews', {
          projectId,
          url: `${siteUrl}/article`,
        })
      ).statusCode,
    ).toBe(403);
    const loop = await call('owner', 'POST', '/api/v1/link-previews', {
      projectId,
      url: `${siteUrl}/loop`,
    });
    expect(loop.statusCode).toBe(400);
    expect(loop.json().error.message).toMatch(/redirects/);
    const ftp = await call('owner', 'POST', '/api/v1/link-previews', {
      projectId,
      url: 'ftp://example.com/x',
    });
    expect(ftp.statusCode).toBe(400);
  });

  // Map previews -------------------------------------------------------------------

  it('searches addresses with editor access without creating image assets', async () => {
    const project = (
      await call('owner', 'POST', '/api/v1/projects', { name: 'Map search' })
    ).json();
    await call('owner', 'PUT', `/api/v1/projects/${project.id}/members/${as.viewer.id}`, {
      role: 'viewer',
    });
    const previous = config.MAP_GEOCODER_URL;
    try {
      config.MAP_GEOCODER_URL = undefined;
      const input = { projectId: project.id, query: 'Via Roma' };
      expect((await call('owner', 'POST', '/api/v1/map-search', input)).statusCode).toBe(400);
      config.MAP_GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';
      expect((await call('owner', 'POST', '/api/v1/map-search', input)).statusCode).toBe(400);
      config.MAP_GEOCODER_URL = `${siteUrl}/geocode`;
      const result = await call('owner', 'POST', '/api/v1/map-search', input);
      expect(result.statusCode).toBe(200);
      expect(result.json().items.map((p: { name: string }) => p.name)).toEqual([
        'Via Roma, Milano',
        'Via Roma, Sondrio',
      ]);
      expect(await db.select().from(asset).where(eq(asset.projectId, project.id))).toHaveLength(0);
      expect((await call('viewer', 'POST', '/api/v1/map-search', input)).statusCode).toBe(403);
      expect((await call('stranger', 'POST', '/api/v1/map-search', input)).statusCode).toBe(404);
      expect(
        (await call('owner', 'POST', '/api/v1/map-search', { ...input, query: 'a' })).statusCode,
      ).toBe(400);
    } finally {
      config.MAP_GEOCODER_URL = previous;
    }
  });

  it('places a map link and composites its map from the tile server', async () => {
    config.MAP_TILE_URL = `${siteUrl}/tiles/{z}/{x}/{y}.png`;
    const res = await call('owner', 'POST', '/api/v1/map-previews', {
      projectId,
      url: 'https://www.openstreetmap.org/?mlat=46.33&mlon=9.55#map=15/46.33/9.55',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ lat: 46.33, lon: 9.55, zoom: 15, name: null });
    await deps.jobs.idle();
    const image = await call('owner', 'GET', `/api/v1/assets/${res.json().imageAssetId}`);
    expect(image.json()).toMatchObject({
      status: 'ready',
      filename: 'map.png',
      width: 1024,
      height: 560,
    });
    // Without a geocoder an address has no place, and nothing is fetched for it.
    const address = await call('owner', 'POST', '/api/v1/map-previews', {
      projectId,
      query: 'Loreto, Sondrio',
    });
    expect(address.json()).toEqual({
      lat: null,
      lon: null,
      zoom: null,
      name: null,
      url: null,
      imageAssetId: null,
    });
    expect(
      (await call('viewer', 'POST', '/api/v1/map-previews', { projectId, query: 'Loreto' }))
        .statusCode,
    ).toBe(403);
  });

  it('serves map tiles to people signed in, through the tile server of the instance', async () => {
    config.MAP_TILE_URL = `${siteUrl}/tiles/{z}/{x}/{y}.png`;
    const tile = await call('viewer', 'GET', '/api/v1/map-tiles/15/17246/11500');
    expect(tile.statusCode).toBe(200);
    expect(tile.headers['content-type']).toBe('image/png');
    expect(tile.headers['cache-control']).toBe('private, max-age=86400');
    for (const bad of ['0/0/0', '20/0/0', '3/8/0', '3/0/-1', '3/1.5/0', '3/0x1/0'])
      expect((await call('viewer', 'GET', `/api/v1/map-tiles/${bad}`)).statusCode, bad).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/map-tiles/1/0/0' })).statusCode).toBe(
      401,
    );
    // A tile server that answers something other than a picture serves nothing.
    config.MAP_TILE_URL = `${siteUrl}/{z}/{x}/{y}`;
    expect((await call('viewer', 'GET', '/api/v1/map-tiles/2/1/1')).statusCode).toBe(404);
    config.MAPS = false;
    expect((await call('viewer', 'GET', '/api/v1/map-tiles/15/17246/11500')).statusCode).toBe(404);
    config.MAPS = true;
  });

  // Deletion ---------------------------------------------------------------------

  it('deletes a project with its files', async () => {
    const assets = await db.execute<{ key: string }>(
      sql`select storage_key as key from asset where project_id = ${projectId}`,
    );
    expect(assets.length).toBeGreaterThan(0);
    // Owners only: an editor is refused too.
    const viewer = `/api/v1/projects/${projectId}/members/${as.viewer.id}`;
    await call('owner', 'PUT', viewer, { role: 'editor' });
    expect((await call('viewer', 'DELETE', `/api/v1/projects/${projectId}`)).statusCode).toBe(403);
    await call('owner', 'PUT', viewer, { role: 'viewer' });
    expect((await call('viewer', 'DELETE', `/api/v1/projects/${projectId}`)).statusCode).toBe(403);
    expect((await call('owner', 'DELETE', `/api/v1/projects/${projectId}`)).statusCode).toBe(204);
    await deps.jobs.idle();
    for (const { key } of assets) expect(await deps.storage.size(key)).toBeNull();
    expect((await call('owner', 'GET', `/api/v1/projects/${projectId}`)).statusCode).toBe(404);
  });
});
