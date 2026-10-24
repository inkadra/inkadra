import { isIP } from 'node:net';

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

/** Per-process sliding windows. Capacity pressure removes only expired entries. */
export class RateLimiter {
  protected hits = new Map<string, number[]>();
  private nextSweep = 0;
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
  protected room(key: string) {
    if (this.hits.size >= MAX_KEYS && Date.now() >= this.nextSweep) {
      for (const [k, times] of this.hits) {
        if (!this.inFlight(k) && Date.now() - (times.at(-1) ?? 0) >= this.windowMs)
          this.hits.delete(k);
      }
      this.nextSweep = Date.now() + 1000;
    }
    // Fail closed for new keys while all slots are live; never reset an attacker's budget.
    return this.hits.has(key) || this.hits.size < MAX_KEYS;
  }
  take(key: string) {
    const recent = this.recent(key);
    if (recent.length >= this.max || !this.room(key)) return false;
    this.hits.set(key, [...recent, Date.now()]);
    return true;
  }
}

/** Failed attempts plus in-flight reservations; successes return their reservation. */
export class Failures extends RateLimiter {
  private pending = new Map<string, number>();
  protected override inFlight(key: string) {
    return this.pending.has(key);
  }
  blocked(key: string) {
    return this.recent(key).length + (this.pending.get(key) ?? 0) >= this.max || !this.room(key);
  }
  begin(key: string) {
    if (this.blocked(key)) return false;
    // Reserve a slot too, so concurrent new keys cannot exceed the memory bound.
    this.hits.set(key, this.recent(key));
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    return true;
  }
  finish(key: string, failed: boolean) {
    const pending = (this.pending.get(key) ?? 1) - 1;
    if (pending) this.pending.set(key, pending);
    else this.pending.delete(key);
    const recent = this.recent(key);
    if (failed) recent.push(Date.now());
    if (recent.length || pending) this.hits.set(key, recent);
    else this.hits.delete(key);
  }
}
