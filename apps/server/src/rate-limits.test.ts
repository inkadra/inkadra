import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from './http/errors.ts';
import { addressBucket, Failures, hourlyRetryAfter, RateLimiter } from './rate-limits.ts';

afterEach(() => vi.restoreAllMocks());

describe('per-process rate limits', () => {
  it('groups IPv6 /64s, including expanded and mapped addresses', async () => {
    expect(addressBucket('2001:db8:abcd:1::1')).toBe(
      addressBucket('2001:0db8:abcd:0001:1234:5678:90ab:cdef'),
    );
    expect(addressBucket('2001:db8:abcd:2::1')).not.toBe(addressBucket('2001:db8:abcd:1::1'));
    expect(addressBucket('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(addressBucket('::ffff:c000:201')).toBe('192.0.2.1');
    expect(addressBucket('192.0.2.1')).toBe('192.0.2.1');
    expect(addressBucket('::1')).toBe('0:0:0:0::/64');
    expect(addressBucket('fe80::1%eth0')).toBe(addressBucket('fe80::2%eth1'));
  });

  it('lets new clients in when the table is full, evicting unblocked keys first', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(2, 60_000);
    expect(await limiter.take('attacker')).toBe(true);
    expect(await limiter.take('attacker')).toBe(true);
    for (let i = 0; i < 9999; i++) expect(await limiter.take(String(i))).toBe(true);
    now.mockReturnValue(101_000);
    // A table filled by one client never locks out a new one.
    expect(await limiter.take('fresh')).toBe(true);
    // The blocked key keeps its budget: the least recently used unblocked key went instead.
    expect(await limiter.take('attacker')).toBe(false);
    expect(await limiter.take('9998')).toBe(true);
    now.mockReturnValue(161_001);
    expect(await limiter.take('attacker')).toBe(true);
  });

  it('still admits a new key when every slot is blocked', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(1, 60_000);
    for (let i = 0; i < 10_000; i++) expect(await limiter.take(String(i))).toBe(true);
    expect(await limiter.take('fresh')).toBe(true);
    expect(await limiter.take('fresh')).toBe(false);
    expect(await limiter.take('9999')).toBe(false);
  });

  it('bounds the work per request when a flood fills the table', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(1, 60_000);
    for (let i = 0; i < 10_000; i++) await limiter.take(String(i));
    const started = performance.now();
    for (let i = 0; i < 20_000; i++) await limiter.take(`flood-${i}`);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('retains wrong-password counters and pending checks under capacity pressure', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const failures = new Failures(2, 1000);
    expect(await failures.begin('pending')).toBe(true);
    expect(await failures.begin('guessing')).toBe(true);
    await failures.finish('guessing', true);
    expect(await failures.begin('guessing')).toBe(true);
    await failures.finish('guessing', true);
    for (let i = 0; i < 9998; i++) {
      expect(await failures.begin(String(i))).toBe(true);
      await failures.finish(String(i), true);
    }
    // Full table: a correct password from a new client still gets a check.
    expect(await failures.begin('overflow')).toBe(true);
    await failures.finish('overflow', false);
    expect(await failures.blocked('guessing')).toBe(true);
    expect(await failures.blocked('pending')).toBe(false);
    await failures.finish('pending', false);
    now.mockReturnValue(101_001);
    expect(await failures.blocked('guessing')).toBe(false);
  });

  it('tells how long until the oldest blocking hit leaves the window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.retryAfterSeconds('a')).toBe(0);
    await limiter.take('a');
    now.mockReturnValue(110_000);
    await limiter.take('a');
    expect(await limiter.take('a')).toBe(false);
    // The first hit frees a slot at 160 s.
    expect(limiter.retryAfterSeconds('a')).toBe(50);
    now.mockReturnValue(159_500);
    expect(limiter.retryAfterSeconds('a')).toBe(1);
    now.mockReturnValue(160_000);
    expect(limiter.retryAfterSeconds('a')).toBe(0);
    expect(await limiter.take('a')).toBe(true);

    const failures = new Failures(2, 1000);
    now.mockReturnValue(200_000);
    await failures.begin('k');
    await failures.begin('k');
    // Only in-flight checks: they may succeed at any moment, so no wait is invented.
    expect(await failures.blocked('k')).toBe(true);
    expect(failures.retryAfterSeconds('k')).toBe(0);
    await failures.finish('k', true);
    await failures.finish('k', true);
    expect(failures.retryAfterSeconds('k')).toBe(1);
  });
});

it('returns Retry-After with the remaining shared limiter window', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  const limiter = new RateLimiter(1, 60_000);
  app.get('/', async () => {
    await limiter.require('person', 'Wait.');
    return {};
  });
  try {
    expect((await app.inject('/')).statusCode).toBe(200);
    now.mockReturnValue(101_100);
    const refused = await app.inject('/');
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBe('59');
    now.mockReturnValue(160_001);
    expect((await app.inject('/')).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

it('waits for the oldest request of an hourly count window', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(10_000_000);
  expect(hourlyRetryAfter(new Date(10_000_000 - 3_000_000))).toBe(600);
  expect(hourlyRetryAfter(new Date(10_000_000 - 3_600_000))).toBe(1);
  expect(hourlyRetryAfter(null)).toBe(3600);
});

it.skipIf(!process.env.REDIS_URL)(
  'shares atomic sliding windows, isolated scopes and refundable failures through Valkey',
  async () => {
    const { configureRateLimits } = await import('./rate-limits.ts');
    const { loadConfig } = await import('./config.ts');
    const close = await configureRateLimits(
      loadConfig({
        NODE_ENV: 'test',
        REDIS_URL: process.env.REDIS_URL,
        PUBLIC_URL: `https://${crypto.randomUUID()}.example.com`,
        DATABASE_URL: 'unused',
        AUTH_SECRET: 'test-secret-test-secret-test-secret',
      }),
    );
    try {
      const first = new RateLimiter(3, 1000, 'shared');
      const second = new RateLimiter(3, 1000, 'shared');
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).take('person')),
      );
      expect(results.filter(Boolean)).toHaveLength(3);
      expect(second.retryAfterSeconds('person')).toBe(1);
      expect(await new RateLimiter(3, 1000, 'other').take('person')).toBe(true);
      await expect(second.require('person', 'Wait.')).rejects.toMatchObject({
        code: 'rate_limited',
        message: 'Wait.',
        retryAfter: 1,
      });
      const a = new Failures(1, 1000, 'password');
      const b = new Failures(1, 1000, 'password');
      expect(await a.begin('person')).toBe(true);
      expect(await b.begin('person')).toBe(false);
      await a.finish('person', false);
      expect(await b.begin('person')).toBe(true);
      await b.finish('person', true);
      expect(await a.blocked('person')).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(await second.take('person')).toBe(true);
      expect(await a.blocked('person')).toBe(false);
    } finally {
      close();
    }
  },
);

it.skipIf(!process.env.REDIS_URL)(
  'fails open for product traffic and closed for password checks on storage errors',
  async () => {
    const { default: IORedis } = await import('ioredis');
    const { configureRateLimits } = await import('./rate-limits.ts');
    const { loadConfig } = await import('./config.ts');
    const close = await configureRateLimits(
      loadConfig({
        NODE_ENV: 'test',
        REDIS_URL: process.env.REDIS_URL,
        PUBLIC_URL: 'https://example.com',
        DATABASE_URL: 'unused',
        AUTH_SECRET: 'test-secret-test-secret-test-secret',
      }),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.spyOn(IORedis.prototype, 'eval').mockRejectedValue(new Error('Unavailable'));
      expect(await new RateLimiter(1, 1000, 'outage').take('person')).toBe(true);
      expect(await new Failures(1, 1000, 'outage-password').begin('person')).toBe(false);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      close();
      vi.restoreAllMocks();
    }
  },
);
