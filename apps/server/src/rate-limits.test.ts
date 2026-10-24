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

  it('keeps a live budget after 10,000 keys and recovers expired capacity', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const limiter = new RateLimiter(1, 2000);
    for (let i = 0; i < 9999; i++) expect(limiter.take(String(i))).toBe(true);
    now.mockReturnValue(101_500);
    expect(limiter.take('live')).toBe(true);
    expect(limiter.take('overflow')).toBe(false);
    expect(limiter.take('0')).toBe(false);
    now.mockReturnValue(102_501);
    expect(limiter.take('overflow')).toBe(true);
    expect(limiter.take('0')).toBe(true);
    expect(limiter.take('live')).toBe(false);
  });

  it('retains wrong-password counters and pending checks under capacity pressure', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const failures = new Failures(1, 1000);
    expect(failures.begin('pending')).toBe(true);
    for (let i = 0; i < 9999; i++) {
      expect(failures.begin(String(i))).toBe(true);
      failures.finish(String(i), true);
    }
    expect(failures.begin('overflow')).toBe(false);
    expect(failures.blocked('0')).toBe(true);
    now.mockReturnValue(101_001);
    expect(failures.begin('overflow')).toBe(true);
    expect(failures.blocked('pending')).toBe(true);
    failures.finish('pending', false);
    expect(failures.begin('pending')).toBe(true);
    failures.finish('pending', true);
    expect(failures.blocked('pending')).toBe(true);
  });
});
