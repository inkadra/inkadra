import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
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

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project cascade`);
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log: pino({ level: 'silent' }),
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
  });

  it('asks for setup until the first account exists', async () => {
    expect((await app.inject('/api/v1/instance')).json()).toMatchObject({
      setupRequired: true,
      registration: 'first-user',
    });
  });

  it('makes the first account administrator and closes registration', async () => {
    const first = await signUp('giulia@example.com');
    expect(first.statusCode).toBe(200);
    expect(first.json().user.role).toBe('admin');
    cookie = String(first.headers['set-cookie']).split(';')[0] ?? '';

    const second = await signUp('other@example.com');
    expect(second.statusCode).toBe(403);
    expect((await app.inject('/api/v1/instance')).json().registration).toBe('invite');
  });

  it('rejects anonymous requests with the error contract', async () => {
    const res = await app.inject('/api/v1/me');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Sign in to continue.' },
    });
  });

  it('returns the signed-in user', async () => {
    const res = await app.inject({ url: '/api/v1/me', headers: { cookie } });
    expect(res.json()).toMatchObject({ email: 'giulia@example.com', role: 'admin' });
  });

  it('creates projects with a root board and lists them in order', async () => {
    for (const name of ['Ultima corsa', 'Spot Alpi 2027']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { cookie },
        payload: { name },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name, myRole: 'owner' });
    }
    const list = await app.inject({ url: '/api/v1/projects', headers: { cookie } });
    expect(list.json().items.map((p: { name: string }) => p.name)).toEqual([
      'Ultima corsa',
      'Spot Alpi 2027',
    ]);
  });

  it('validates input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie },
      payload: { name: ' ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
  });
});
