import { isIP } from 'node:net';
import IORedis from 'ioredis';
import type { Logger } from 'pino';
import type { Config } from './config.ts';
import { sha256 } from './secrets.ts';

/** Group rotating addresses without allowing IPv6 privacy addresses to bypass failures. */
export function authSource(address: string): string {
  if (isIP(address) === 4) return `${address.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIP(address) === 6) {
    // URL canonicalizes IPv4-mapped forms to hexadecimal before expanding ::.
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split('::');
    const start = left ? left.split(':') : [];
    const end = right ? right.split(':') : [];
    const parts =
      right === undefined
        ? start
        : [...start, ...Array(8 - start.length - end.length).fill('0'), ...end];
    if (parts.slice(0, 5).every((part) => Number.parseInt(part, 16) === 0) && parts[5] === 'ffff') {
      const high = Number.parseInt(parts[6] ?? '0', 16);
      const low = Number.parseInt(parts[7] ?? '0', 16);
      return authSource(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return `${parts
      .slice(0, 4)
      .map((part) => Number.parseInt(part, 16).toString(16))
      .join(':')}::/64`;
  }
  return 'unknown';
}

/** Atomic, expiring budgets; neither credentials nor addresses appear in keys. */
export function authSecurity(config: Config, log?: Logger) {
  const redis = config.REDIS_URL
    ? new IORedis(config.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 1000,
      })
    : undefined;
  if (!redis && config.NODE_ENV === 'production')
    throw new Error('REDIS_URL is required for persistent authentication rate limits.');
  let lastError = -Infinity;
  const reportError = () => {
    if (Date.now() - lastError < 60_000) return;
    lastError = Date.now();
    // Never serialize driver errors: connection strings may contain credentials.
    if (log) log.error('Authentication rate-limit storage unavailable');
    else console.error('Authentication rate-limit storage unavailable');
  };
  redis?.on('error', reportError);
  const memory = new Map<string, { n: number; until: number }>();
  const namespace = sha256(`${config.PUBLIC_URL}:${config.AUTH_SECRET}`);
  const key = (value: string) => `inkadra:auth:${namespace}:${sha256(value)}`;
  async function budget(id: string, max: number, seconds: number, increment: boolean) {
    if (redis) {
      const result = (await redis.eval(
        "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); if ARGV[2]=='1' then n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end end; return {n,redis.call('TTL',KEYS[1])}",
        1,
        key(id),
        seconds,
        increment ? '1' : '0',
      )) as [number, number];
      return {
        allowed: increment ? result[0] <= max : result[0] < max,
        retryAfter: Math.max(0, result[1]),
      };
    }
    const now = Date.now();
    let entry = memory.get(id);
    if (entry && entry.until <= now) {
      memory.delete(id);
      entry = undefined;
    }
    if (increment) {
      if (!entry && memory.size >= 10_000) {
        for (const [id, value] of memory) if (value.until <= now) memory.delete(id);
        const oldest = memory.keys().next().value;
        if (memory.size >= 10_000 && oldest !== undefined) memory.delete(oldest);
      }
      entry = { n: (entry?.n ?? 0) + 1, until: entry?.until ?? now + seconds * 1000 };
      memory.set(id, entry);
    }
    return {
      allowed: increment ? (entry?.n ?? 0) <= max : (entry?.n ?? 0) < max,
      retryAfter: entry ? Math.ceil((entry.until - now) / 1000) : 0,
    };
  }
  return {
    reportError,
    async ready() {
      if (!redis || redis.status === 'ready') return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          redis.off('ready', onReady);
          redis.off('error', onError);
          clearTimeout(timer);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('Authentication storage unavailable'));
        };
        const timer = setTimeout(onError, 5000);
        redis.once('ready', onReady);
        redis.once('error', onError);
      });
    },
    async refund(id: string) {
      if (redis) {
        await redis.eval(
          "if tonumber(redis.call('GET',KEYS[1]) or '0') > 0 then return redis.call('DECR',KEYS[1]) end; return 0",
          1,
          key(id),
        );
      } else {
        const entry = memory.get(id);
        if (entry && entry.until > Date.now() && entry.n > 0) entry.n--;
      }
    },
    check: (id: string, max: number, seconds: number) => budget(id, max, seconds, false),
    consume: (id: string, max: number, seconds: number) => budget(id, max, seconds, true),
    async take(id: string, max: number, seconds: number) {
      return (await budget(id, max, seconds, true)).allowed;
    },
    storage: {
      async delete(id: string) {
        if (redis) await redis.del(key(id));
        else memory.delete(id);
      },
    },
    close() {
      redis?.disconnect();
    },
  };
}
