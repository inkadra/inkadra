import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { acquireLease, LeaseTakenError, leaseKey } from './lease.ts';

const log = { warn: vi.fn(), error: vi.fn() };

describe.skipIf(!process.env.REDIS_URL)('single-process lease (#790, #819)', () => {
  const redis = new IORedis(process.env.REDIS_URL!);
  // A role name of its own, so parallel runs on one Valkey never meet.
  const role = `web-${randomUUID()}` as 'web';
  afterAll(async () => {
    await redis.del(leaseKey(role));
    redis.disconnect();
  });

  it('refuses a second holder, lets the same host restart, frees on release and expiry', async () => {
    const onLost = vi.fn();
    const first = await acquireLease(redis, role, log, { host: 'a', onLost });
    await expect(acquireLease(redis, role, log, { host: 'b', onLost, waitMs: 0 })).rejects.toThrow(
      LeaseTakenError,
    );
    await expect(acquireLease(redis, role, log, { host: 'b', onLost, waitMs: 0 })).rejects.toThrow(
      /one web-.* process per instance/,
    );
    // A restart of the same container after a crash: taken back at once.
    const again = await acquireLease(redis, role, log, { host: 'a', onLost });
    await first.release(); // not the holder any more: leaves the lease alone
    await expect(acquireLease(redis, role, log, { host: 'b', onLost, waitMs: 0 })).rejects.toThrow();
    await again.release();
    const other = await acquireLease(redis, role, log, { host: 'b', onLost, ttlMs: 200 });
    // A crashed holder (never renewed, never released): free once its time is over.
    await other.release();
    // A holder killed before releasing: the next process waits for the lease to end.
    await redis.set(leaseKey(role), 'gone/1/x', 'PX', 1500);
    await (await acquireLease(redis, role, log, { host: 'c', onLost, waitMs: 5000 })).release();
  });

  it('renews while held and stops the holder when another took over', async () => {
    const onLost = vi.fn();
    const lease = await acquireLease(redis, role, log, {
      host: 'r',
      onLost,
      ttlMs: 300,
      renewMs: 50,
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(await redis.exists(leaseKey(role))).toBe(1);
    expect(onLost).not.toHaveBeenCalled();
    await redis.set(leaseKey(role), 'intruder/1/x');
    await vi.waitFor(() => expect(onLost).toHaveBeenCalledOnce());
    await lease.release();
    expect(await redis.get(leaseKey(role))).toBe('intruder/1/x');
    await redis.del(leaseKey(role));
  });
});
