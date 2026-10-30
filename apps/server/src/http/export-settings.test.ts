import { fileURLToPath } from 'node:url';
import { DEFAULT_EXPORT_PREFERENCES, ExportSettings } from '@inkadra/shared';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, board, boardGrant, projectExportSettings } from '../db/schema.ts';
import type { Storage } from '../storage.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';
import { readPreferences } from './export-settings-routes.ts';

describe('readPreferences', () => {
  it('keeps valid stored values and falls back field by field', () => {
    expect(readPreferences(null)).toEqual(DEFAULT_EXPORT_PREFERENCES);
    expect(
      readPreferences({ framesPerPage: 6, paper: 'letter', audience: 'everyone', future: true }),
    ).toEqual({ ...DEFAULT_EXPORT_PREFERENCES, framesPerPage: 6, paper: 'letter' });
  });
});

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('project export settings', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
    AUTH_RATE_LIMITS: 'off',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  let projectId: string;
  let otherProjectId: string;
  let storage: Storage;
  let rootBoardId: string;
  const request = (who: string, method: 'GET' | 'PATCH' | 'PUT', path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: people[who]?.cookie ?? '', origin: config.PUBLIC_URL },
      ...(payload ? { payload } : {}),
    });
  const settingsPath = () => `/projects/${projectId}/export-settings`;
  const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  ]);
  const addAsset = async (fields: Partial<typeof asset.$inferInsert> = {}, bytes: Buffer = PNG) => {
    const storageKey = `originals/test-${Math.random().toString(36).slice(2)}`;
    await storage.write(storageKey, bytes, 'application/octet-stream');
    const [row] = await db
      .insert(asset)
      .values({
        projectId,
        kind: 'image',
        mime: 'image/png',
        filename: 'logo.png',
        size: 20_000,
        storageKey,
        status: 'ready',
        ...fields,
      })
      .returning();
    return row?.id as string;
  };
  const exists = async (id: string) =>
    (await db.select({ id: asset.id }).from(asset).where(eq(asset.id, id))).length === 1;

  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    const deps = testDeps(db, log);
    storage = deps.storage;
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...deps });
    for (const name of ['owner', 'editor', 'viewer', 'guest', 'stranger']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
      });
      expect(res.statusCode).toBe(200);
      people[name] = {
        id: res.json().user.id,
        cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
      };
    }
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
      payload: { name: 'Last Train' },
    });
    projectId = project.json().id;
    rootBoardId = project.json().rootBoardId;
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: people.owner?.cookie ?? '', origin: config.PUBLIC_URL },
      payload: { name: 'Elsewhere' },
    });
    otherProjectId = other.json().id;
    for (const [who, role] of [
      ['editor', 'editor'],
      ['viewer', 'viewer'],
    ] as const) {
      const res = await request(
        'owner',
        'PUT',
        `/projects/${projectId}/members/${people[who]?.id}`,
        {
          role,
        },
      );
      expect(res.statusCode).toBe(200);
    }
    // A board grant only: may open a board, so may read the settings to export it.
    await db.insert(boardGrant).values({
      boardId: project.json().rootBoardId,
      userId: people.guest?.id as string,
      role: 'editor',
    });
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('answers the defaults to everyone who can open a board, and 404 to others', async () => {
    for (const who of ['owner', 'viewer', 'guest']) {
      const res = await request(who, 'GET', settingsPath());
      expect(res.statusCode).toBe(200);
      const body = ExportSettings.parse(res.json());
      expect(body).toMatchObject({ ...DEFAULT_EXPORT_PREFERENCES, logo: null, updatedAt: null });
      expect(body.canEdit).toBe(who === 'owner');
    }
    expect((await request('stranger', 'GET', settingsPath())).statusCode).toBe(404);
  });

  it('lets project editors change some fields and keeps the others', async () => {
    let res = await request('editor', 'PATCH', settingsPath(), {
      framesPerPage: 6,
      paper: 'letter',
    });
    expect(res.statusCode).toBe(200);
    res = await request('owner', 'PATCH', settingsPath(), { audience: 'team' });
    expect(res.json()).toMatchObject({
      framesPerPage: 6,
      paper: 'letter',
      audience: 'team',
      canEdit: true,
    });
    expect(res.json().updatedAt).not.toBeNull();
    const read = (await request('viewer', 'GET', settingsPath())).json();
    expect(read).toMatchObject({
      framesPerPage: 6,
      paper: 'letter',
      audience: 'team',
      canEdit: false,
    });
    expect((await request('owner', 'PATCH', settingsPath(), { framesPerPage: 3 })).statusCode).toBe(
      400,
    );
    expect((await request('owner', 'PATCH', settingsPath(), { unknown: 1 })).statusCode).toBe(400);
  });

  it('refuses changes from viewers, board-only grants and strangers', async () => {
    expect(
      (await request('viewer', 'PATCH', settingsPath(), { titlePage: false })).statusCode,
    ).toBe(403);
    expect((await request('guest', 'PATCH', settingsPath(), { titlePage: false })).statusCode).toBe(
      403,
    );
    expect(
      (await request('stranger', 'PATCH', settingsPath(), { titlePage: false })).statusCode,
    ).toBe(404);
  });

  it('takes a small PNG or JPEG of the project as the logo and returns it', async () => {
    const id = await addAsset();
    const res = await request('editor', 'PATCH', settingsPath(), { logoAssetId: id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ logoAssetId: id, logo: { id, mime: 'image/png' } });
    expect((await request('guest', 'GET', settingsPath())).json().logo.id).toBe(id);
    const cleared = await request('owner', 'PATCH', settingsPath(), { logoAssetId: null });
    expect(cleared.json()).toMatchObject({ logoAssetId: null, logo: null, framesPerPage: 6 });
  });

  it('refuses logos of other projects, other types, too large or unfinished', async () => {
    const bad = [
      await addAsset({ projectId: otherProjectId }),
      await addAsset({ mime: 'image/svg+xml', filename: 'logo.svg' }),
      await addAsset({ mime: 'image/webp' }),
      await addAsset({ kind: 'file', mime: 'application/pdf' }),
      await addAsset({ size: 600 * 1024 }),
      await addAsset({ status: 'pending' }),
      // Accepted before by mistake: the worker has not read the file yet.
      await addAsset({ status: 'processing' }),
      await addAsset({ status: 'failed' }),
      // Declared PNG, but the bytes are an HTML page.
      await addAsset({}, Buffer.from('<html><script>alert(1)</script></html>')),
    ];
    for (const logoAssetId of bad) {
      expect((await request('owner', 'PATCH', settingsPath(), { logoAssetId })).statusCode).toBe(
        400,
      );
    }
    expect(
      (
        await request('owner', 'PATCH', settingsPath(), {
          logoAssetId: '11111111-1111-4111-8111-111111111111',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('merges concurrent changes of different fields', async () => {
    const [a, b] = await Promise.all([
      request('owner', 'PATCH', settingsPath(), { orientation: 'portrait' }),
      request('editor', 'PATCH', settingsPath(), { comments: true }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((await request('viewer', 'GET', settingsPath())).json()).toMatchObject({
      orientation: 'portrait',
      comments: true,
      framesPerPage: 6,
    });
  });

  it('deletes a replaced logo nothing else uses, and keeps one in use', async () => {
    const first = await addAsset();
    const second = await addAsset();
    await request('owner', 'PATCH', settingsPath(), { logoAssetId: first });
    await request('owner', 'PATCH', settingsPath(), { logoAssetId: second });
    expect(await exists(first)).toBe(false);
    // The second becomes the board's cover too: removing the logo keeps the file.
    await db.update(board).set({ coverAssetId: second }).where(eq(board.id, rootBoardId));
    await request('owner', 'PATCH', settingsPath(), { logoAssetId: null });
    expect(await exists(second)).toBe(true);
    await db.update(board).set({ coverAssetId: null }).where(eq(board.id, rootBoardId));
  });

  it('answers no logo while its file is not ready', async () => {
    const id = await addAsset();
    await request('owner', 'PATCH', settingsPath(), { logoAssetId: id });
    await db.update(asset).set({ status: 'processing' }).where(eq(asset.id, id));
    const read = (await request('viewer', 'GET', settingsPath())).json();
    expect(read).toMatchObject({ logo: null, logoAssetId: null });
    await db.update(asset).set({ status: 'ready' }).where(eq(asset.id, id));
  });

  it('drops the logo when its asset is deleted, and the row with the project', async () => {
    const id = await addAsset();
    await request('owner', 'PATCH', settingsPath(), { logoAssetId: id });
    await db.execute(sql`delete from asset where id = ${id}`);
    expect((await request('owner', 'GET', settingsPath())).json().logo).toBeNull();
    await db.execute(sql`delete from project where id = ${projectId}`);
    const rows = await db.select().from(projectExportSettings);
    expect(rows.find((r) => r.projectId === projectId)).toBeUndefined();
  });
});
