import { statfs } from 'node:fs/promises';
import { count, desc, eq, gt, max, sql } from 'drizzle-orm';
import { readBackupSettings } from '../backup.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { asset, instanceBackup, notification } from '../db/schema.ts';
import { readLimits, reservedBytes } from '../storage-limits.ts';
import { type AlertDeps, sendServerAlert } from './alerts.ts';
import { type Beat, DAY_MS, lastHour, type StoredProblem } from './store.ts';

/** No signal for this long and a role is late; for twice as long, down. */
export const LATE_MS = 30_000;
export const DOWN_MS = 90_000;
/** A disk is almost full under 10 % or 5 GB free. */
const FULL_SHARE = 0.1;
const FULL_BYTES = 5e9;
/** An error that keeps happening: this many times within the hour. */
export const REPEATED = 5;
/** No ready backup for this long while nightly backups are on: two nights missed (#798). */
export const BACKUP_MISSING_MS = 2 * DAY_MS + 3_600_000;

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
    // Recorded, and told, once a day while it lasts: not at every check.
    if (!known || now - known.lastAt > DAY_MS) {
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
  }

  // The instance total past its warning share (decision 0081): at most once a day.
  const limits = await readLimits(db, config);
  if (limits.total !== null) {
    // The running total (#799), uploads still arriving included: no sum over every file.
    const bytes = await reservedBytes(db);
    if (
      bytes >= (limits.total * limits.warnPercent) / 100 &&
      (await store.once('storage-limit', DAY_MS / 1000))
    ) {
      const growth = await growthPerMonth(db, now);
      const free = Math.max(0, limits.total - bytes);
      await sendServerAlert(
        deps,
        {
          kind: 'storage_limit',
          service: null,
          free: Math.round(free),
          total: limits.total,
          weeksLeft: growth > 0 ? free / (growth / (30 / 7)) : null,
          count: null,
        },
        true,
      );
    }
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

  // The verification found files the backup lists but storage lacks (#794): the backup is
  // complete, a restore of it would not be. A warning on the Server page, no alert email.
  if (backup?.status === 'ready' && backup.missingFiles && backup.finishedAt) {
    const id = `backup_files_missing:${backup.id}`;
    if (!problems.has(id) && now - backup.finishedAt.getTime() < 7 * DAY_MS)
      await store.record({
        id,
        kind: 'backup_failed',
        severity: 'warning',
        role: 'worker',
        technical: `worker · maintenance · backup\n${backup.missingFiles} listed files missing from storage`,
        assetId: null,
        service: null,
        job: null,
        at: backup.finishedAt.getTime(),
      });
  }

  // Notification emails given up after every retry (#812): never sent, so a warning on the
  // Server page, one a day while it goes on.
  const [givenUp] = await db
    .select({ n: count(), last: max(notification.emailFailedAt) })
    .from(notification)
    .where(gt(notification.emailFailedAt, new Date(now - DAY_MS)));
  if (givenUp?.n && givenUp.last) {
    const id = `email_given_up:${new Date(now).toISOString().slice(0, 10)}`;
    if (!problems.has(id))
      await store.record({
        id,
        kind: 'email_failed',
        severity: 'warning',
        role: 'worker',
        technical: `worker · notifications\n${givenUp.n} notification emails given up after every retry`,
        assetId: null,
        service: null,
        job: null,
        at: new Date(givenUp.last).getTime(),
      });
  }

  // Schedulers live in Valkey: a flushed or evicted Valkey stops the nightly backup without a
  // failed row (#798). Two days without a ready one while backups are on is a failure too.
  // shortcut: an instance whose first backup never ran is not checked; fine while each install
  // runs its first backup the first night.
  if (config.REDIS_URL && (await readBackupSettings(db)).enabled) {
    const [ready] = await db
      .select({ id: instanceBackup.id, at: instanceBackup.startedAt })
      .from(instanceBackup)
      .where(eq(instanceBackup.status, 'ready'))
      .orderBy(desc(instanceBackup.startedAt))
      .limit(1);
    const [first] = ready
      ? [ready]
      : await db
          .select({ id: instanceBackup.id, at: instanceBackup.startedAt })
          .from(instanceBackup)
          .orderBy(instanceBackup.startedAt)
          .limit(1);
    const id = `backup_missing:${first?.id}`;
    if (first && now - first.at.getTime() > BACKUP_MISSING_MS && !problems.has(id)) {
      await store.record({
        id,
        kind: 'backup_failed',
        severity: 'error',
        role: 'worker',
        technical: `worker · maintenance · backup\nno backup since ${first.at.toISOString()}`,
        assetId: null,
        service: null,
        job: null,
        at: now,
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
          count: lastHour(p, now),
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
    lastHour(p, now) >= REPEATED &&
    (p.alertedAt === null || now - p.alertedAt > 3_600_000)
  );
}
