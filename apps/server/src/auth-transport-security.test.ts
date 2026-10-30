import { expect, it, vi } from 'vitest';
import { createAuth } from './auth.ts';
import { authSecurity } from './auth-security.ts';
import { loadConfig } from './config.ts';
import type { Database } from './db/client.ts';

vi.mock('./auth-security.ts', async (original) => {
  const actual = await original<typeof import('./auth-security.ts')>();
  return { ...actual, authSecurity: vi.fn(actual.authSecurity) };
});

it('uses one security store and closes it once after selecting both transports', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://boards.example.test',
    DATABASE_URL: 'unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret',
  });
  const auth = createAuth(config, {} as Database);
  const security = vi.mocked(authSecurity).mock.results.at(-1)!.value;
  const close = vi.spyOn(security, 'close');
  try {
    // No cookie means session lookup does not need a database connection.
    for (const origin of ['https://boards.example.test', 'http://soyo:7340'])
      expect((await auth.handler(new Request(`${origin}/api/auth/get-session`))).status).toBe(200);
    expect(authSecurity).toHaveBeenCalledTimes(1);
  } finally {
    auth.closeSecurity();
  }
  expect(close).toHaveBeenCalledOnce();
});
