import type { IntervalHistogram } from 'node:perf_hooks';
import { desc, eq } from 'drizzle-orm';
import { instanceBackup } from '../db/schema.ts';
import { beatStatus, diskSpace } from './health.ts';
import { database, queueCounts, type ServerDeps } from './status.ts';

export interface Metric {
  name: string;
  help: string;
  values: Array<{ labels?: Record<string, string>; value: number }>;
}

const label = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** The Prometheus text format (version 0.0.4); every metric is a gauge. */
export function renderMetrics(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const m of metrics) {
    if (!m.values.length) continue;
    lines.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} gauge`);
    for (const { labels, value } of m.values) {
      const set = Object.entries(labels ?? {})
        .map(([k, v]) => `${k}="${label(v)}"`)
        .join(',');
      lines.push(`${m.name}${set ? `{${set}}` : ''} ${Number.isFinite(value) ? value : 'NaN'}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * What an external monitor needs to alert without the app (#816, #817): every role's heartbeat,
 * queue depth and failures, disk, database and the last good backup. Each part that cannot be
 * read is left out rather than failing the scrape.
 */
export async function collectMetrics(
  deps: ServerDeps,
  loop?: IntervalHistogram,
  now = Date.now(),
): Promise<Metric[]> {
  const [beats, queues, disk, db, backup] = await Promise.all([
    deps.store.beats().catch(() => []),
    deps.queues ? queueCounts(deps.queues, deps.redis, now).catch(() => []) : [],
    diskSpace(deps.config),
    database(deps.db),
    deps.db
      .select({ at: instanceBackup.finishedAt })
      .from(instanceBackup)
      .where(eq(instanceBackup.status, 'ready'))
      .orderBy(desc(instanceBackup.startedAt))
      .limit(1)
      .then(([row]) => row?.at ?? null)
      .catch(() => null),
  ]);
  const who = (b: (typeof beats)[number]) => ({ role: b.role, host: b.host });
  const metrics: Metric[] = [
    {
      name: 'inkadra_process_up',
      help: 'Whether a process of this role sent its heartbeat recently (1) or not (0).',
      values: beats.map((b) => ({
        labels: who(b),
        value: beatStatus(b.at, now) === 'down' ? 0 : 1,
      })),
    },
    {
      name: 'inkadra_process_heartbeat_age_seconds',
      help: 'Seconds since the last heartbeat of the process.',
      values: beats.map((b) => ({ labels: who(b), value: (now - b.at) / 1000 })),
    },
    {
      name: 'inkadra_queue_jobs',
      help: 'Jobs in the queue, by state.',
      values: queues.flatMap((q) => [
        { labels: { queue: q.id, state: 'waiting' }, value: q.waiting },
        { labels: { queue: q.id, state: 'active' }, value: q.active },
      ]),
    },
    {
      name: 'inkadra_queue_failed_24h',
      help: 'Jobs of the queue that failed in the last 24 hours.',
      values: queues.map((q) => ({ labels: { queue: q.id }, value: q.failed24h })),
    },
    {
      name: 'inkadra_data_disk_free_bytes',
      help: 'Free bytes on the disk of DATA_DIR (local storage only).',
      values: disk ? [{ value: disk.free }] : [],
    },
    {
      name: 'inkadra_data_disk_total_bytes',
      help: 'Size of the disk of DATA_DIR (local storage only).',
      values: disk ? [{ value: disk.total }] : [],
    },
    {
      name: 'inkadra_database_up',
      help: 'Whether the database answered.',
      values: [{ value: db.ok ? 1 : 0 }],
    },
    {
      name: 'inkadra_database_size_bytes',
      help: 'Size of the database on disk.',
      values: db.size === null ? [] : [{ value: db.size }],
    },
    {
      name: 'inkadra_database_connections',
      help: 'Open connections to the database.',
      values: db.connections === null ? [] : [{ value: db.connections }],
    },
    {
      name: 'inkadra_backup_last_success_timestamp_seconds',
      help: 'When the last ready backup finished, in Unix seconds.',
      values: backup ? [{ value: Math.floor(backup.getTime() / 1000) }] : [],
    },
    {
      name: 'inkadra_web_resident_memory_bytes',
      help: 'Resident memory of the web process answering.',
      values: [{ value: process.memoryUsage.rss() }],
    },
  ];
  if (loop) {
    metrics.push({
      name: 'inkadra_web_event_loop_delay_p99_seconds',
      help: '99th percentile of the event loop delay of the web process since the last scrape.',
      values: loop.count ? [{ value: loop.percentile(99) / 1e9 }] : [],
    });
    loop.reset();
  }
  return metrics;
}
