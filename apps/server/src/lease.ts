import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type IORedis from 'ioredis';
import type { Logger } from 'pino';

/**
 * One process per role (#790, #819). Collab keeps each open board in memory and stores it whole,
 * and the web role runs migrations, keeps upload parts on its own DATA_DIR and live HLS sessions
 * in memory: two of either lose data. Each role holds a lease in Valkey for as long as it runs;
 * a second process of the same role refuses to start.
 */
export const LEASE_TTL_MS = 30_000;
export const LEASE_RENEW_MS = 10_000;

export type LeaseRole = 'web' | 'collab';

export const leaseKey = (role: LeaseRole) => `inkadra:lease:${role}`;

type Redis = Pick<IORedis, 'eval'>;

// Renews our own lease, or takes it again when it is gone (a Valkey restart without persistence).
const RENEW = `
local v = redis.call('get', KEYS[1])
if v == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end
if not v then redis.call('set', KEYS[1], ARGV[1], 'px', ARGV[2]) return 1 end
return 0`;
// Takes a free lease, or one left by an earlier run of this same container (same host name: a
// restart after a crash must not wait for the TTL).
const ACQUIRE = `
local v = redis.call('get', KEYS[1])
if (not v) or string.sub(v, 1, string.len(ARGV[3])) == ARGV[3] then
  redis.call('set', KEYS[1], ARGV[1], 'px', ARGV[2]) return 1
end
return v`;
const RELEASE = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end
return 0`;

export class LeaseTakenError extends Error {}

export interface Lease {
  release(): Promise<void>;
}

/**
 * Takes the lease of `role` or throws `LeaseTakenError`. While held it is renewed every
 * `renewMs`; `onLost` runs when another process holds it at a renewal (this one must stop).
 * A Valkey outage only logs: the lease is renewed again once it is back.
 */
export async function acquireLease(
  redis: Redis,
  role: LeaseRole,
  log: Pick<Logger, 'warn' | 'error'>,
  opts: { host?: string; ttlMs?: number; renewMs?: number; onLost: () => void },
): Promise<Lease> {
  const host = opts.host ?? hostname();
  const ttl = String(opts.ttlMs ?? LEASE_TTL_MS);
  const me = `${host}/${process.pid}/${randomUUID()}`;
  const key = leaseKey(role);
  const got = await redis.eval(ACQUIRE, 1, key, me, ttl, `${host}/`);
  if (got !== 1)
    throw new LeaseTakenError(
      `Another inkadra process with the ${role} role is running (${String(got).split('/')[0]}). ` +
        `Inkadra supports exactly one ${role} process per instance: stop the other one, or ` +
        `wait ${Math.ceil(Number(ttl) / 1000)} s if it has just stopped.`,
    );
  const timer = setInterval(() => {
    redis.eval(RENEW, 1, key, me, ttl).then(
      (ok) => {
        if (ok === 1) return;
        clearInterval(timer);
        log.error({ role }, `another ${role} process took over: only one is supported`);
        opts.onLost();
      },
      () => log.warn({ role }, 'could not renew the single-process lease: Valkey unavailable'),
    );
  }, opts.renewMs ?? LEASE_RENEW_MS);
  timer.unref();
  return {
    async release() {
      clearInterval(timer);
      await redis.eval(RELEASE, 1, key, me).catch(() => undefined);
    },
  };
}
