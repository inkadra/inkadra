import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('personal project groups', () => {
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
  const request = (
    who: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { cookie: people[who]?.cookie ?? '', origin: config.PUBLIC_URL },
      ...(payload ? { payload } : {}),
    });
  const project = async (name: string) =>
    (await request('owner', 'POST', '/projects', { name })).json().id as string;
  const group = async (who: string, name: string) => {
    const res = await request(who, 'POST', '/project-groups', { name, color: 'orange' });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };
  const list = async (who: string) =>
    (await request(who, 'GET', '/projects')).json().items as {
      id: string;
      group: { id: string; position: string } | null;
    }[];

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

  it('keeps groups in order and validates them', async () => {
    const first = await group('owner', 'Caffè Aurora');
    const second = await group('owner', 'Serie Montagne');
    expect(
      (await request('owner', 'POST', '/project-groups', { name: ' ', color: 'orange' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await request('owner', 'POST', '/project-groups', { name: 'X', color: 'red' })).statusCode,
    ).toBe(400);
    const items = (await request('owner', 'GET', '/project-groups')).json().items;
    expect(items.map((g: { id: string }) => g.id)).toEqual([first, second]);
    // Moving the second before the first sticks.
    const moved = await request('owner', 'PATCH', `/project-groups/${second}`, {
      before: first,
      collapsed: true,
    });
    expect(moved.json()).toMatchObject({ collapsed: true });
    expect(
      (await request('owner', 'PATCH', `/project-groups/${second}`, { before: second })).statusCode,
    ).toBe(400);
    const again = (await request('owner', 'GET', '/project-groups')).json().items;
    expect(again.map((g: { id: string }) => g.id)).toEqual([second, first]);
  });

  it('is personal: nobody else sees, changes or uses a group', async () => {
    const mine = await group('owner', 'Mine');
    const shared = await project('Shared');
    await request('owner', 'PUT', `/projects/${shared}/members/${people.viewer?.id}`, {
      role: 'viewer',
    });
    expect((await request('viewer', 'GET', '/project-groups')).json().items).toEqual([]);
    for (const [method, path, body] of [
      ['PATCH', `/project-groups/${mine}`, { name: 'Taken' }],
      ['DELETE', `/project-groups/${mine}`, undefined],
      ['PUT', `/projects/${shared}/group`, { groupId: mine }],
    ] as const)
      expect((await request('viewer', method, path, body)).statusCode).toBe(404);
    // A project the person is not a member of cannot go in their group.
    const theirs = await group('stranger', 'Theirs');
    expect(
      (await request('stranger', 'PUT', `/projects/${shared}/group`, { groupId: theirs }))
        .statusCode,
    ).toBe(404);
    // A viewer groups the project their own way; the owner's grouping is untouched.
    const own = await group('viewer', 'Clients');
    await request('owner', 'PUT', `/projects/${shared}/group`, { groupId: mine });
    const res = await request('viewer', 'PUT', `/projects/${shared}/group`, { groupId: own });
    expect(res.statusCode).toBe(200);
    expect(res.json().group.id).toBe(own);
    expect((await list('owner')).find((p) => p.id === shared)?.group?.id).toBe(mine);
  });

  it('orders projects inside a group and dissolving keeps them', async () => {
    const g = await group('owner', 'Series');
    const a = await project('Ep. 1');
    const b = await project('Ep. 2');
    await request('owner', 'PUT', `/projects/${a}/group`, { groupId: g });
    await request('owner', 'PUT', `/projects/${b}/group`, { groupId: g });
    const [pa, pb] = (await list('owner'))
      .filter((p) => p.group?.id === g)
      .sort((x, y) => ((x.group?.position ?? '') < (y.group?.position ?? '') ? -1 : 1))
      .map((p) => p.id);
    expect([pa, pb]).toEqual([a, b]);
    // Ep. 2 placed before Ep. 1.
    await request('owner', 'PUT', `/projects/${b}/group`, { groupId: g, before: a });
    const order = (await list('owner'))
      .filter((p) => p.group?.id === g)
      .sort((x, y) => ((x.group?.position ?? '') < (y.group?.position ?? '') ? -1 : 1))
      .map((p) => p.id);
    expect(order).toEqual([b, a]);
    // Out of the group again.
    const out = await request('owner', 'PUT', `/projects/${a}/group`, { groupId: null });
    expect(out.json().group).toBeNull();
    expect((await request('owner', 'DELETE', `/project-groups/${g}`)).statusCode).toBe(204);
    const after = await list('owner');
    expect(after.find((p) => p.id === a)?.group).toBeNull();
    expect(after.find((p) => p.id === b)?.group).toBeNull();
    expect((await request('owner', 'GET', `/projects/${b}`)).statusCode).toBe(200);
  });

  it('leaving a project takes it out of the group', async () => {
    const shared = await project('Visit');
    await request('owner', 'PUT', `/projects/${shared}/members/${people.viewer?.id}`, {
      role: 'viewer',
    });
    const g = await group('viewer', 'Visits');
    await request('viewer', 'PUT', `/projects/${shared}/group`, { groupId: g });
    await request('viewer', 'DELETE', `/projects/${shared}/members/${people.viewer?.id}`);
    await request('owner', 'PUT', `/projects/${shared}/members/${people.viewer?.id}`, {
      role: 'viewer',
    });
    expect((await list('viewer')).find((p) => p.id === shared)?.group).toBeNull();
  });
});
