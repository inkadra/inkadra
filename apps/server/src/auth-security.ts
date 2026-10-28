import IORedis from 'ioredis';
import type { Config } from './config.ts';
import { sha256 } from './secrets.ts';

/** Atomic, expiring budgets; neither credentials nor addresses appear in keys. */
export function authSecurity(config: Config) {
  const redis = config.REDIS_URL
    ? new IORedis(config.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 1000,
      })
    : undefined;
  if (!redis && config.NODE_ENV === 'production')
    throw new Error('REDIS_URL is required for persistent authentication rate limits.');
  redis?.on('error', () => {});
  const memory = new Map<string, { n: number; until: number }>();
  const key = (value: string) => `inkadra:auth:${sha256(value)}`;
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
