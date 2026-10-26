import { fileURLToPath } from 'node:url';
import { Schedule, ShootingDay, type ShootingDayInput } from '@inkadra/shared';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('shooting schedule (needs DATABASE_URL)', () => {
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
  let boardId = '';
  let otherBoardId = '';
  let projectId = '';
  let day: ShootingDay;
  const input: ShootingDayInput = {
    date: '2026-11-02',
    callTime: '08:00',
    wrap: '18:00',
    location: 'Station',
    notes: 'Bring lights',
    blocks: [
      {
        id: crypto.randomUUID(),
        type: 'shot',
        title: 'Arrival',
        start: null,
        duration: 45,
        shotId: 'frame-0001',
        cast: ['Anna'],
        departments: ['Camera'],
      },
    ],
  };
  const request = (
    as: string | null,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: as ? { cookie: people[as]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const base = () => `/boards/${boardId}/schedule`;
  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
    for (const name of ['owner', 'editor', 'viewer', 'stranger']) {
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
    const project = await request('owner', 'POST', '/projects', { name: 'Schedule' });
    expect(project.statusCode).toBe(201);
    const child = await request('owner', 'POST', `/projects/${project.json().id}/boards`, {
      parentBoardId: project.json().rootBoardId,
      title: 'Shooting plan',
    });
    expect(child.statusCode).toBe(201);
    boardId = child.json().id;
    projectId = project.json().id;
    const other = await request('owner', 'POST', '/projects', { name: 'Other' });
    otherBoardId = other.json().rootBoardId;
    for (const role of ['editor', 'viewer']) {
      expect(
        (
          await request('owner', 'PUT', `/projects/${projectId}/members/${people[role]?.id}`, {
            role,
          })
        ).statusCode,
      ).toBe(200);
    }
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });

  it('requires authentication and board access', async () => {
    expect((await request(null, 'GET', base())).statusCode).toBe(401);
    expect((await request('stranger', 'GET', base())).statusCode).toBe(404);
    expect((await request('stranger', 'POST', base(), input)).statusCode).toBe(404);
  });
  it('creates and reads a persistent project day as editor/viewer', async () => {
    const response = await request('editor', 'POST', base(), input);
    expect(response.statusCode).toBe(201);
    day = ShootingDay.parse(response.json());
    expect(day).toMatchObject({ ...input, projectId, boardId, revision: 1 });
    const read = await request('viewer', 'GET', base());
    expect(read.statusCode).toBe(200);
    expect(Schedule.parse(read.json()).items).toEqual([day]);
  });
  it('refuses every write by viewers', async () => {
    expect((await request('viewer', 'POST', base(), input)).statusCode).toBe(403);
    expect(
      (await request('viewer', 'PUT', `${base()}/${day.id}`, { ...input, revision: 1 })).statusCode,
    ).toBe(403);
    expect(
      (await request('viewer', 'DELETE', `${base()}/${day.id}`, { revision: 1 })).statusCode,
    ).toBe(403);
  });
  it('validates dates, clocks, duration, block ids and limits', async () => {
    for (const patch of [
      { date: '2026-02-30' },
      { callTime: '24:00' },
      { blocks: [{ ...input.blocks[0], duration: 0 }] },
      { blocks: [input.blocks[0], input.blocks[0]] },
      { notes: 'x'.repeat(10001) },
    ]) {
      expect((await request('editor', 'POST', base(), { ...input, ...patch })).statusCode).toBe(
        400,
      );
    }
  });
  it('atomically refuses stale writes and preserves ordered blocks', async () => {
    const second = {
      ...input.blocks[0],
      id: crypto.randomUUID(),
      type: 'break' as const,
      shotId: null,
    };
    const changed = { ...input, blocks: [second, ...input.blocks], revision: 1 };
    const responses = await Promise.all([
      request('editor', 'PUT', `${base()}/${day.id}`, changed),
      request('owner', 'PUT', `${base()}/${day.id}`, { ...input, revision: 1 }),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    day = ShootingDay.parse(responses.find((r) => r.statusCode === 200)?.json());
    expect(day.revision).toBe(2);
    const read = Schedule.parse((await request('viewer', 'GET', base())).json());
    expect(read.items).toEqual([day]);
    expect(
      (await request('editor', 'DELETE', `${base()}/${day.id}`, { revision: 1 })).statusCode,
    ).toBe(409);
  });
  it('scopes ids to the authorised board and respects board grants', async () => {
    expect(
      (
        await request('owner', 'PUT', `/boards/${otherBoardId}/schedule/${day.id}`, {
          ...input,
          revision: day.revision,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await request('owner', 'GET', `/boards/${otherBoardId}/schedule`)).json().items,
    ).toEqual([]);
    const grant = await request('owner', 'PUT', `/boards/${boardId}/grants/${people.editor?.id}`, {
      role: 'viewer',
    });
    // Grants are exercised through the established access API.
    expect(grant.statusCode).toBe(200);
    expect((await request('editor', 'POST', base(), input)).statusCode).toBe(403);
  });
  it('deletes with the current revision', async () => {
    expect(
      (await request('owner', 'DELETE', `${base()}/${day.id}`, { revision: day.revision }))
        .statusCode,
    ).toBe(204);
    expect((await request('viewer', 'GET', base())).json().items).toEqual([]);
  });
});
