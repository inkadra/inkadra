import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressBucket, Failures, RateLimiter } from './rate-limits.ts';

afterEach(() => vi.restoreAllMocks());

describe('per-process rate limits', () => {
  it('groups IPv6 /64s, including expanded and mapped addresses', () => {
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

  it('lets new clients in when the table is full, evicting unblocked keys first', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.take('attacker')).toBe(true);
    expect(limiter.take('attacker')).toBe(true);
    for (let i = 0; i < 9999; i++) expect(limiter.take(String(i))).toBe(true);
    now.mockReturnValue(101_000);
    // A table filled by one client never locks out a new one.
    expect(limiter.take('fresh')).toBe(true);
    // The blocked key keeps its budget: the least recently used unblocked key went instead.
    expect(limiter.take('attacker')).toBe(false);
    expect(limiter.take('9998')).toBe(true);
    now.mockReturnValue(161_001);
    expect(limiter.take('attacker')).toBe(true);
  });

  it('still admits a new key when every slot is blocked', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(1, 60_000);
    for (let i = 0; i < 10_000; i++) expect(limiter.take(String(i))).toBe(true);
    expect(limiter.take('fresh')).toBe(true);
    expect(limiter.take('fresh')).toBe(false);
    expect(limiter.take('9999')).toBe(false);
  });

  it('bounds the work per request when a flood fills the table', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(1, 60_000);
    for (let i = 0; i < 10_000; i++) limiter.take(String(i));
    const started = performance.now();
    for (let i = 0; i < 20_000; i++) limiter.take(`flood-${i}`);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('retains wrong-password counters and pending checks under capacity pressure', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const failures = new Failures(2, 1000);
    expect(failures.begin('pending')).toBe(true);
    expect(failures.begin('guessing')).toBe(true);
    failures.finish('guessing', true);
    expect(failures.begin('guessing')).toBe(true);
    failures.finish('guessing', true);
    for (let i = 0; i < 9998; i++) {
      expect(failures.begin(String(i))).toBe(true);
      failures.finish(String(i), true);
    }
    // Full table: a correct password from a new client still gets a check.
    expect(failures.begin('overflow')).toBe(true);
    failures.finish('overflow', false);
    expect(failures.blocked('guessing')).toBe(true);
    expect(failures.blocked('pending')).toBe(false);
    failures.finish('pending', false);
    now.mockReturnValue(101_001);
    expect(failures.blocked('guessing')).toBe(false);
  });

  it('tells how long until the oldest blocking hit leaves the window', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.retryAfterSeconds('a')).toBe(0);
    limiter.take('a');
    now.mockReturnValue(110_000);
    limiter.take('a');
    expect(limiter.take('a')).toBe(false);
    // The first hit frees a slot at 160 s.
    expect(limiter.retryAfterSeconds('a')).toBe(50);
    now.mockReturnValue(159_500);
    expect(limiter.retryAfterSeconds('a')).toBe(1);
    now.mockReturnValue(160_000);
    expect(limiter.retryAfterSeconds('a')).toBe(0);
    expect(limiter.take('a')).toBe(true);

    const failures = new Failures(2, 1000);
    now.mockReturnValue(200_000);
    failures.begin('k');
    failures.begin('k');
    // Only in-flight checks: they may succeed at any moment, so no wait is invented.
    expect(failures.blocked('k')).toBe(true);
    expect(failures.retryAfterSeconds('k')).toBe(0);
    failures.finish('k', true);
    failures.finish('k', true);
    expect(failures.retryAfterSeconds('k')).toBe(1);
  });
});
