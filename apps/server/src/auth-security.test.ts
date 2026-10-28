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

it.skipIf(!process.env.REDIS_URL)(
  'uses real Valkey counters and remaining TTL when configured',
  async () => {
    const store = authSecurity(
      loadConfig({
        NODE_ENV: 'test',
        REDIS_URL: process.env.REDIS_URL,
        PUBLIC_URL: 'https://example.com',
        DATABASE_URL: 'unused',
        AUTH_SECRET: 'test-secret-test-secret-test-secret',
      }),
    );
    const id = `regression:${crypto.randomUUID()}`;
    try {
      const { vi } = await import('vitest');
      await vi.waitFor(async () => expect((await store.check(id, 2, 10)).allowed).toBe(true));
      expect(await store.take(id, 2, 10)).toBe(true);
      expect(await store.take(id, 2, 10)).toBe(true);
      const result = await store.check(id, 2, 10);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(10);
    } finally {
      await store.storage.delete(id);
      store.close();
    }
  },
);
