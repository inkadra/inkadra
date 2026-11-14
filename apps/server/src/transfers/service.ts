import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { EXPORT_TTL_HOURS, type ProjectTransfer } from '@inkadra/shared';
import { and, eq, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { atLeast, projectRole } from '../access.ts';
import type { Database } from '../db/client.ts';
import { asset, notification, projectTransfer } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import type { Storage } from '../storage.ts';
import type { StorageEnv } from '../storage-limits.ts';
import { exportProject } from './export.ts';
import { importProject } from './import.ts';
import { ArchiveError } from './zip.ts';

export type TransferRow = typeof projectTransfer.$inferSelect;

export interface TransferDeps {
  db: Database;
  storage: Storage;
  jobs: Pick<Jobs, 'processAsset'>;
  dataDir: string;
  uploadMaxSize: number;
  importMaxSize: number;
  storageEnv?: StorageEnv;
  log: Logger;
}

/** Archives of exports and uploaded imports, shared by the web and worker roles. */
export const transfersDir = (dataDir: string) => join(dataDir, 'transfers');
export const transferFile = (dataDir: string, id: string) =>
  join(transfersDir(dataDir), `${id}.zip`);

/** Rows are listed for a week; queued or running ones untouched this long were interrupted. */
const LIST_DAYS = 7;
export const STALLED_MS = 15 * 60 * 1000;
/** A running transfer touches its row at least this often, even inside one large file. */
const HEARTBEAT_MS = 60 * 1000;
/**
 * A running transfer is taken over by a job delivered again only once its heartbeat stopped
 * (#810): BullMQ redelivers a job whose lock lapsed even when its first run is still alive.
 */
const TAKEOVER_MS = 2 * HEARTBEAT_MS;

export function toTransfer(row: TransferRow): ProjectTransfer {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: Math.min(1, Math.max(0, row.progress / 1000)),
    projectId: row.projectId,
    projectName: row.projectName,
    size: row.size,
    failure: row.failure,
    summary: row.summary ?? null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

/** The transfer was removed while it ran. */
class Cancelled extends Error {}

/** Exporters must still be owner or editor of the project (decision 0037). */
export async function canExport(db: Database, userId: string, projectId: string) {
  const role = await projectRole(db, { id: userId }, projectId);
  return role !== null && atLeast(role, 'editor');
}

/**
 * Runs one queued transfer to its end. Safe to call twice: only a queued row (or a running
 * one whose worker stopped beating, after a restart) is picked up, and the row is the only
 * source of truth. Each claim sets a new run id: a run that lost its row never moves it again.
 */
export async function runTransfer(deps: TransferDeps, id: string): Promise<void> {
  const { db, log } = deps;
  const runId = randomUUID();
  const [row] = await db
    .update(projectTransfer)
    .set({ status: 'running', progress: 0, runId })
    .where(
      and(
        eq(projectTransfer.id, id),
        or(
          eq(projectTransfer.status, 'queued'),
          and(
            eq(projectTransfer.status, 'running'),
            // The database's clock, not this host's: workers on other hosts may drift.
            lt(
              projectTransfer.updatedAt,
              sql`now() - make_interval(secs => ${TAKEOVER_MS / 1000})`,
            ),
          ),
        ),
      ),
    )
    .returning();
  if (!row) return;
  const ours = and(
    eq(projectTransfer.id, id),
    eq(projectTransfer.status, 'running'),
    eq(projectTransfer.runId, runId),
  );
  const file = transferFile(deps.dataDir, id);
  // An export is written aside and moved in place once whole: two runs never share a file.
  const partial = `${file}.${runId}.partial`;
  let last = 0;
  let lastAt = 0;
  // Only a row still ours moves: one deleted, cancelled or taken over meanwhile stops the work.
  const touch = async (value: number) => {
    const updated = await db
      .update(projectTransfer)
      .set({ progress: value, updatedAt: sql`now()` })
      .where(ours)
      .returning({ id: projectTransfer.id });
    return updated.length > 0;
  };
  let cancelled = false;
  const progress = async (share: number) => {
    if (cancelled) throw new Cancelled();
    const value = Math.round(share * 1000);
    if (value - last < 5 && Date.now() - lastAt < 5000) return;
    last = value;
    lastAt = Date.now();
    if (!(await touch(value))) throw new Cancelled();
  };
  const heartbeat = setInterval(() => {
    touch(last)
      .then((alive) => {
        if (!alive) cancelled = true;
      })
      .catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat.unref();
  try {
    if (row.kind === 'export') {
      if (!row.projectId || !(await canExport(db, row.userId, row.projectId)))
        throw new ArchiveError('invalid_archive', 'gone');
      await mkdir(transfersDir(deps.dataDir), { recursive: true, mode: 0o700 });
      const result = await exportProject(deps, row.projectId, partial, progress);
      if (!(await touch(1000))) throw new Cancelled();
      await rename(partial, file);
      const done = await finish(db, ours, {
        size: result.size,
        summary: result.summary,
        expiresAt: new Date(Date.now() + EXPORT_TTL_HOURS * 3600 * 1000),
      });
      if (!done) throw new Cancelled();
      await notify(db, row.userId, 'export_ready', row.projectId);
    } else {
      // Checked again inside the import's transaction, with the row locked: a run that lost its
      // row while reading the archive must not create a second project.
      const result = await importProject(deps, file, row.userId, progress, async (tx) => {
        const [mine] = await tx
          .select({ id: projectTransfer.id })
          .from(projectTransfer)
          .where(ours)
          .for('update');
        if (!mine) throw new Cancelled();
      });
      await rm(file, { force: true });
      const done = await finish(db, ours, {
        projectId: result.projectId,
        projectName: result.projectName,
        summary: result.summary,
        size: null,
      });
      if (done) await notify(db, row.userId, 'import_ready', result.projectId);
    }
  } catch (err) {
    await rm(partial, { force: true });
    const [now] = await db
      .select({ status: projectTransfer.status, runId: projectTransfer.runId })
      .from(projectTransfer)
      .where(eq(projectTransfer.id, id));
    // Taken over by another run: the file is that run's now.
    if (now?.status === 'running' && now.runId !== runId) return;
    await rm(file, { force: true });
    if (err instanceof Cancelled) return;
    // Cancelled or removed while a file was being read (a demo sandbox ending, decision 0084):
    // its files may be gone already, which is no failure to report.
    if (now?.status !== 'running') return;
    const failure =
      err instanceof ArchiveError
        ? err.message === 'gone'
          ? 'gone'
          : err.reason
        : (err as NodeJS.ErrnoException)?.code === 'ENOSPC'
          ? 'storage'
          : 'internal';
    if (failure === 'internal') log.error({ err, transfer: id }, 'transfer failed');
    else log.info({ transfer: id, failure, reason: (err as Error).message }, 'transfer refused');
    await db
      .update(projectTransfer)
      .set({ status: 'failed', failure, finishedAt: new Date() })
      .where(ours);
  } finally {
    clearInterval(heartbeat);
  }
}

async function finish(
  db: Database,
  ours: SQL | undefined,
  values: Partial<typeof projectTransfer.$inferInsert>,
): Promise<boolean> {
  const rows = await db
    .update(projectTransfer)
    .set({ ...values, status: 'ready', progress: 1000, finishedAt: new Date() })
    .where(ours)
    .returning({ id: projectTransfer.id });
  return rows.length > 0;
}

/** In-app only: emailedAt is set so the mail jobs never pick them up. */
async function notify(
  db: Database,
  userId: string,
  type: 'export_ready' | 'import_ready',
  projectId: string,
) {
  const now = new Date();
  await db.insert(notification).values({ userId, type, projectId, emailedAt: now });
}

/**
 * Hourly: removes expired exports, rows older than a week, transfers stalled by a crash and
 * archives no row points to any more.
 */
export async function sweepTransfers(
  deps: Pick<TransferDeps, 'db' | 'dataDir'> & { jobs?: Pick<Jobs, 'processAsset'> },
) {
  const { db, dataDir } = deps;
  const now = Date.now();
  // Files whose thumbnail job could not be queued (an import that finished while the queue
  // was down): queue them again. A job still known to the queue makes this a no-op.
  let requeued = 0;
  if (deps.jobs) {
    const stuck = await db
      .select({ id: asset.id })
      .from(asset)
      .where(and(eq(asset.status, 'processing'), lt(asset.createdAt, new Date(now - STALLED_MS))))
      .limit(1000);
    for (const row of stuck) {
      await deps.jobs.processAsset(row.id);
      requeued += 1;
    }
  }
  const stale = await db
    .delete(projectTransfer)
    .where(
      or(
        lt(projectTransfer.expiresAt, new Date(now)),
        lt(projectTransfer.createdAt, new Date(now - LIST_DAYS * 86400 * 1000)),
      ),
    )
    .returning({ id: projectTransfer.id });
  await db
    .update(projectTransfer)
    .set({ status: 'failed', failure: 'interrupted', finishedAt: new Date() })
    .where(
      and(
        inArray(projectTransfer.status, ['queued', 'running']),
        lt(projectTransfer.updatedAt, new Date(now - STALLED_MS)),
      ),
    );
  const live = new Set(
    (
      await db
        .select({ id: projectTransfer.id })
        .from(projectTransfer)
        .where(
          or(
            inArray(projectTransfer.status, ['queued', 'running']),
            and(eq(projectTransfer.kind, 'export'), eq(projectTransfer.status, 'ready')),
          ),
        )
    ).map((r) => `${r.id}.zip`),
  );
  let removed = 0;
  const dir = transfersDir(dataDir);
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    // An export still being written sits next to its archive as `<id>.zip.<run>.partial`.
    if (live.has(name) || live.has(`${name.split('.')[0]}.zip`)) continue;
    const path = join(dir, name);
    // Uploads still being received have no row yet: leave fresh files alone.
    const info = await stat(path).catch(() => null);
    if (info && now - info.mtimeMs < 60 * 60 * 1000) continue;
    await rm(path, { force: true, recursive: true });
    removed += 1;
  }
  return { rows: stale.length, files: removed, requeued };
}
