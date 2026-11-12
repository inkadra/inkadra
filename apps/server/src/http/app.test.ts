import { fileURLToPath } from 'node:url';
import { CURRENT_SCHEMA_VERSION } from '@inkadra/doc-schema';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe.skipIf(!url)('http api (needs DATABASE_URL)', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 2);
  let app: Awaited<ReturnType<typeof createApp>>;
  let cookie = '';
  const records: Array<Record<string, unknown>> = [];
  const log = pino(
    {},
    {
      write: (line: string) => {
        records.push(JSON.parse(line));
      },
    },
  );

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log,
      ...testDeps(db, pino({ level: 'silent' })),
    });
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  const signUp = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email, password: 'correct-horse-battery', name: 'Giulia' },
    });

  it('reports health', async () => {
    const res = await app.inject('/api/v1/health');
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.database).toBe('ok');
    expect(res.json()).not.toHaveProperty('version');
    expect((await app.inject('/api/v1/instance')).json()).not.toHaveProperty('version');
    expect((await app.inject('/api/v1/instance/version')).statusCode).toBe(401);
  });

  it('asks for setup until the first account exists', async () => {
    expect((await app.inject('/api/v1/instance')).json()).toMatchObject({
      setupRequired: true,
      registration: 'first-user',
    });
  });

  it('makes exactly one first account administrator, even under a race', async () => {
    const attempts = await Promise.all(
      ['giulia@example.com', 'race-1@example.com', 'race-2@example.com'].map(signUp),
    );
    const ok = attempts.filter((r) => r.statusCode === 200);
    expect(ok).toHaveLength(1);
    expect(attempts.filter((r) => r.statusCode === 403)).toHaveLength(2);
    const first = ok[0]!;
    expect(first.json().user.role).toBe('admin');
    // Sign in as the winner, whichever address it used.
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.PUBLIC_URL },
      payload: { email: first.json().user.email, password: 'correct-horse-battery' },
    });
    cookie = String(signIn.headers['set-cookie']).split(';')[0] ?? '';
  });

  it('discloses the version only after authentication', async () => {
    const response = await app.inject({ url: '/api/v1/instance/version', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: expect.any(String),
      api: 'v1',
      docSchemaVersion: CURRENT_SCHEMA_VERSION,
      minWriterSchema: CURRENT_SCHEMA_VERSION,
      capabilities: [
        'boards',
        'comments',
        'resumable-uploads',
        'idempotent-creations',
        'idempotent-project-creations',
        'token-invalid-reasons',
        'client-asset-ids',
        'min-writer-schema',
        'board-restore-marker',
        'board-restore-history',
        'token-proof',
        'board-writers',
      ],
    });
    const publicBody = (await app.inject('/api/v1/instance')).json();
    for (const field of ['api', 'docSchemaVersion', 'minWriterSchema', 'minClient', 'capabilities'])
      expect(publicBody).not.toHaveProperty(field);
  });

  it('logs a bounded client identity only as structured metadata', async () => {
    for (const client of ['ios/1.2.0', 'invalid client']) {
      records.length = 0;
      const response = await app.inject({
        url: '/api/v1/instance/version',
        headers: {
          cookie,
          'inkadra-client': client,
        },
      });
      expect(response.statusCode).toBe(200);
      const request = records.find((record) => record.req)?.req;
      if (client === 'ios/1.2.0') expect(request).toMatchObject({ inkadraClient: client });
      else expect(request).not.toHaveProperty('inkadraClient');
      expect(response.json()).not.toHaveProperty('inkadraClient');
    }
  });

  it('closes registration after the first account', async () => {
    const second = await signUp('other@example.com');
    expect(second.statusCode).toBe(403);
    expect((await app.inject('/api/v1/instance')).json().registration).toBe('invite');
  });

  it('ignores an empty profile update', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie, origin: config.PUBLIC_URL },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('admin');
  });

  it('refuses text with the NUL character before it reaches the database', async () => {
    const headers = { cookie, origin: config.PUBLIC_URL };
    for (const req of [
      { method: 'PATCH' as const, url: '/api/v1/me', headers, payload: { name: 'Gi\u0000ulia' } },
      { method: 'PATCH' as const, url: '/api/v1/me', headers, payload: { ['na\u0000me']: 'x' } },
      { method: 'GET' as const, url: '/api/v1/search?q=a%00b', headers },
    ]) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('bad_request');
    }
  });

  it('rejects anonymous requests with the error contract', async () => {
    const res = await app.inject('/api/v1/me');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Sign in to continue.' },
    });
  });

  it('returns the signed-in user', async () => {
    const res = await app.inject({
      url: '/api/v1/me',
      headers: { cookie, origin: config.PUBLIC_URL },
    });
    expect(res.json()).toMatchObject({ role: 'admin' });
  });

  it('creates projects with a root board and lists them in order', async () => {
    for (const name of ['Ultima corsa', 'Spot Alpi 2027']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { cookie, origin: config.PUBLIC_URL },
        payload: { name },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name, myRole: 'owner' });
    }
    const list = await app.inject({
      url: '/api/v1/projects',
      headers: { cookie, origin: config.PUBLIC_URL },
    });
    expect(list.json().items.map((p: { name: string }) => p.name)).toEqual([
      'Ultima corsa',
      'Spot Alpi 2027',
    ]);
  });

  it('validates input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie, origin: config.PUBLIC_URL },
      payload: { name: ' ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
  });

  it('starts each kind of board with its views and turns on only the ones it allows', async () => {
    const headers = { cookie, origin: config.PUBLIC_URL };
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload: { name: 'Teaser' },
    });
    const { id, rootBoardId } = project.json();
    const root = await app.inject({ url: `/api/v1/boards/${rootBoardId}`, headers });
    expect(root.json()).toMatchObject({ kind: 'board', views: [] });
    const make = (kind: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/boards`,
        headers,
        payload: { parentBoardId: rootBoardId, title: kind, kind },
      });
    const story = (await make('storyboard')).json();
    const second = (await make('storyboard')).json();
    const mood = (await make('moodboard')).json();
    // A project holds several storyboards; a new one starts with its shot list (decision 0121).
    expect(second.id).not.toBe(story.id);
    expect(story.views).toEqual(['shotlist']);
    expect(mood).toMatchObject({ kind: 'moodboard', views: [] });
    const patch = (boardId: string, views: string[]) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/boards/${boardId}`,
        headers,
        payload: { views },
      });
    const on = await patch(story.id, ['review', 'shotlist']);
    expect(on.json().views).toEqual(['shotlist', 'review']);
    expect((await patch(mood.id, ['shotlist'])).statusCode).toBe(400);
    expect((await patch(mood.id, ['review'])).statusCode).toBe(400);
    expect((await patch(rootBoardId, ['review'])).json().views).toEqual(['review']);
    expect((await patch(rootBoardId, ['moodboard'])).json().views).toEqual(['moodboard']);
  });
});
