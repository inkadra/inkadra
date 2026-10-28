import { describe, expect, it } from 'vitest';
import { authSecurity } from './auth-security.ts';
import { loadConfig } from './config.ts';

describe('authentication budgets', () => {
  it('reserves account attempts before concurrent password checks and releases on success', async () => {
    const store = authSecurity(
      loadConfig({
        NODE_ENV: 'test',
        PUBLIC_URL: 'https://example.com',
        DATABASE_URL: 'unused',
        AUTH_SECRET: 'test-secret-test-secret-test-secret',
      }),
    );
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () => store.take('login:person@example.com', 2, 900)),
    );
    expect(attempts.filter(Boolean)).toHaveLength(2);
    await store.storage.delete('login:person@example.com');
    expect(await store.take('login:person@example.com', 2, 900)).toBe(true);
    store.close();
  });
});
