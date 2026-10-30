import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { memoryMailer } from '../mailer.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

it.skipIf(!process.env.DATABASE_URL)(
  'claims and consumes an HTTPS invitation using only the host cookie',
  async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      AUTH_RATE_LIMITS: 'off',
      PUBLIC_URL: 'https://boards.example.test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused',
      AUTH_SECRET: 'https-test-secret-https-test-secret-042',
    });
    const { db, sql: client } = createDatabase(config.DATABASE_URL, 2);
    const log = pino({ level: 'silent' });
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    const auth = createAuth(config, db);
    const app = await createApp({
      config,
      db,
      auth,
      log,
      mailer: memoryMailer(),
      ...testDeps(db, log),
    });
    const register = (email: string, cookie?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: {
          host: new URL(config.PUBLIC_URL).host,
          'x-forwarded-proto': 'https',
          origin: config.PUBLIC_URL,
          ...(cookie ? { cookie } : {}),
        },
        payload: { name: email, email, password: 'https-only-test-password' },
      });
    try {
      const setup = await register('admin@example.test');
      expect(setup.statusCode).toBe(200);
      const cookies = setup.headers['set-cookie'];
      const cookie = (Array.isArray(cookies) ? cookies : [cookies])
        .find((value) => value?.startsWith('__Host-inkadra.session_token='))!
        .split(';')[0]!;
      const invitation = await app.inject({
        method: 'POST',
        url: '/api/v1/invitations',
        headers: {
          host: new URL(config.PUBLIC_URL).host,
          'x-forwarded-proto': 'https',
          cookie,
          origin: config.PUBLIC_URL,
        },
        payload: { kind: 'email', email: 'invited@example.test' },
      });
      expect(invitation.statusCode).toBe(201);
      const token = new URL(invitation.json().invitation.url).pathname.split('/').at(-1);
      const claim = await app.inject({
        method: 'POST',
        url: `/api/v1/invitations/by-token/${token}/claim`,
        headers: {
          host: new URL(config.PUBLIC_URL).host,
          'x-forwarded-proto': 'https',
          origin: config.PUBLIC_URL,
        },
        payload: {},
      });
      expect(claim.statusCode).toBe(204);
      const hostCookie = String(claim.headers['set-cookie']);
      expect(hostCookie).toMatch(
        /^__Host-inkadra\.invitation=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/,
      );
      expect(hostCookie).not.toMatch(/Domain=/i);
      expect(
        (await register('invited@example.test', `inkadra.invitation=${token}`)).statusCode,
      ).toBe(403);
      const signedUp = await register('invited@example.test', hostCookie.split(';')[0]);
      expect(signedUp.statusCode).toBe(200);
      expect(signedUp.json().user.role).toBe('member');
    } finally {
      await app.close();
      auth.closeSecurity();
      await client.end({ timeout: 1 });
    }
  },
);
