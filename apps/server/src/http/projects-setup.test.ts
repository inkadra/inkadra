import { fileURLToPath } from 'node:url';
import { Project } from '@inkadra/shared';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { boardDoc } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('project setup metadata and personal pins', () => {
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
  let projectId: string;
  const request = (
    who: string | null,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: who ? { cookie: people[who]?.cookie ?? '', origin: config.PUBLIC_URL } : {},
      ...(payload ? { payload } : {}),
    });
  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
    for (const name of ['owner', 'viewer', 'stranger']) {
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
  });
  afterAll(async () => {
    await app?.close();
    await client.end({ timeout: 1 });
  });
  it('creates real metadata and rejects invalid types and dates', async () => {
    for (const patch of [
      { type: 'invalid' },
      { shootingStart: '2026-02-30' },
      { shootingStart: '2026-11-03', shootingEnd: '2026-11-01' },
    ]) {
      expect(
        (await request('owner', 'POST', '/projects', { name: 'Invalid', ...patch })).statusCode,
      ).toBe(400);
    }
    const res = await request('owner', 'POST', '/projects', {
      name: 'Production',
      type: 'short_film',
      shootingStart: '2026-11-02',
      shootingEnd: '2026-11-03',
    });
    expect(res.statusCode).toBe(201);
    const p = Project.parse(res.json());
    expect(p).toMatchObject({
      type: 'short_film',
      shootingStart: '2026-11-02',
      shootingEnd: '2026-11-03',
      pinned: false,
    });
    projectId = p.id;
    expect(
      (
        await request('owner', 'PUT', `/projects/${projectId}/members/${people.viewer?.id}`, {
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(200);
  });
  it('keeps pins personal and idempotent, with membership checks', async () => {
    expect(
      (await request(null, 'PUT', `/projects/${projectId}/pin`, { pinned: true })).statusCode,
    ).toBe(401);
    expect(
      (await request('stranger', 'PUT', `/projects/${projectId}/pin`, { pinned: true })).statusCode,
    ).toBe(404);
    expect(
      (await request('viewer', 'PUT', `/projects/${projectId}/pin`, { pinned: 'yes' })).statusCode,
    ).toBe(400);
    for (let i = 0; i < 2; i++)
      expect(
        (await request('viewer', 'PUT', `/projects/${projectId}/pin`, { pinned: true })).json()
          .pinned,
      ).toBe(true);
    expect((await request('viewer', 'GET', '/projects')).json().items[0].pinned).toBe(true);
    expect((await request('owner', 'GET', `/projects/${projectId}`)).json().pinned).toBe(false);
    expect(
      (await request('viewer', 'PUT', `/projects/${projectId}/pin`, { pinned: false })).json()
        .pinned,
    ).toBe(false);
    await request('viewer', 'PUT', `/projects/${projectId}/pin`, { pinned: true });
    await request('owner', 'DELETE', `/projects/${projectId}/members/${people.viewer?.id}`);
    await request('owner', 'PUT', `/projects/${projectId}/members/${people.viewer?.id}`, {
      role: 'viewer',
    });
    expect((await request('viewer', 'GET', `/projects/${projectId}`)).json().pinned).toBe(false);
  });
  it('checks metadata permissions and validates partial date updates', async () => {
    expect(
      (await request('viewer', 'PATCH', `/projects/${projectId}`, { type: 'commercial' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await request('stranger', 'PATCH', `/projects/${projectId}`, { type: 'commercial' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await request('owner', 'PATCH', `/projects/${projectId}`, { shootingEnd: '2026-11-01' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await request('owner', 'PATCH', `/projects/${projectId}`, {
          type: null,
          shootingStart: null,
          shootingEnd: null,
        })
      ).json(),
    ).toMatchObject({ type: null, shootingStart: null, shootingEnd: null });
  });
  it('archives for the owner and restores without losing personal pins', async () => {
    await request('viewer', 'PUT', `/projects/${projectId}/pin`, { pinned: true });
    expect(
      (await request('viewer', 'PATCH', `/projects/${projectId}`, { archived: true })).statusCode,
    ).toBe(403);
    expect(
      (await request('owner', 'PATCH', `/projects/${projectId}`, { archived: true })).statusCode,
    ).toBe(200);
    expect((await request('viewer', 'GET', '/projects')).json().items).toEqual([]);
    expect(
      (await request('viewer', 'GET', '/projects?archived=true')).json().items[0],
    ).toMatchObject({ id: projectId, pinned: true });
    expect(
      (await request('owner', 'PATCH', `/projects/${projectId}`, { archived: false })).statusCode,
    ).toBe(200);
    expect((await request('viewer', 'GET', '/projects')).json().items[0].pinned).toBe(true);
  });
  it('restricts instance asset usage to administrators', async () => {
    expect((await request(null, 'GET', '/instance/storage')).statusCode).toBe(401);
    expect((await request('viewer', 'GET', '/instance/storage')).statusCode).toBe(403);
    expect((await request('owner', 'GET', '/instance/storage')).json()).toEqual({
      originalBytes: 0,
    });
  });
  it('returns document edit activity only for boards the caller can access', async () => {
    const p = (await request('owner', 'POST', '/projects', { name: 'Activity' })).json();
    await db.insert(boardDoc).values({
      boardId: p.rootBoardId,
      state: new Uint8Array([0, 0]),
      size: 2,
      schemaVersion: 1,
      updatedAt: new Date('2027-01-01T12:00:00Z'),
    });
    const list = await request('owner', 'GET', `/projects/${p.id}/boards`);
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].editedAt).toBe('2027-01-01T12:00:00.000Z');
    expect((await request('stranger', 'GET', `/projects/${p.id}/boards`)).statusCode).toBe(404);
  });
});
