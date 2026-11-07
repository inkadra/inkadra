import { statfs } from 'node:fs/promises';
import { desc, gt, sql } from 'drizzle-orm';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { asset, instanceBackup } from '../db/schema.ts';
import { type AlertDeps, sendServerAlert } from './alerts.ts';
import { type Beat, DAY_MS, type StoredProblem } from './store.ts';

/** No signal for this long and a role is late; for twice as long, down. */
export const LATE_MS = 30_000;
export const DOWN_MS = 90_000;
/** A disk is almost full under 10 % or 5 GB free. */
const FULL_SHARE = 0.1;
const FULL_BYTES = 5e9;
/** An error that keeps happening: this many times within the hour. */
export const REPEATED = 5;

export function beatStatus(at: number, now: number): 'ok' | 'late' | 'down' {
  const age = now - at;
  return age > DOWN_MS ? 'down' : age > LATE_MS ? 'late' : 'ok';
}

/** The disk under DATA_DIR; null on S3, whose providers do not tell their total. */
export async function diskSpace(config: Config): Promise<{ total: number; free: number } | null> {
  if (config.STORAGE_DRIVER !== 'local') return null;
  try {
    const s = await statfs(config.DATA_DIR);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

/** Bytes of originals added in the last 30 days. */
export async function growthPerMonth(db: Database, now = Date.now()): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${asset.size}), 0)` })
    .from(asset)
    .where(gt(asset.createdAt, new Date(now - 30 * DAY_MS)));
  return Number(row?.bytes ?? 0);
}

/** The newest process of each role, or of the all-in-one process that plays it. */
export function lastBeat(beats: Beat[], role: 'web' | 'collab' | 'worker'): Beat | null {
  return (
    beats.filter((b) => b.role === role || b.role === 'all').sort((a, b) => b.at - a.at)[0] ?? null
  );
}

export interface HealthDeps extends AlertDeps {
  config: Config;
}

/**
 * Once a minute in the web role (one replica at a time): turns what went wrong into problems
 * and alerts (#514). A stopped collab or worker, a disk almost full and a failed backup are
 * serious; an error that keeps happening is not.
 */
export async function checkHealth(deps: HealthDeps, now = Date.now()) {
  const { store, db, config } = deps;
  if (!(await store.once('health', 50))) return;
  const problems = new Map((await store.problems()).map((p) => [p.id, p] as const));
  const beats = await store.beats();

  for (const role of ['collab', 'worker'] as const) {
    const beat = lastBeat(beats, role);
    // A role never seen this week is not part of this setup.
    if (!beat || beatStatus(beat.at, now) !== 'down') continue;
    const id = `service_down:${role}`;
    const known = problems.get(id);
    // One problem per outage: it started at the last signal.
    if (known && known.lastAt > beat.at) continue;
    await store.record({
      id,
      kind: 'service_down',
      severity: 'error',
      role,
      technical: `${role} · no heartbeat since ${new Date(beat.at).toISOString()} (${beat.host})`,
      assetId: null,
      service: role,
      job: null,
      at: now,
    });
    await sendServerAlert(
      deps,
      {
        kind: 'service_down',
        service: role,
        free: null,
        total: null,
        weeksLeft: null,
        count: null,
      },
      true,
    );
  }

  const disk = await diskSpace(config);
  if (disk && disk.total > 0 && (disk.free / disk.total < FULL_SHARE || disk.free < FULL_BYTES)) {
    const growth = await growthPerMonth(db, now);
    const weeksLeft = growth > 0 ? disk.free / (growth / (30 / 7)) : null;
    const known = problems.get('disk_full');
    if (!known || now - known.lastAt > DAY_MS)
      await store.record({
        id: 'disk_full',
        kind: 'disk_full',
        severity: 'error',
        role: 'web',
        technical: `${config.DATA_DIR} · ${Math.round(disk.free / 1e6)} MB free of ${Math.round(disk.total / 1e6)} MB`,
        assetId: null,
        service: null,
        job: null,
        at: now,
      });
    await sendServerAlert(
      deps,
      {
        kind: 'disk_full',
        service: null,
        free: Math.round(disk.free),
        total: Math.round(disk.total),
        weeksLeft,
        count: null,
      },
      true,
    );
  }

  const [backup] = await db
    .select()
    .from(instanceBackup)
    .orderBy(desc(instanceBackup.startedAt))
    .limit(1);
  if (backup?.status === 'failed' && backup.finishedAt) {
    const id = `backup_failed:${backup.id}`;
    if (!problems.has(id) && now - backup.finishedAt.getTime() < 7 * DAY_MS) {
      await store.record({
        id,
        kind: 'backup_failed',
        severity: 'error',
        role: 'worker',
        technical: `worker · maintenance · backup\n${backup.failure ?? 'failed'}`,
        assetId: null,
        service: null,
        job: null,
        at: backup.finishedAt.getTime(),
      });
      await sendServerAlert(
        deps,
        {
          kind: 'backup_failed',
          service: null,
          free: null,
          total: null,
          weeksLeft: null,
          count: null,
        },
        true,
      );
    }
  }

  for (const p of problems.values())
    if (repeating(p, now)) {
      const sent = await sendServerAlert(
        deps,
        {
          kind: 'repeated_errors',
          service: null,
          free: null,
          total: null,
          weeksLeft: null,
          count: p.count,
        },
        false,
      );
      if (sent) await store.update(p.id, { alertedAt: now });
    }
}

/** Errors that keep coming back, not states such as a full disk or a stopped service. */
export function repeating(p: StoredProblem, now: number): boolean {
  return (
    !['service_down', 'disk_full', 'backup_failed'].includes(p.kind) &&
    p.count >= REPEATED &&
    now - p.lastAt < 3_600_000 &&
    (p.alertedAt === null || now - p.alertedAt > 3_600_000)
  );
}
