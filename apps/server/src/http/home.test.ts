import { fileURLToPath } from 'node:url';
import { MySchedule, RecentBoard, type ShootingDayInput, z } from '@inkadra/shared';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { boardDoc } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const RecentBoards = z.object({ items: z.array(RecentBoard), nextCursor: z.null() });

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('home overview: recent boards and shooting days (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    REGISTRATION: 'open',
  });
  const log = pino({ level: 'silent' });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 4);
  let app: Awaited<ReturnType<typeof createApp>>;
  const people: Record<string, { cookie: string; id: string }> = {};
  const ids = { project: '', root: '', plan: '', secret: '', archived: '', archivedRoot: '' };
  const day = (date: string, location: string): ShootingDayInput => ({
    date,
    callTime: '08:00',
    wrap: null,
    location,
    notes: '',
    blocks: [],
  });
  const request = (
    as: string | null,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: as ? { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const recent = async (as: string, query = '') => {
    const response = await request(as, 'GET', `/me/recent-boards${query}`);
    expect(response.statusCode).toBe(200);
    return RecentBoards.parse(response.json()).items;
  };
  const days = async (as: string, from: string, to: string) => {
    const response = await request(as, 'GET', `/me/shooting-days?from=${from}&to=${to}`);
    expect(response.statusCode).toBe(200);
    return MySchedule.parse(response.json()).items;
  };

  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
    for (const name of ['owner', 'viewer', 'granted', 'stranger']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: config.PUBLIC_URL },
        payload: { email: `${name}@example.com`, password: 'correct-horse-battery', name },
      });
      expect(response.statusCode).toBe(200);
      people[name] = {
        id: response.json().user.id,
        cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
      };
    }
    const project = (await request('owner', 'POST', '/projects', { name: 'Last run' })).json();
    ids.project = project.id;
    ids.root = project.rootBoardId;
    for (const [key, title] of [
      ['plan', 'Shooting plan'],
      ['secret', 'Casting'],
    ] as const) {
      const child = await request('owner', 'POST', `/projects/${ids.project}/boards`, {
        parentBoardId: ids.root,
        title,
      });
      expect(child.statusCode).toBe(201);
      ids[key] = child.json().id;
    }
    const archived = (await request('owner', 'POST', '/projects', { name: 'Old' })).json();
    ids.archived = archived.id;
    ids.archivedRoot = archived.rootBoardId;
    expect(
      (
        await request('owner', 'PUT', `/projects/${ids.project}/members/${people.viewer?.id}`, {
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request('owner', 'PUT', `/boards/${ids.plan}/grants/${people.granted?.id}`, {
          role: 'commenter',
        })
      ).statusCode,
    ).toBe(200);
    for (const [boardId, input] of [
      [ids.plan, day('2026-11-02', 'Station')],
      [ids.secret, day('2026-11-02', 'Studio')],
      [ids.root, day('2026-11-20', 'Harbour')],
      [ids.archivedRoot, day('2026-11-02', 'Archive')],
    ] as const) {
      expect(
        (await request('owner', 'POST', `/boards/${boardId}/schedule`, input)).statusCode,
      ).toBe(201);
    }
    expect(
      (await request('owner', 'PATCH', `/projects/${ids.archived}`, { archived: true })).statusCode,
    ).toBe(200);
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('requires a signed-in person and validates the query', async () => {
    expect((await request(null, 'GET', '/me/recent-boards')).statusCode).toBe(401);
    expect(
      (await request(null, 'GET', '/me/shooting-days?from=2026-11-01&to=2026-11-02')).statusCode,
    ).toBe(401);
    for (const query of [
      '',
      '?from=2026-11-02',
      '?from=2026-11-03&to=2026-11-02',
      '?from=2026-11-01&to=2027-01-02',
      '?from=2026-02-30&to=2026-03-01',
    ]) {
      expect((await request('owner', 'GET', `/me/shooting-days${query}`)).statusCode).toBe(400);
    }
    expect((await request('owner', 'GET', '/me/recent-boards?limit=0')).statusCode).toBe(400);
    expect((await request('owner', 'GET', '/me/recent-boards?limit=51')).statusCode).toBe(400);
  });

  it('lists boards by last edit, document edits included, without archived projects', async () => {
    await db.insert(boardDoc).values({
      boardId: ids.secret,
      state: new Uint8Array(),
      schemaVersion: 1,
      size: 0,
      updatedAt: new Date(Date.now() + 60_000),
    });
    const items = await recent('owner');
    // Casting was created last but Shooting plan after the root; the document edit wins.
    expect(items.map((b) => b.id)).toEqual([ids.secret, ids.plan, ids.root]);
    expect(items[0]).toMatchObject({ projectName: 'Last run', myRole: 'owner', title: 'Casting' });
    expect(Date.parse(items[0]?.editedAt ?? '')).toBeGreaterThan(Date.now());
    expect((await recent('owner', '?limit=1')).map((b) => b.id)).toEqual([ids.secret]);
    expect((await recent('viewer')).every((b) => b.myRole === 'viewer')).toBe(true);
  });

  it('shows people with a grant only the boards they can open', async () => {
    const items = await recent('granted');
    expect(items.map((b) => [b.id, b.myRole])).toEqual([[ids.plan, 'commenter']]);
    expect(await recent('stranger')).toEqual([]);
  });

  it('lists shooting days across boards with the board access rule', async () => {
    const all = await days('owner', '2026-11-01', '2026-11-30');
    // Same date and call time: the order falls back to the id.
    expect(
      all
        .slice(0, 2)
        .map((d) => d.location)
        .sort(),
    ).toEqual(['Station', 'Studio']);
    expect(all.slice(2).map((d) => [d.date, d.location])).toEqual([['2026-11-20', 'Harbour']]);
    expect(all.find((d) => d.location === 'Station')).toMatchObject({
      boardId: ids.plan,
      boardTitle: 'Shooting plan',
      projectName: 'Last run',
      projectId: ids.project,
      revision: 1,
    });
    expect((await days('owner', '2026-11-02', '2026-11-02')).map((d) => d.location).sort()).toEqual(
      ['Station', 'Studio'],
    );
    expect((await days('viewer', '2026-11-01', '2026-11-30')).length).toBe(3);
    expect((await days('granted', '2026-11-01', '2026-11-30')).map((d) => d.location)).toEqual([
      'Station',
    ]);
    expect(await days('stranger', '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('leaves out boards in the trash', async () => {
    expect((await request('owner', 'DELETE', `/boards/${ids.plan}`)).statusCode).toBe(204);
    expect((await recent('owner')).map((b) => b.id)).not.toContain(ids.plan);
    expect(await recent('granted')).toEqual([]);
    expect((await days('owner', '2026-11-01', '2026-11-30')).map((d) => d.location)).toEqual([
      'Studio',
      'Harbour',
    ]);
    expect(await days('granted', '2026-11-01', '2026-11-30')).toEqual([]);
  });
});
