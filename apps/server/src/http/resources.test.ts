import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
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
      if (req.url === '/article') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html><head><title>Fallback</title>
          <meta property="og:title" content="Location scouting &amp; light">
          <meta name="description" content="Golden hour on the Alps">
          <meta property="og:site_name" content="Scout">
          <meta property="og:image" content="/cover.png"></head><body>…</body></html>`);
      } else if (req.url === '/cover.png') {
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

  // Uploads ----------------------------------------------------------------------

  const tus = { 'tus-resumable': '1.0.0' };
  const metadata = (filename: string, filetype: string, project = projectId) =>
    `projectId ${b64(project)},filename ${b64(filename)},filetype ${b64(filetype)}`;

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
    expect(ready).toMatchObject({ status: 'ready', mime: 'image/gif' });
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
    expect((await call('viewer', 'GET', `${flat.variants[0].url}?animated=1`)).statusCode).toBe(
      404,
    );
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

  // Deletion ---------------------------------------------------------------------

  it('deletes a project with its files', async () => {
    const assets = await db.execute<{ key: string }>(
      sql`select storage_key as key from asset where project_id = ${projectId}`,
    );
    expect(assets.length).toBeGreaterThan(0);
    expect((await call('viewer', 'DELETE', `/api/v1/projects/${projectId}`)).statusCode).toBe(403);
    expect((await call('owner', 'DELETE', `/api/v1/projects/${projectId}`)).statusCode).toBe(204);
    await deps.jobs.idle();
    for (const { key } of assets) expect(await deps.storage.size(key)).toBeNull();
    expect((await call('owner', 'GET', `/api/v1/projects/${projectId}`)).statusCode).toBe(404);
  });
});
