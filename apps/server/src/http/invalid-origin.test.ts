import pino from 'pino';
import { expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/client.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

it('returns a clean 400 for invalid hosts without an onSend exception', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://boards.example.test',
    DATABASE_URL: 'postgres://unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret',
    HSTS_ENABLED: 'true',
  });
  const { db, sql } = createDatabase(config.DATABASE_URL);
  const auth = createAuth(config, db);
  const log = pino({ level: 'silent' });
  const app = await createApp({ config, db, auth, log, ...testDeps(db, log) });
  try {
    for (const headers of [
      { host: 'foo@bar' },
      { host: 'internal', 'x-forwarded-host': 'foo@bar', 'x-forwarded-proto': 'https' },
    ]) {
      const response = await app.inject({ url: '/api/auth/get-session', headers });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: 'bad_request', message: 'Invalid request origin.' },
      });
      expect(response.headers['strict-transport-security']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  } finally {
    await app.close();
    auth.closeSecurity();
    await sql.end();
  }
});
