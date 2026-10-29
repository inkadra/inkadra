import { describe, expect, it } from 'vitest';
import { authSecurity, authSource } from './auth-security.ts';
import { loadConfig } from './config.ts';

describe('authentication budgets', () => {
  it('atomically limits concurrent increments and releases on success', async () => {
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

it.each([
  ['192.0.2.121', '192.0.2.0/24'],
  ['::ffff:192.0.2.121', '192.0.2.0/24'],
  ['2001:db8:abcd:1234:ffff::1', '2001:db8:abcd:1234::/64'],
  ['2001:0db8:abcd:1234::2', '2001:db8:abcd:1234::/64'],
  ['::1', '0:0:0:0::/64'],
  ['unknown', 'unknown'],
])('groups authentication source %s as %s', (address, expected) => {
  expect(authSource(address)).toBe(expected);
});

it.skipIf(!process.env.REDIS_URL)(
  'shares budgets across processes only within an instance',
  async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      REDIS_URL: process.env.REDIS_URL,
      PUBLIC_URL: 'https://example.com',
      DATABASE_URL: 'unused',
      AUTH_SECRET: 'test-secret-test-secret-test-secret',
    });
    const first = authSecurity(config);
    const second = authSecurity(config);
    const independent = authSecurity({ ...config, PUBLIC_URL: 'https://other.example.com' });
    const id = `isolation:${crypto.randomUUID()}`;
    try {
      const { vi } = await import('vitest');
      for (const store of [first, second, independent])
        await vi.waitFor(async () => expect((await store.check(id, 1, 60)).allowed).toBe(true));
      expect(await first.take(id, 1, 60)).toBe(true);
      expect((await second.check(id, 1, 60)).allowed).toBe(false);
      expect((await independent.check(id, 1, 60)).allowed).toBe(true);
    } finally {
      await first.storage.delete(id);
      first.close();
      second.close();
      independent.close();
    }
  },
);

it('bounds concurrent reservations and refunds without erasing other failures', async () => {
  const store = authSecurity(
    loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL: 'https://example.com',
      DATABASE_URL: 'unused',
      AUTH_SECRET: 'test-secret-test-secret-test-secret',
    }),
  );
  const id = `account:${crypto.randomUUID()}`;
  const results = await Promise.all(
    Array.from({ length: 100 }, async () => {
      const result = await store.consume(id, 50, 3600);
      if (!result.allowed) await store.refund(id);
      return result.allowed;
    }),
  );
  expect(results.filter(Boolean)).toHaveLength(50);
  expect((await store.check(id, 50, 3600)).allowed).toBe(false);
  await store.refund(id);
  expect((await store.consume(id, 50, 3600)).allowed).toBe(true);
  store.close();
});
