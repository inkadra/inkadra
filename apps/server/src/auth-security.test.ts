import { describe, expect, it } from 'vitest';
import { authSecurity } from './auth-security.ts';
import { loadConfig } from './config.ts';

describe('authentication budgets', () => {
  it('reserves account attempts before concurrent password checks and releases on success', async () => {
    const store = authSecurity(loadConfig({ NODE_ENV: 'test', PUBLIC_URL: 'https://example.com', DATABASE_URL: 'unused', AUTH_SECRET: 'test-secret-test-secret-test-secret' }));
    expect(await store.take('login:person@example.com', 2, 900)).toBe(true);
    expect(await store.take('login:person@example.com', 2, 900)).toBe(true);
    expect(await store.take('login:person@example.com', 2, 900)).toBe(false);
    await store.storage.delete('login:person@example.com');
    expect(await store.take('login:person@example.com', 2, 900)).toBe(true);
    store.close();
  });
});
