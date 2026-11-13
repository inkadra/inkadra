import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Logger } from 'pino';
import { authSecurity } from './auth-security.ts';
import type { Config } from './config.ts';
import { HttpError } from './http/errors.ts';

/** Whole seconds, at least one, until an hourly count window frees the slot taken at `oldest`. */
export function hourlyRetryAfter(oldest: Date | null | undefined): number {
  return Math.max(
    1,
    Math.ceil(((oldest?.getTime() ?? Date.now()) + 3_600_000 - Date.now()) / 1000),
  );
}

/** IPv6 privacy addresses share a /64 budget; mapped IPv4 uses the IPv4 budget. */
export function addressBucket(address: string): string {
  // Interface zones are local routing hints, not separate address budgets.
  address = address.split('%')[0] ?? address;
  if (isIP(address) !== 6) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const words =
    right === undefined
      ? head
      : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  const nums = words.map((word) => Number.parseInt(word, 16));
  if (nums.slice(0, 5).every((n) => n === 0) && nums[5] === 0xffff) {
    const high = nums[6] ?? 0;
    const low = nums[7] ?? 0;
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return `${nums
    .slice(0, 4)
    .map((n) => n.toString(16))
    .join(':')}::/64`;
}

const MAX_KEYS = 10_000;
const EVICTION_SCAN = 64;

/**
 * Per-process sliding windows with a memory bound. When every slot is taken, expired entries go
 * first, then the least recently used keys that are not blocked, and only then blocked ones: a
 * client filling the table can never lock out everyone else, and blocked keys keep their
 * budget unless an attacker pays for ten thousand blocked keys at once.
 */
class MemoryRateLimiter {
  protected hits = new Map<string, number[]>();
  constructor(
    protected readonly max: number,
    protected readonly windowMs: number,
  ) {}
  protected recent(key: string) {
    return (this.hits.get(key) ?? []).filter((t) => Date.now() - t < this.windowMs);
  }
  protected inFlight(_key: string) {
    return false;
  }
  /** Hits of a key inside the window, without allocating. */
  protected count(key: string, now = Date.now()) {
    let n = 0;
    for (const t of this.hits.get(key) ?? []) if (now - t < this.windowMs) n++;
    return n;
  }
  protected isBlocked(key: string) {
    return this.count(key) >= this.max;
  }
  /** Moves a key to the most recently used end of the table. */
  protected store(key: string, times: number[]) {
    this.hits.delete(key);
    this.hits.set(key, times);
  }
  protected room(key: string) {
    if (this.hits.has(key) || this.hits.size < MAX_KEYS) return true;
    // Only the least recently used end is looked at, so a flood costs a bounded amount of work
    // per request: expired entries found there go, then an unblocked key, then a blocked one.
    const now = Date.now();
    let unblocked: string | undefined;
    let blocked: string | undefined;
    let looked = 0;
    for (const [k, times] of this.hits) {
      if (looked++ >= EVICTION_SCAN) break;
      if (this.inFlight(k)) continue;
      if (now - (times.at(-1) ?? 0) >= this.windowMs) {
        this.hits.delete(k);
        continue;
      }
      if (this.isBlocked(k)) blocked ??= k;
      else {
        unblocked = k;
        break;
      }
    }
    if (this.hits.size < MAX_KEYS) return true;
    const victim = unblocked ?? blocked;
    if (victim === undefined) return false;
    this.hits.delete(victim);
    return true;
  }
  /** Seconds until the completed hits allow another attempt; reservations can finish sooner. */
  retryAfterSeconds(key: string) {
    const recent = this.recent(key);
    const release = recent[recent.length - this.max];
    return release === undefined
      ? 0
      : Math.max(0, Math.ceil((release + this.windowMs - Date.now()) / 1000));
  }
  require(key: string, message: string) {
    if (!this.take(key))
      throw new HttpError(
        'rate_limited',
        message,
        undefined,
        Math.max(1, this.retryAfterSeconds(key)),
      );
  }
  take(key: string) {
    const recent = this.recent(key);
    if (recent.length >= this.max) {
      // A key still being refused stays away from the eviction end of the table.
      this.store(key, recent);
      return false;
    }
    if (!this.room(key)) return false;
    this.store(key, [...recent, Date.now()]);
    return true;
  }
}

/** Failed attempts plus in-flight reservations; successes return their reservation. */
class MemoryFailures extends MemoryRateLimiter {
  private pending = new Map<string, number>();
  protected override inFlight(key: string) {
    return this.pending.has(key);
  }
  protected override isBlocked(key: string) {
    return this.count(key) + (this.pending.get(key) ?? 0) >= this.max;
  }
  blocked(key: string) {
    return this.isBlocked(key) || !this.room(key);
  }
  begin(key: string) {
    if (this.blocked(key)) return false;
    // Reserve a slot too, so concurrent new keys cannot exceed the memory bound.
    this.store(key, this.recent(key));
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    return true;
  }
  finish(key: string, failed: boolean) {
    const pending = (this.pending.get(key) ?? 1) - 1;
    if (pending) this.pending.set(key, pending);
    else this.pending.delete(key);
    const recent = this.recent(key);
    if (failed) recent.push(Date.now());
    if (recent.length || pending) this.store(key, recent);
    else this.hits.delete(key);
  }
}

let shared: ReturnType<typeof authSecurity> | undefined;

/** One instance namespace and connection per process, shared by every product limiter. */
export async function configureRateLimits(config: Config, log?: Logger) {
  shared?.close();
  shared = config.REDIS_URL ? authSecurity(config, log) : undefined;
  await shared?.ready();
  const store = shared;
  return () => {
    store?.close();
    if (shared === store) shared = undefined;
  };
}

export class RateLimiter {
  protected memory: MemoryRateLimiter;
  protected retry = new Map<string, number>();
  constructor(
    protected readonly max: number,
    protected readonly windowMs: number,
    protected readonly scope = 'test',
  ) {
    this.memory = new MemoryRateLimiter(max, windowMs);
  }
  protected async budget(
    key: string,
    operation: 'check' | 'take' | 'refund' | 'fail',
    token: string = randomUUID(),
    sensitive = false,
  ) {
    if (!shared) throw new Error('No shared store');
    try {
      const result = await shared.sliding(
        `${this.scope}:${key}`,
        this.max,
        this.windowMs,
        operation,
        token,
      );
      // Only the immediately following error response needs the retry time; keep memory bounded.
      if (this.retry.size >= MAX_KEYS) this.retry.clear();
      this.retry.set(key, result.retryAfter);
      return result.allowed;
    } catch {
      shared.reportError();
      // Match auth: ordinary traffic remains available, password checks fail closed.
      return !sensitive;
    }
  }
  retryAfterSeconds(key: string) {
    return shared ? (this.retry.get(key) ?? 1) : this.memory.retryAfterSeconds(key);
  }
  async take(key: string) {
    return shared ? this.budget(key, 'take') : this.memory.take(key);
  }
  async require(key: string, message: string) {
    if (!(await this.take(key)))
      throw new HttpError(
        'rate_limited',
        message,
        undefined,
        Math.max(1, this.retryAfterSeconds(key)),
      );
  }
}

export class Failures extends RateLimiter {
  private failures: MemoryFailures;
  private reservations = new Map<string, string[]>();
  constructor(max: number, windowMs: number, scope = 'test') {
    super(max, windowMs, scope);
    this.failures = new MemoryFailures(max, windowMs);
  }
  override retryAfterSeconds(key: string) {
    return shared ? super.retryAfterSeconds(key) : this.failures.retryAfterSeconds(key);
  }
  async blocked(key: string) {
    return shared ? !(await this.budget(key, 'check', '', true)) : this.failures.blocked(key);
  }
  async begin(key: string) {
    if (!shared) return this.failures.begin(key);
    if (!this.reservations.has(key) && this.reservations.size >= MAX_KEYS) return false;
    const token = randomUUID();
    if (!(await this.budget(key, 'take', token, true))) return false;
    this.reservations.set(key, [...(this.reservations.get(key) ?? []), token]);
    return true;
  }
  async finish(key: string, failed: boolean) {
    if (!shared) return this.failures.finish(key, failed);
    const tokens = this.reservations.get(key);
    const token = tokens?.shift();
    if (!tokens?.length) this.reservations.delete(key);
    if (token) await this.budget(key, failed ? 'fail' : 'refund', token, true);
  }
}
