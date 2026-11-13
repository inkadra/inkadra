import type { ServerProblemKind, ServerRole, ServerServiceId } from '@inkadra/shared';
import IORedis from 'ioredis';
import type { Logger } from 'pino';

/**
 * Where the roles leave their samples, heartbeats, problems and events for the Server page
 * (#514): Valkey when there is one, so the web role sees what the collab and worker containers
 * report, or memory in a web role that runs alone (no REDIS_URL, so no other process either).
 */

/** Raw samples every 5 s for an hour, then minute and ten-minute averages for 24 h and 7 days. */
export const TIERS = {
  raw: { step: 5, keep: 720 },
  m1: { step: 60, keep: 1440 },
  m10: { step: 600, keep: 1008 },
} as const;
export type Tier = keyof typeof TIERS;

export const DAY_MS = 86_400_000;
export const KEEP_MS = 7 * DAY_MS;

/** One sample of one process; `c`, `m`, `rx`, `tx` are its container's. */
export interface Point {
  t: number;
  /** Cores the container used, and could use. */
  c: number;
  cc: number;
  m: number;
  ml: number | null;
  /** Bytes per second. */
  rx: number | null;
  tx: number | null;
  /** Cores and resident bytes of this process alone. */
  pc: number;
  pm: number;
  /** Web roles: the slowest answer of the fastest 95 %, requests and failed requests. */
  p95?: number | null;
  req?: number;
  err?: number;
  /** Collab roles: people on boards. */
  people?: number;
  /**
   * The machine (its boot id, shared by every container on it), and whether `cc` and `ml` are
   * the whole machine's because the container has no limit of its own. Older samples lack them.
   */
  box?: string;
  hc?: boolean;
  hm?: boolean;
}

export interface PresenceBoard {
  boardId: string;
  since: number;
  users: string[];
}

export interface Beat {
  role: ServerRole;
  host: string;
  startedAt: number;
  at: number;
  cpu: number;
  memory: number;
  presence?: PresenceBoard[];
}

export interface StoredProblem {
  id: string;
  kind: ServerProblemKind;
  severity: 'error' | 'warning';
  role: ServerRole;
  firstAt: number;
  lastAt: number;
  count: number;
  seenAt: number | null;
  technical: string;
  assetId: string | null;
  service: ServerServiceId | null;
  /** The BullMQ job that failed, to run it again. */
  job: { queue: string; id: string } | null;
  alertedAt: number | null;
  /** When it happened within the last hour, newest last (at most `RECENT_MAX`). */
  recent?: number[];
}

export type ProblemInput = Omit<
  StoredProblem,
  'firstAt' | 'lastAt' | 'count' | 'seenAt' | 'alertedAt' | 'recent'
> & { at: number };

const HOUR_MS = 3_600_000;
// shortcut: an hour holds at most 100 occurrences; the alert only needs to know it is 5 or more.
const RECENT_MAX = 100;

/** How many times a problem happened in the hour before `now`. */
export const lastHour = (p: Pick<StoredProblem, 'recent'>, now: number) =>
  (p.recent ?? []).filter((t) => now - t < HOUR_MS && t <= now).length;

export interface MonitorEvent {
  t: number;
  kind: 'video_ready' | 'video_failed';
  /** How long the job ran. */
  ms: number;
}

export interface MonitorStore {
  beat(beat: Beat): Promise<void>;
  /** Every process seen in the last 7 days. */
  beats(): Promise<Beat[]>;
  push(tier: Tier, process: string, point: Point): Promise<void>;
  /** The samples of `processes` (process keys), only those since `since` when given. */
  points(tier: Tier, processes: string[], since?: number): Promise<Map<string, Point[]>>;
  /** Adds an occurrence: a new problem, or one more of a known one (unseen again). */
  record(input: ProblemInput): Promise<void>;
  /** Problems of the last 7 days. */
  problems(): Promise<StoredProblem[]>;
  update(id: string, patch: Partial<Pick<StoredProblem, 'seenAt' | 'alertedAt'>>): Promise<void>;
  event(event: MonitorEvent): Promise<void>;
  events(since: number): Promise<MonitorEvent[]>;
  /** True for the first caller within `seconds`, across every process. */
  once(key: string, seconds: number): Promise<boolean>;
}

export const processKey = (beat: Pick<Beat, 'role' | 'host'>) => `${beat.role}@${beat.host}`;

function merge(old: StoredProblem | undefined, input: ProblemInput): StoredProblem {
  const { at, ...rest } = input;
  return {
    ...rest,
    firstAt: old?.firstAt ?? at,
    lastAt: Math.max(at, old?.lastAt ?? at),
    count: (old?.count ?? 0) + 1,
    seenAt: null,
    alertedAt: old?.alertedAt ?? null,
    recent: [...(old?.recent ?? []).filter((t) => at - t < HOUR_MS), at].slice(-RECENT_MAX),
  };
}

const fresh = (now: number) => (p: { lastAt: number }) => now - p.lastAt < KEEP_MS;

export function memoryStore(now = () => Date.now()): MonitorStore {
  const beats = new Map<string, Beat>();
  const points = new Map<string, Point[]>();
  const problems = new Map<string, StoredProblem>();
  const events: MonitorEvent[] = [];
  const locks = new Map<string, number>();
  return {
    async beat(beat) {
      beats.set(processKey(beat), beat);
    },
    async beats() {
      return [...beats.values()].filter((b) => now() - b.at < KEEP_MS);
    },
    async push(tier, process, point) {
      const key = `${tier}:${process}`;
      const list = points.get(key) ?? [];
      list.push(point);
      if (list.length > TIERS[tier].keep) list.shift();
      points.set(key, list);
    },
    async points(tier, processes, since = 0) {
      return new Map(
        processes.map((p) => [p, (points.get(`${tier}:${p}`) ?? []).filter((x) => x.t >= since)]),
      );
    },
    async record(input) {
      problems.set(input.id, merge(problems.get(input.id), input));
    },
    async problems() {
      return [...problems.values()].filter(fresh(now()));
    },
    async update(id, patch) {
      const old = problems.get(id);
      if (old) problems.set(id, { ...old, ...patch });
    },
    async event(event) {
      events.unshift(event);
      events.length = Math.min(events.length, 5000);
    },
    async events(since) {
      return events.filter((e) => e.t >= since);
    },
    async once(key, seconds) {
      const until = locks.get(key);
      if (until && until > now()) return false;
      locks.set(key, now() + seconds * 1000);
      return true;
    },
  };
}

const PREFIX = 'inkadra:monitor:';
/** The longest a monitor command may take: past it Valkey counts as down. */
export const MONITOR_TIMEOUT_MS = 2_000;

/**
 * The connection of the Server page: fails fast while Valkey is down, so the page, the sampler
 * and the health check report it instead of waiting forever (the queue connection retries).
 */
export function monitorRedis(url: string, log: Pick<Logger, 'warn'>) {
  const redis = new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: MONITOR_TIMEOUT_MS,
  });
  let lastError = Number.NEGATIVE_INFINITY;
  redis.on('error', () => {
    if (Date.now() - lastError < 60_000) return;
    lastError = Date.now();
    // Never the driver error itself: the connection string may carry a password.
    log.warn('server page storage unavailable');
  });
  return redis;
}

export function redisStore(redis: IORedis, now = () => Date.now()): MonitorStore {
  const k = (key: string) => `${PREFIX}${key}`;
  const parse = <T>(text: string | null | undefined): T | null => {
    try {
      return text ? (JSON.parse(text) as T) : null;
    } catch {
      return null;
    }
  };
  return {
    async beat(beat) {
      await redis.hset(k('beats'), processKey(beat), JSON.stringify(beat));
    },
    async beats() {
      const all = await redis.hgetall(k('beats'));
      const out: Beat[] = [];
      const stale: string[] = [];
      for (const [field, text] of Object.entries(all)) {
        const beat = parse<Beat>(text);
        if (beat && now() - beat.at < KEEP_MS) out.push(beat);
        else stale.push(field);
      }
      if (stale.length) await redis.hdel(k('beats'), ...stale);
      return out;
    },
    async push(tier, process, point) {
      const key = k(`points:${tier}:${process}`);
      await redis
        .multi()
        .lpush(key, JSON.stringify(point))
        .ltrim(key, 0, TIERS[tier].keep - 1)
        .pexpire(key, KEEP_MS + DAY_MS)
        .exec();
    },
    async points(tier, processes, since) {
      // Newest first: a start time reads only the samples after it, plus one for late ones.
      const last =
        since === undefined ? -1 : Math.ceil((now() - since) / (TIERS[tier].step * 1000)) + 1;
      const lists = await Promise.all(
        processes.map((p) => redis.lrange(k(`points:${tier}:${p}`), 0, last)),
      );
      return new Map(
        processes.map((p, i) => [
          p,
          (lists[i] ?? [])
            .map((text) => parse<Point>(text))
            .filter((x): x is Point => !!x && x.t >= (since ?? 0))
            .reverse(),
        ]),
      );
    },
    async record(input) {
      // shortcut: read then write, so two processes failing the same instant may count one;
      // move to a Lua script if exact counts ever matter.
      const old = parse<StoredProblem>(await redis.hget(k('problems'), input.id)) ?? undefined;
      await redis.hset(k('problems'), input.id, JSON.stringify(merge(old, input)));
    },
    async problems() {
      const [all, seen, alerted] = await Promise.all([
        redis.hgetall(k('problems')),
        redis.hgetall(k('problems:seenAt')),
        redis.hgetall(k('problems:alertedAt')),
      ]);
      const out: StoredProblem[] = [];
      const stale: string[] = [];
      for (const [id, text] of Object.entries(all)) {
        const p = parse<StoredProblem>(text);
        if (p && fresh(now())(p))
          out.push({
            ...p,
            // A later occurrence makes it unseen again: the page compares seenAt with lastAt.
            seenAt: seen[id] ? Number(seen[id]) : null,
            alertedAt: alerted[id] ? Number(alerted[id]) : p.alertedAt,
          });
        else stale.push(id);
      }
      if (stale.length)
        await redis
          .multi()
          .hdel(k('problems'), ...stale)
          .hdel(k('problems:seenAt'), ...stale)
          .hdel(k('problems:alertedAt'), ...stale)
          .exec();
      return out;
    },
    async update(id, patch) {
      // Fields of their own: a record() at the same moment cannot undo them, nor they it.
      if (!(await redis.hexists(k('problems'), id))) return;
      const m = redis.multi();
      if (patch.seenAt !== undefined) m.hset(k('problems:seenAt'), id, String(patch.seenAt ?? ''));
      if (patch.alertedAt !== undefined)
        m.hset(k('problems:alertedAt'), id, String(patch.alertedAt ?? ''));
      await m.exec();
    },
    async event(event) {
      await redis
        .multi()
        .lpush(k('events'), JSON.stringify(event))
        .ltrim(k('events'), 0, 4999)
        .exec();
    },
    async events(since) {
      return (await redis.lrange(k('events'), 0, -1))
        .map((text) => parse<MonitorEvent>(text))
        .filter((e): e is MonitorEvent => !!e && e.t >= since);
    },
    async once(key, seconds) {
      return (await redis.set(k(`once:${key}`), '1', 'EX', seconds, 'NX')) === 'OK';
    },
  };
}
