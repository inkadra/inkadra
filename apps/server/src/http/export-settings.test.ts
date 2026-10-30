import { fileURLToPath } from 'node:url';
import { DEFAULT_EXPORT_PREFERENCES, ExportSettings } from '@inkadra/shared';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, boardGrant, projectExportSettings } from '../db/schema.ts';
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
  const request = (who: string, method: 'GET' | 'PATCH' | 'PUT', path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: people[who]?.cookie ?? '', origin: config.PUBLIC_URL },
      ...(payload ? { payload } : {}),
    });
  const settingsPath = () => `/projects/${projectId}/export-settings`;
  const addAsset = async (fields: Partial<typeof asset.$inferInsert> = {}) => {
    const [row] = await db
      .insert(asset)
      .values({
        projectId,
        kind: 'image',
        mime: 'image/png',
        filename: 'logo.png',
        size: 20_000,
        storageKey: `test/${Math.random()}`,
        status: 'ready',
        ...fields,
      })
      .returning();
    return row?.id as string;
  };

  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
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
