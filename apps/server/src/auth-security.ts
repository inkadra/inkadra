import IORedis from 'ioredis';
import type { Config } from './config.ts';
import { sha256 } from './secrets.ts';

/** Shared, expiring auth budgets. Keys never contain an email address or credential. */
export function authSecurity(config: Config) {
  const redis = config.REDIS_URL && config.NODE_ENV !== 'test'
    ? new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
    : undefined;
  if (!redis && config.NODE_ENV === 'production')
    throw new Error('REDIS_URL is required for persistent authentication rate limits.');
  // Do not let connection errors become unhandled EventEmitter errors.
  redis?.on('error', () => {});
  const memory = new Map<string, { value: string; until: number }>();
  const key = (value: string) => `inkadra:auth:${sha256(value)}`;
  const storage = {
    async get(id: string) {
      if (redis) return redis.get(key(id));
      const entry = memory.get(id);
      if (!entry || entry.until <= Date.now()) { memory.delete(id); return null; }
      return entry.value;
    },
    async set(id: string, value: string, ttl = 900) {
      if (redis) { await redis.set(key(id), value, 'EX', ttl); return; }
      memory.set(id, { value, until: Date.now() + ttl * 1000 });
    },
    async delete(id: string) {
      if (redis) { await redis.del(key(id)); return; }
      memory.delete(id);
    },
  };
  return {
    storage,
    async take(id: string, max: number, seconds: number) {
      if (redis) {
        const n = await redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
          1, key(id), seconds,
        );
        return Number(n) <= max;
      }
      const now = Date.now();
      const entry = memory.get(id);
      const active = entry && entry.until > now ? entry : undefined;
      if (!active && memory.size >= 10_000) {
        for (const [key, value] of memory) if (value.until <= now) memory.delete(key);
        if (memory.size >= 10_000) return false;
      }
      const n = Number(active?.value ?? 0) + 1;
      memory.set(id, { value: String(n), until: active?.until ?? now + seconds * 1000 });
      return n <= max;
    },
    close() { redis?.disconnect(); },
  };
}
