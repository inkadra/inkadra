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

/** How long an unreachable Valkey is retried at startup (a host reboot starts it late). */
export const LEASE_UNAVAILABLE_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Takes the lease of `role` or throws `LeaseTakenError`. A held lease is waited for, a little
 * longer than it lives: the process before this one may have been killed before releasing it
 * (`docker compose down` past its grace period, a crash), and Valkey keeps it across restarts.
 * An unreachable Valkey is retried with backoff for `unavailableMs` (Docker may start it after
 * this process, whatever `depends_on` says), then its error is thrown.
 * While held it is renewed every `renewMs`; `onLost` runs when another process has held it for
 * a whole TTL (this one must stop). A foreign value seen once is not enough: after a Valkey crash
 * an append-only file can bring back the key of a holder long gone, which expires on its own.
 * A Valkey outage only logs: the lease is renewed again once it is back.
 */
export async function acquireLease(
  redis: Redis,
  role: LeaseRole,
  log: Pick<Logger, 'warn' | 'error'>,
  opts: {
    host?: string;
    ttlMs?: number;
    renewMs?: number;
    /** How long a held lease is waited for; by default its whole life and 5 s more. */
    waitMs?: number;
    /** How long an unreachable Valkey is retried. */
    unavailableMs?: number;
    onLost: () => void;
  },
): Promise<Lease> {
  const host = opts.host ?? hostname();
  const ttlMs = opts.ttlMs ?? LEASE_TTL_MS;
  const ttl = String(ttlMs);
  const me = `${host}/${process.pid}/${randomUUID()}`;
  const key = leaseKey(role);
  const waitMs = opts.waitMs ?? ttlMs + 5_000;
  const giveUp = Date.now() + (opts.unavailableMs ?? LEASE_UNAVAILABLE_MS);
  let heldSince: number | undefined;
  let backoff = 500;
  for (;;) {
    let got: unknown;
    try {
      got = await redis.eval(ACQUIRE, 1, key, me, ttl, `${host}/`);
    } catch (err) {
      if (Date.now() >= giveUp) throw err;
      log.warn({ role, err: String(err) }, 'Valkey unavailable: retrying the single-process lease');
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 10_000);
      continue;
    }
    if (got === 1) break;
    if (heldSince === undefined) {
      heldSince = Date.now();
      log.warn({ role }, `waiting for the ${role} lease held by another process`);
    }
    if (Date.now() - heldSince >= waitMs)
      throw new LeaseTakenError(
        `Another inkadra process with the ${role} role is running (${String(got).split('/')[0]}). ` +
          `Inkadra supports exactly one ${role} process per instance: stop the other one, or ` +
          `start this one again if it has just stopped.`,
      );
    await sleep(1_000);
  }
  let foreignSince: number | undefined;
  const timer = setInterval(() => {
    redis.eval(RENEW, 1, key, me, ttl).then(
      (ok) => {
        if (ok === 1) {
          foreignSince = undefined;
          return;
        }
        foreignSince ??= Date.now();
        if (Date.now() - foreignSince < ttlMs) {
          log.warn({ role }, `the ${role} lease is held by another process: waiting for it to end`);
          return;
        }
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
