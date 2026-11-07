import type { ServerProblemKind, ServerRole, ServerServiceId } from '@inkadra/shared';
import type IORedis from 'ioredis';

/**
 * Where the roles leave their samples, heartbeats, problems and events for the Server page
 * (#514): Valkey when there is one, so the web role sees what the collab and worker containers
 * report, or memory in a web role that runs alone (no REDIS_URL, so no other process either).
 */

/** Raw samples every 10 s for an hour, then minute and ten-minute averages for 24 h and 7 days. */
export const TIERS = {
  raw: { step: 10, keep: 360 },
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
}

export type ProblemInput = Omit<
  StoredProblem,
  'firstAt' | 'lastAt' | 'count' | 'seenAt' | 'alertedAt'
> & { at: number };

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
  points(tier: Tier): Promise<Map<string, Point[]>>;
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
    async points(tier) {
      const out = new Map<string, Point[]>();
      for (const [key, list] of points)
        if (key.startsWith(`${tier}:`)) out.set(key.slice(tier.length + 1), [...list]);
      return out;
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
    async points(tier) {
      // The processes are the ones with a heartbeat: no SCAN over the whole keyspace.
      const processes = (await this.beats()).map(processKey);
      const lists = await Promise.all(
        processes.map((p) => redis.lrange(k(`points:${tier}:${p}`), 0, -1)),
      );
      return new Map(
        processes.map((p, i) => [
          p,
          (lists[i] ?? [])
            .map((text) => parse<Point>(text))
            .filter((x): x is Point => !!x)
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
      const all = await redis.hgetall(k('problems'));
      const out: StoredProblem[] = [];
      const stale: string[] = [];
      for (const [id, text] of Object.entries(all)) {
        const p = parse<StoredProblem>(text);
        if (p && fresh(now())(p)) out.push(p);
        else stale.push(id);
      }
      if (stale.length) await redis.hdel(k('problems'), ...stale);
      return out;
    },
    async update(id, patch) {
      const old = parse<StoredProblem>(await redis.hget(k('problems'), id));
      if (old) await redis.hset(k('problems'), id, JSON.stringify({ ...old, ...patch }));
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
