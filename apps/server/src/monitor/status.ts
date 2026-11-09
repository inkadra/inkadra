import type {
  DiagnosticCheck,
  ServerEvent,
  ServerPresenceBoard,
  ServerProblem,
  ServerProcess,
  ServerQueue,
  ServerQueueId,
  ServerRange,
  ServerSample,
  ServerService,
  ServerStatus,
  ServerTranscode,
} from '@inkadra/shared';
import type { Queue } from 'bullmq';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type IORedis from 'ioredis';
import { activeMember, boardRoles } from '../access.ts';
import { nextBackupAt, readBackupSettings } from '../backup.ts';
import { type Config, VERSION } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  asset,
  board,
  boardElementIndex,
  instanceBackup,
  project,
  projectMember,
  user,
} from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { readVideoEncoder } from '../media/encoder-setting.ts';
import { QUEUES, within } from '../queues.ts';
import { readServerAlerts } from './alerts.ts';
import { beatStatus, diskSpace, growthPerMonth, lastBeat } from './health.ts';
import { average } from './sampler.ts';
import {
  type Beat,
  DAY_MS,
  MONITOR_TIMEOUT_MS,
  type MonitorStore,
  type Point,
  processKey,
  type StoredProblem,
  type Tier,
} from './store.ts';

export interface ServerDeps {
  config: Config;
  db: Database;
  store: MonitorStore;
  jobs: Jobs;
  /** Without Valkey (a web role alone) there are no queues and no other processes. */
  queues?: Record<ServerQueueId, Queue>;
  /** The monitor connection: it gives up after MONITOR_TIMEOUT_MS instead of waiting. */
  redis?: IORedis;
}

/** Which tier a range reads and how far apart its points are, at most ~180 of them. */
export const RANGES: Record<ServerRange, { tier: Tier; window: number; step: number }> = {
  '15m': { tier: 'raw', window: 15 * 60, step: 10 },
  '1h': { tier: 'raw', window: 3600, step: 20 },
  '24h': { tier: 'm1', window: 86_400, step: 480 },
  '7d': { tier: 'm10', window: 7 * 86_400, step: 3600 },
};

const hostOf = (process: string) => process.slice(process.indexOf('@') + 1);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * What the containers could use. Containers without limits of their own see the whole machine:
 * its cores and memory count once per machine, however many such containers run on it, and the
 * limits of the others add up.
 */
export function capacity(containers: Point[]): { cores: number; memory: number | null } {
  const machines = new Map<string, Point[]>();
  containers.forEach((p, i) => {
    // Older samples do not tell their machine: each counts as one of its own.
    const key = p.box ?? `#${i}`;
    machines.set(key, [...(machines.get(key) ?? []), p]);
  });
  let cores = 0;
  let memory: number | null = 0;
  for (const list of machines.values()) {
    const hostCores = list.filter((p) => p.hc);
    cores += hostCores.length
      ? Math.max(...hostCores.map((p) => p.cc))
      : sum(list.map((p) => p.cc));
    if (memory === null || list.some((p) => p.ml === null)) {
      memory = null;
      continue;
    }
    const hostMemory = list.filter((p) => p.hm);
    memory += hostMemory.length
      ? Math.max(...hostMemory.map((p) => p.ml ?? 0))
      : sum(list.map((p) => p.ml ?? 0));
  }
  return { cores, memory };
}

/**
 * One series for the whole instance from the samples of every process: the container figures
 * once per host (two roles in one container read the same cgroup), added across hosts.
 */
export function combine(
  byProcess: Map<string, Point[]>,
  from: number,
  stepS: number,
): ServerSample[] {
  const step = stepS * 1000;
  const slices = new Map<string, Map<number, Point>>();
  const times = new Set<number>();
  for (const [process, points] of byProcess) {
    const lists = new Map<number, Point[]>();
    for (const p of points) {
      if (p.t < from) continue;
      const b = Math.floor(p.t / step) * step;
      lists.set(b, [...(lists.get(b) ?? []), p]);
    }
    const own = new Map<number, Point>();
    for (const [b, list] of lists) {
      own.set(b, average(list, b));
      times.add(b);
    }
    slices.set(process, own);
  }
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      const processes = new Map<string, Point>();
      for (const [process, own] of slices) {
        // Samples every 10 s fall 0 or 2 to a slice on the clock: an empty slice keeps the one
        // before, so a process does not drop out of the sums every other point.
        const p = own.get(t) ?? own.get(t - step);
        if (p) processes.set(process, p);
      }
      const hosts = new Map<string, Point>();
      for (const [process, p] of processes)
        if (!hosts.has(hostOf(process))) hosts.set(hostOf(process), p);
      const containers = [...hosts.values()];
      const { cores } = capacity(containers);
      const known = (pick: (p: Point) => number | null) => {
        const values = containers.map(pick).filter((v): v is number => v !== null);
        return values.length ? sum(values) : null;
      };
      const web = [...processes.values()].filter((p) => p.req !== undefined);
      const requests = sum(web.map((p) => p.req ?? 0));
      const p95s = web.map((p) => p.p95).filter((v): v is number => typeof v === 'number');
      const people = [...processes.values()]
        .map((p) => p.people)
        .filter((v): v is number => typeof v === 'number');
      return {
        t: iso(t),
        cpu: cores > 0 ? Math.min(100, (sum(containers.map((p) => p.c)) / cores) * 100) : null,
        memory: Math.round(sum(containers.map((p) => p.m))),
        in: known((p) => p.rx),
        out: known((p) => p.tx),
        p95: p95s.length ? Math.max(...p95s) : null,
        errors: requests > 0 ? sum(web.map((p) => p.err ?? 0)) / requests : null,
        people: people.length ? sum(people) : null,
      };
    });
}

/** Video copies made in each sixth of the window, and the backups that ended in it. */
async function chartEvents(deps: ServerDeps, from: number, now: number): Promise<ServerEvent[]> {
  const slice = (now - from) / 6;
  const videos = new Map<number, number>();
  for (const e of await deps.store.events(from))
    if (e.kind === 'video_ready') {
      const b = from + Math.min(5, Math.floor((e.t - from) / slice)) * slice + slice / 2;
      videos.set(b, (videos.get(b) ?? 0) + 1);
    }
  const backups = await deps.db
    .select({ status: instanceBackup.status, finishedAt: instanceBackup.finishedAt })
    .from(instanceBackup)
    .where(gt(instanceBackup.finishedAt, new Date(from)));
  return [
    ...[...videos].map(([t, count]) => ({ t: iso(t), kind: 'videos' as const, count })),
    ...backups.flatMap((b) =>
      b.finishedAt && b.status !== 'running'
        ? [
            {
              t: b.finishedAt.toISOString(),
              kind: b.status === 'failed' ? ('backup_failed' as const) : ('backup' as const),
              count: 1,
            },
          ]
        : [],
    ),
  ].sort((a, b) => a.t.localeCompare(b.t));
}

/** Projects the administrator is a member of: only their files and boards are named. */
async function memberProjects(db: Database, adminId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: projectMember.projectId })
    .from(projectMember)
    .where(and(eq(projectMember.userId, adminId), activeMember()));
  return new Set(rows.map((r) => r.id));
}

/** The queue connection waits for Valkey forever: past the timeout the queue counts as down. */
const bounded = <T>(work: Promise<T>) =>
  within(work, MONITOR_TIMEOUT_MS, 'The queue did not answer in time.');

async function queueCounts(
  queues: Record<ServerQueueId, Queue>,
  redis: IORedis | undefined,
  now: number,
): Promise<ServerQueue[]> {
  return Promise.all(
    (Object.keys(queues) as ServerQueueId[]).map(async (id): Promise<ServerQueue> => {
      const q = queues[id];
      const [counts, failed] = await Promise.all([
        bounded(q.getJobCounts('waiting', 'prioritized', 'delayed', 'active')),
        // BullMQ scores failed jobs by when they ended.
        redis ? redis.zcount(q.toKey('failed'), now - DAY_MS, '+inf') : 0,
      ]);
      return {
        id,
        waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0) + (counts.delayed ?? 0),
        active: counts.active ?? 0,
        failed24h: failed,
      };
    }),
  );
}

async function transcodes(
  deps: ServerDeps,
  visible: Set<string>,
  now: number,
): Promise<ServerStatus['transcodes']> {
  const { db, config } = deps;
  const rows = await db
    .select({
      id: asset.id,
      kind: asset.kind,
      filename: asset.filename,
      projectId: asset.projectId,
      durationMs: asset.durationMs,
      codec: asset.videoCodec,
      height: asset.height,
      progress: asset.proxyProgress,
    })
    .from(asset)
    .where(eq(asset.proxyStatus, 'processing'))
    .limit(10);
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(asset)
    .where(eq(asset.proxyStatus, 'queued'));
  const started = new Map<string, number>();
  if (deps.queues)
    for (const job of await bounded(deps.queues.proxies.getActive()).catch(() => []))
      if (job.processedOn) started.set((job.data as { assetId: string }).assetId, job.processedOn);
  const active = rows.map((r): ServerTranscode => {
    const progress = Math.max(0, Math.min(100, r.progress ?? 0));
    const since = started.get(r.id);
    const elapsed = since ? now - since : null;
    const lines = r.height ? Math.min(r.height, config.VIDEO_PROXY_RESOLUTION) : null;
    return {
      assetId: r.id,
      name: visible.has(r.projectId) ? r.filename : null,
      progress,
      secondsLeft:
        elapsed && progress >= 1
          ? Math.round(((elapsed / progress) * (100 - progress)) / 1000)
          : null,
      speed:
        elapsed && r.durationMs && progress > 0
          ? Math.round(((r.durationMs * progress) / 100 / elapsed) * 10) / 10
          : null,
      source: r.codec ? `${r.codec}${r.height ? ` ${r.height}p` : ''}` : null,
      target: r.kind === 'audio' ? 'aac' : `h264${lines ? ` ${lines}p` : ''}`,
    };
  });
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = await deps.store.events(midnight.getTime());
  const ready = today.filter((e) => e.kind === 'video_ready');
  return {
    active,
    waiting: waiting?.n ?? 0,
    readyToday: ready.length,
    failedToday: today.filter((e) => e.kind === 'video_failed').length,
    averageSeconds: ready.length
      ? Math.round(sum(ready.map((e) => e.ms)) / ready.length / 1000)
      : null,
  };
}

async function presence(
  deps: ServerDeps,
  adminId: string,
  visible: Set<string>,
  beats: Beat[],
  now: number,
): Promise<Omit<ServerStatus['presence'], 'peak'>> {
  const merged = new Map<string, { since: number; users: Set<string> }>();
  for (const beat of beats) {
    if (beatStatus(beat.at, now) === 'down') continue;
    for (const b of beat.presence ?? []) {
      const entry = merged.get(b.boardId) ?? { since: b.since, users: new Set<string>() };
      entry.since = Math.min(entry.since, b.since);
      for (const u of b.users) entry.users.add(u);
      merged.set(b.boardId, entry);
    }
  }
  if (!merged.size) return { people: 0, boards: [] };
  const ids = [...merged.keys()];
  const readable = await boardRoles(deps.db, { id: adminId }, ids);
  // Only boards of projects the administrator is a member of: a board shared with them alone
  // would name a project, and people, they are not part of.
  const titles = (
    ids.length
      ? await deps.db
          .select({
            id: board.id,
            title: board.title,
            projectId: board.projectId,
            project: project.name,
          })
          .from(board)
          .innerJoin(project, eq(project.id, board.projectId))
          .where(inArray(board.id, ids))
      : []
  ).filter((t) => readable.has(t.id) && visible.has(t.projectId));
  const open = titles.map((t) => t.id);
  const people = [...new Set(open.flatMap((id) => [...(merged.get(id)?.users ?? [])]))];
  const names = people.length
    ? await deps.db
        .select({ id: user.id, name: user.name, image: user.image })
        .from(user)
        .where(inArray(user.id, people))
    : [];
  const byId = new Map(names.map((n) => [n.id, n]));
  const boards = ids.map((id): ServerPresenceBoard => {
    const entry = merged.get(id) as { since: number; users: Set<string> };
    const shown = titles.find((t) => t.id === id);
    return {
      boardId: shown ? id : null,
      title: shown?.title ?? null,
      projectName: shown?.project ?? null,
      since: iso(entry.since),
      count: entry.users.size,
      people: shown
        ? [...entry.users].flatMap((u) => {
            const n = byId.get(u);
            return n ? [{ id: n.id, name: n.name, image: n.image }] : [];
          })
        : [],
    };
  });
  return {
    people: new Set([...merged.values()].flatMap((e) => [...e.users])).size,
    boards: boards.sort((a, b) => b.count - a.count || a.since.localeCompare(b.since)),
  };
}

const RETRYABLE = new Set(['video_failed', 'preview_failed', 'office_failed']);

/** Problems as the page shows them: newest first, files and boards named only when visible. */
async function problems(
  deps: ServerDeps,
  adminId: string,
  visible: Set<string>,
  stored: StoredProblem[],
  checks: DiagnosticCheck[],
  now: number,
): Promise<ServerProblem[]> {
  const assetIds = [...new Set(stored.flatMap((p) => (p.assetId ? [p.assetId] : [])))];
  const files = assetIds.length
    ? await deps.db
        .select({ id: asset.id, filename: asset.filename, projectId: asset.projectId })
        .from(asset)
        .where(inArray(asset.id, assetIds))
    : [];
  const shown = files.filter((f) => visible.has(f.projectId));
  // Where each file is used, on boards of projects the administrator is a member of only.
  // shortcut: the first 1000 uses; a file on more boards than that is named by one of them.
  const uses =
    shown.length && visible.size
      ? await deps.db
          .select({
            assetId: boardElementIndex.assetId,
            boardId: boardElementIndex.boardId,
            title: board.title,
          })
          .from(boardElementIndex)
          .innerJoin(board, eq(board.id, boardElementIndex.boardId))
          .where(
            and(
              isNotNull(boardElementIndex.assetId),
              inArray(
                boardElementIndex.assetId,
                shown.map((f) => f.id),
              ),
              inArray(board.projectId, [...visible]),
            ),
          )
          .orderBy(boardElementIndex.assetId, board.createdAt, board.id)
          .limit(1000)
      : [];
  const readable = await boardRoles(deps.db, { id: adminId }, [
    ...new Set(uses.map((u) => u.boardId)),
  ]);
  const fileName = new Map(shown.map((f) => [f.id, f.filename]));
  const boardOf = new Map<string, string>();
  for (const u of uses)
    if (u.assetId && !boardOf.has(u.assetId) && readable.has(u.boardId))
      boardOf.set(u.assetId, u.title);
  const out: ServerProblem[] = stored.map((p) => ({
    id: p.id,
    kind: p.kind,
    severity: p.severity,
    role: p.role,
    firstAt: iso(p.firstAt),
    lastAt: iso(p.lastAt),
    count: p.count,
    seen: p.seenAt !== null && p.seenAt >= p.lastAt,
    retry: !!p.job || (!!p.assetId && RETRYABLE.has(p.kind)),
    technical: p.technical,
    checkId: null,
    service: p.service,
    file: p.assetId ? (fileName.get(p.assetId) ?? null) : null,
    board: p.assetId ? (boardOf.get(p.assetId) ?? null) : null,
  }));
  // Failing configuration checks: problems while they fail, gone once they pass.
  for (const c of checks)
    if (c.status !== 'ok')
      out.push({
        id: `check:${c.id}`,
        kind: 'config_check',
        severity: c.status === 'error' ? 'error' : 'warning',
        role: 'web',
        firstAt: iso(now),
        lastAt: iso(now),
        count: 1,
        seen: false,
        retry: false,
        technical: [c.id, c.expected && `expected ${c.expected}`, c.actual && `found ${c.actual}`]
          .filter(Boolean)
          .join(' · '),
        checkId: c.id,
        service: 'configuration',
        file: null,
        board: null,
      });
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

async function database(db: Database) {
  try {
    const [row] = await db.execute<{ version: string; size: string; connections: number }>(sql`
      select current_setting('server_version') as version,
        pg_database_size(current_database())::text as size,
        (select count(*)::int from pg_stat_activity where datname = current_database()) as connections`);
    return {
      ok: true,
      version: row ? `PostgreSQL ${row.version.split(' ')[0]}` : null,
      size: row ? Number(row.size) : null,
      connections: row?.connections ?? null,
    };
  } catch {
    return { ok: false, version: null, size: null, connections: null };
  }
}

async function valkey(
  redis: IORedis | undefined,
): Promise<{ ok: boolean; version: string | null }> {
  if (!redis) return { ok: false, version: null };
  try {
    const info = await redis.info('server');
    const valkeyVersion = /^valkey_version:(\S+)/m.exec(info)?.[1];
    const redisVersion = /^redis_version:(\S+)/m.exec(info)?.[1];
    return {
      ok: true,
      version: valkeyVersion
        ? `Valkey ${valkeyVersion}`
        : redisVersion
          ? `Redis ${redisVersion}`
          : null,
    };
  } catch {
    return { ok: false, version: null };
  }
}

function roleService(
  id: 'collab' | 'worker',
  beats: Beat[],
  now: number,
  fallback: ServerService['status'],
): ServerService {
  const beat = lastBeat(beats, id);
  if (!beat) return { id, status: fallback, since: null, detail: null };
  const status = beatStatus(beat.at, now);
  return {
    id,
    status: status === 'ok' ? 'ok' : status === 'late' ? 'warning' : 'down',
    since: iso(beat.at),
    detail: null,
  };
}

/** The Server page (#514) for administrator `adminId`. */
/** Docker sets OFFICE for both images; development runs have no image flavour. */
export function imageFlavour(): 'standard' | 'office' | null {
  return process.env.INKADRA_OFFICE === 'true'
    ? 'office'
    : process.env.INKADRA_OFFICE === 'false'
      ? 'standard'
      : null;
}

export async function serverStatus(
  deps: ServerDeps,
  adminId: string,
  range: ServerRange,
  checks: DiagnosticCheck[],
  now = Date.now(),
): Promise<ServerStatus> {
  const { config, db, store } = deps;
  const { tier, window, step } = RANGES[range];
  const from = now - window * 1000;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const beats = await store.beats();
  // Only processes heard from since `since`: one stopped days ago has no samples to show.
  const alive = (since: number) => beats.filter((b) => b.at >= since).map(processKey);
  const [points, today, raw, visible, stored] = await Promise.all([
    store.points(tier, alive(from), from),
    // Today's traffic: the minute averages since midnight, already read for 24 h.
    tier === 'm1' && from <= midnight.getTime()
      ? null
      : store.points('m1', alive(midnight.getTime()), midnight.getTime()),
    tier === 'raw' ? Promise.resolve(null) : store.points('raw', alive(now - 3_600_000)),
    memberProjects(db, adminId),
    store.problems(),
  ]);
  const history = combine(points, from, step);
  const recent = combine(raw ?? points, now - 60_000, 60).at(-1);
  const hour = combine(raw ?? points, now - 3_600_000, 3600);
  const day = combine(today ?? points, midnight.getTime(), 60);
  const lastPoints = [...(raw ?? points).entries()].flatMap(([process, list]) => {
    const last = list.at(-1);
    return last && now - last.t < 60_000 ? [[process, last] as const] : [];
  });
  const hosts = new Map<string, Point>();
  for (const [process, p] of lastPoints)
    if (!hosts.has(hostOf(process))) hosts.set(hostOf(process), p);
  const containers = [...hosts.values()];
  const room = capacity(containers);
  const webRecent = combine(raw ?? points, now - 5 * 60_000, 300).at(-1);
  const hourRequests = hour.at(-1);

  const processes: ServerProcess[] = beats
    .filter(
      (b) => now - b.at < 10 * 60_000 || lastBeat(beats, b.role === 'all' ? 'web' : b.role) === b,
    )
    .map((b) => ({
      role: b.role,
      host: b.host,
      startedAt: iso(b.startedAt),
      lastSeenAt: iso(b.at),
      status: beatStatus(b.at, now),
      cpu: b.cpu,
      memory: b.memory,
    }))
    .sort((a, b) => a.role.localeCompare(b.role));
  const running = beats.filter((b) => beatStatus(b.at, now) !== 'down');

  const disk = await diskSpace(config);
  const [bytes] = await db.execute<{ originals: string; copies: string; previews: string }>(sql`
    select
      (select coalesce(sum(size), 0) from asset where status <> 'pending')::text as originals,
      (select coalesce(sum(bytes), 0) from asset_variant where size = 'proxy')::text as copies,
      (select coalesce(sum(bytes), 0) from asset_variant where size <> 'proxy')::text as previews`);
  const originals = Number(bytes?.originals ?? 0);
  const copies = Number(bytes?.copies ?? 0);
  const previews = Number(bytes?.previews ?? 0);
  const growth = await growthPerMonth(db, now);

  const backupSettings = await readBackupSettings(db);
  const [lastBackup] = await db
    .select()
    .from(instanceBackup)
    .orderBy(desc(instanceBackup.startedAt))
    .limit(1);
  const next = nextBackupAt(backupSettings, new Date(now));

  const [dbInfo, queueInfo, encoder, alerts, events, transcodeInfo, people, problemList] =
    await Promise.all([
      database(db),
      valkey(deps.redis),
      readVideoEncoder(db).catch(() => null),
      readServerAlerts(db),
      chartEvents(deps, from, now),
      transcodes(deps, visible, now),
      presence(deps, adminId, visible, running, now),
      problems(deps, adminId, visible, stored, checks, now),
    ]);
  const queues = deps.queues
    ? await queueCounts(deps.queues, deps.redis, now).catch(() => null)
    : [];

  const configStatus: ServerService['status'] = checks.some((c) => c.status === 'error')
    ? 'down'
    : checks.some((c) => c.status === 'warning')
      ? 'warning'
      : 'ok';
  const services: ServerService[] = [
    { id: 'web', status: 'ok', since: iso(now), detail: null },
    roleService('collab', beats, now, deps.redis ? 'down' : 'off'),
    // Without Valkey the web role makes previews and copies itself.
    roleService('worker', beats, now, deps.redis ? 'down' : 'ok'),
    { id: 'database', status: dbInfo.ok ? 'ok' : 'down', since: null, detail: dbInfo.version },
    deps.redis
      ? {
          id: 'queue',
          status: queueInfo.ok && queues ? 'ok' : 'down',
          since: null,
          detail: queueInfo.version,
        }
      : { id: 'queue', status: 'off', since: null, detail: null },
    { id: 'configuration', status: configStatus, since: null, detail: null },
  ];

  const peaks = history.map((s) => s.people).filter((v): v is number => v !== null);
  return {
    checkedAt: iso(now),
    version: VERSION,
    image: imageFlavour(),
    startedAt: running.length ? iso(Math.min(...running.map((b) => b.startedAt))) : null,
    range,
    step,
    history,
    events,
    now: {
      cpu: { used: sum(containers.map((p) => p.c)), cores: room.cores },
      memory: {
        used: Math.round(sum(containers.map((p) => p.m))),
        limit: containers.length ? room.memory : null,
      },
      network:
        recent && recent.in !== null && recent.out !== null
          ? {
              in: recent.in,
              out: recent.out,
              todayIn: Math.round(sum(day.map((s) => (s.in ?? 0) * 60))),
              todayOut: Math.round(sum(day.map((s) => (s.out ?? 0) * 60))),
            }
          : null,
      responses: { p95: webRecent?.p95 ?? null, errors: hourRequests?.errors ?? null },
    },
    processes,
    services,
    storage: {
      driver: config.STORAGE_DRIVER,
      location: config.STORAGE_DRIVER === 's3' ? (config.S3_BUCKET ?? '') : config.DATA_DIR,
      total: disk ? Math.round(disk.total) : null,
      free: disk ? Math.round(disk.free) : null,
      used: disk ? Math.round(disk.total - disk.free) : originals + copies + previews,
      originals,
      copies,
      previews,
      growthPerMonth: growth,
      monthsLeft: disk && growth > 0 ? Math.round((disk.free / growth) * 10) / 10 : null,
    },
    backup: {
      enabled: backupSettings.enabled,
      lastAt: lastBackup ? (lastBackup.finishedAt ?? lastBackup.startedAt).toISOString() : null,
      lastStatus: lastBackup?.status ?? null,
      size: lastBackup?.size ?? null,
      nextAt: next ? next.toISOString() : null,
    },
    database: { version: dbInfo.version, size: dbInfo.size, connections: dbInfo.connections },
    encoder: encoder ? { backend: encoder.backend, label: encoder.label } : null,
    queues: queues ?? [],
    transcodes: transcodeInfo,
    presence: { ...people, peak: peaks.length ? Math.max(...peaks) : null },
    checks,
    problems: problemList,
    alerts,
  };
}

/** Runs the job of a problem again; false when there is nothing left to run. */
export async function retryProblem(deps: ServerDeps, p: StoredProblem): Promise<boolean> {
  const { db, jobs } = deps;
  // A file deleted since, or made since by an upload or a retry elsewhere, has nothing to run.
  if (p.kind === 'video_failed' && p.assetId && jobs.makeProxy) {
    const [queued] = await db
      .update(asset)
      .set({ proxyStatus: 'queued', proxyProgress: null })
      .where(and(eq(asset.id, p.assetId), eq(asset.proxyStatus, 'failed')))
      .returning({ id: asset.id });
    if (!queued) return false;
    await jobs.makeProxy(p.assetId);
    return true;
  }
  if (p.kind === 'office_failed' && p.assetId && jobs.convertOffice) {
    const [found] = await db.select({ id: asset.id }).from(asset).where(eq(asset.id, p.assetId));
    if (!found) return false;
    await jobs.convertOffice(p.assetId);
    return true;
  }
  if (p.kind === 'preview_failed' && p.assetId) {
    const [failed] = await db
      .select({ id: asset.id })
      .from(asset)
      .where(and(eq(asset.id, p.assetId), eq(asset.status, 'failed')));
    if (!failed) return false;
    await jobs.processAsset(p.assetId);
    return true;
  }
  if (!p.job || !deps.queues) return false;
  const id = (Object.keys(QUEUES) as Array<keyof typeof QUEUES>).find(
    (k) => QUEUES[k] === p.job?.queue,
  );
  const queue = id && id in deps.queues ? deps.queues[id as ServerQueueId] : undefined;
  const job = queue ? await bounded(queue.getJob(p.job.id)) : undefined;
  if (!job || !(await bounded(job.isFailed()))) return false;
  await bounded(job.retry());
  return true;
}
