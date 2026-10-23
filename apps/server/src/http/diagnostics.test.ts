import { fileURLToPath } from 'node:url';
import type { Diagnostics } from '@inkadra/shared';
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

describe.skipIf(!url)('diagnostics (needs DATABASE_URL)', () => {
  const { db, sql: client } = createDatabase(url ?? 'postgres://unused', 2);
  const deps = testDeps(db, pino({ level: 'silent' }));
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://inkadra.example.com',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    DATA_DIR: deps.root,
    TRUST_PROXY: '127.0.0.1',
    REGISTRATION: 'open',
  });
  let app: Awaited<ReturnType<typeof createApp>>;

  // inject() connects from 127.0.0.1, which TRUST_PROXY accepts: like a proxy on the host.
  const viaProxy = { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' };
  const get = (headers: Record<string, string> = {}) =>
    app.inject({
      url: '/api/v1/diagnostics',
      headers: { host: 'inkadra.example.com', ...headers },
    });
  const check = (body: Diagnostics, id: string) => body.checks.find((c) => c.id === id);
  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    [res.headers['set-cookie'] ?? []]
      .flat()
      .map((c) => String(c).split(';')[0])
      .join('; ');

  beforeAll(async () => {
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log: pino({ level: 'silent' }),
      ...deps,
    });
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('is open before setup and reveals no configuration', async () => {
    const res = await get(viaProxy);
    expect(res.statusCode).toBe(200);
    const body = res.json<Diagnostics>();
    expect(body.request).toMatchObject({
      protocol: 'https',
      host: 'inkadra.example.com',
      clientIp: '203.0.113.7',
      proxyTrusted: true,
    });
    expect(check(body, 'public_url_matches_request')?.status).toBe('ok');
    expect(check(body, 'proxy_trusted')?.status).toBe('ok');
    expect(check(body, 'database')?.status).toBe('ok');
    expect(check(body, 'data_dir_writable')?.status).toBe('ok');
    expect(check(body, 'storage')?.status).toBe('ok');
    for (const c of body.checks) expect([c.expected, c.actual]).toEqual([null, null]);
  });

  it('flags a proxy that does not send the scheme', async () => {
    const body = (await get({ 'x-forwarded-for': '203.0.113.7' })).json<Diagnostics>();
    expect(body.request.protocol).toBe('http');
    expect(check(body, 'public_url_matches_request')?.status).toBe('error');
  });

  it('needs an administrator once the first account exists', async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL, ...viaProxy },
      payload: { email: 'admin@example.com', password: 'correct-horse-battery', name: 'Admin' },
    });
    expect(signUp.statusCode).toBe(200);
    expect((await get(viaProxy)).statusCode).toBe(401);

    const res = await get({ ...viaProxy, cookie: cookieOf(signUp) });
    expect(res.statusCode).toBe(200);
    const body = res.json<Diagnostics>();
    expect(check(body, 'public_url_matches_request')).toMatchObject({
      expected: 'https://inkadra.example.com',
      actual: 'https://inkadra.example.com',
    });
    expect(check(body, 'data_dir_writable')?.actual).toBe(deps.root);
  });

  it('refuses members who are not administrators', async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL, ...viaProxy },
      payload: { email: 'member@example.com', password: 'correct-horse-battery', name: 'Member' },
    });
    expect(signUp.statusCode).toBe(200);
    const res = await get({ ...viaProxy, cookie: cookieOf(signUp) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('limits how often it runs', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await get()).statusCode);
    expect(codes).toContain(429);
  });
});
