import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_REBUILT_TABLES,
  BackupManifest,
  type BackupSettings,
  DEFAULT_BACKUP_SETTINGS,
  type InstanceBackup,
  BackupSettings as Settings,
} from '@inkadra/shared';
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import postgres from 'postgres';
import { recordAudit } from './audit.ts';
import { type Config, STORAGE_PREFIXES, VERSION } from './config.ts';
import { createDatabase, type Database, runMigrations, UNLIMITED_SESSION } from './db/client.ts';
import { instanceBackup, instanceSetting } from './db/schema.ts';
import { createStorage, type Storage } from './storage.ts';
import { REBUILD_STORAGE_TOTALS, STORAGE_TOTAL_TABLES } from './storage-limits.ts';
import {
  ArchiveError,
  piped,
  readZip,
  writeZip,
  type ZipReader,
  type ZipWriter,
} from './transfers/zip.ts';

/**
 * Instance backups (decision 0037): a logical dump of every table of the `public` schema with
 * `COPY`, taken in one read-only snapshot, plus a manifest of stored files. No pg_dump needed.
 */
export const backupsDir = (dataDir: string) => join(dataDir, 'backups');
export const BUCKET_PREFIX = 'backups/';

/** The folder of the archives: BACKUP_DIR, or `DATA_DIR/backups` (#899). */
export const backupDirOf = (config: Pick<Config, 'BACKUP_DIR' | 'DATA_DIR'>) =>
  config.BACKUP_DIR ?? backupsDir(config.DATA_DIR);

/** Where archives are copied once written and verified: `prefix` + file name in `storage`. */
export interface BackupRemote {
  storage: Storage;
  prefix: string;
  /** `s3://bucket/prefix`, for administrators; never the keys. */
  label: string;
}

/**
 * The bucket of BACKUP_S3_* when set, whatever STORAGE_DRIVER is (#899), otherwise `backups/` of
 * the files bucket when files live in S3, otherwise none. Same S3 client code as the files.
 */
export function backupRemote(config: Config): BackupRemote | null {
  const label = backupRemoteLabel(config);
  if (!label) return null;
  if (config.BACKUP_S3_BUCKET)
    return {
      storage: createStorage({
        ...config,
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: config.BACKUP_S3_ENDPOINT,
        S3_REGION: config.BACKUP_S3_REGION,
        S3_BUCKET: config.BACKUP_S3_BUCKET,
        S3_ACCESS_KEY_ID: config.BACKUP_S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: config.BACKUP_S3_SECRET_ACCESS_KEY,
        S3_FORCE_PATH_STYLE: config.BACKUP_S3_FORCE_PATH_STYLE,
        S3_PUBLIC_REDIRECT: false,
        S3_PUBLIC_ENDPOINT: undefined,
      }),
      prefix: config.BACKUP_S3_PREFIX,
      label,
    };
  return { storage: createStorage(config), prefix: BUCKET_PREFIX, label };
}

/** `s3://bucket/prefix/` of `backupRemote`, without making a client. */
export function backupRemoteLabel(
  config: Pick<Config, 'BACKUP_S3_BUCKET' | 'BACKUP_S3_PREFIX' | 'STORAGE_DRIVER' | 'S3_BUCKET'>,
) {
  if (config.BACKUP_S3_BUCKET) return `s3://${config.BACKUP_S3_BUCKET}/${config.BACKUP_S3_PREFIX}`;
  if (config.STORAGE_DRIVER === 's3') return `s3://${config.S3_BUCKET}/${BUCKET_PREFIX}`;
  return null;
}

/**
 * Checked at start (#899): the folder exists (made if needed, readable by the server's user
 * only) and a file can be written in it. A folder that cannot be written stops the start with
 * its path, instead of every backup failing later as `permission`.
 */
export async function checkBackupDir(dir: string) {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const probe = join(dir, `.write-check-${randomUUID()}.partial`);
    await writeFile(probe, '');
    await rm(probe, { force: true });
  } catch (err) {
    throw new Error(
      `The backup folder ${dir} cannot be written (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}). ` +
        'Fix its owner or mount, or set BACKUP_DIR to another folder: see ' +
        'https://github.com/inkadra/inkadra/blob/main/docs/self-hosting/README.md#backups',
      { cause: err },
    );
  }
}

/**
 * Left out of every backup: the feature's own bookkeeping (a restored running row would block
 * later backups; transfer archives are not in it) and derived tables a restore rebuilds.
 */
const SKIPPED_TABLES = new Set<string>([
  'instance_backup',
  'project_transfer',
  // The rungs of video ladders (decision 0128) are made again with "Rigenera", like proxies.
  'asset_rendition',
  // Copies of deleted files parked for one statement (migration 0052): empty between them.
  'storage_total_gone',
  ...BACKUP_REBUILT_TABLES,
]);
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** A dump with no data moving for this long has stalled and fails (`stalled`). */
export const STALL_MS = 5 * 60 * 1000;
/** Rows the backup cannot write in an order a restore can load (a cycle of parents). */
class BackupInconsistent extends Error {}
/** The archive did not read back as it was written (#794). */
class BackupCorrupt extends Error {}
/**
 * The verification of a backup stops after this (#794): the backup is then kept with its
 * verification `incomplete`, never left running and blocking the next one.
 */
export const VERIFY_BUDGET_MS = 30 * 60 * 1000;
/**
 * Files of a backup with media are read back at least this fast (bytes a millisecond, about
 * 25 MiB/s): their part of the verification gets `VERIFY_BUDGET_MS` plus the time this rate
 * needs for `media.bytes`, apart from the tables and the file list (#899).
 */
/**
 * The most files a backup with media holds (#899): the entries a restore reads
 * (`ARCHIVE_LIMITS`), less room for the tables. More fails the backup before it writes.
 */
export const MEDIA_FILES_MAX = 499_000;
export const MEDIA_VERIFY_BYTES_PER_MS = (25 * 1024 * 1024) / 1000;
/** Above this many listed files, the verification looks up an even sample of this size. */
export const VERIFY_SAMPLE = 20_000;
/** Storage lookups the verification has in flight at once. */
const VERIFY_CONCURRENCY = 8;

class BackupStalled extends Error {
  constructor() {
    super('The backup made no progress and was stopped.');
  }
}

/** A running backup moves its heartbeat this often; one silent for STALE_MS was interrupted. */
const HEARTBEAT_MS = 10 * 1000;
/**
 * A job delivered again takes over a claimed backup only once its heartbeat stopped this long
 * (#810): BullMQ redelivers a job whose lock lapsed even when its first run is still alive.
 */
const TAKEOVER_MS = 6 * HEARTBEAT_MS;
export const STALE_MS = 15 * 60 * 1000;
/**
 * A worker that starts reaps running backups whose heartbeat is this old. A live process
 * beats every HEARTBEAT_MS whatever its backup is doing, so only rows of a process that is
 * gone (six missed beats) are taken, never one another worker is still running.
 */
export const STARTUP_STALE_MS = 60 * 1000;

/**
 * Tables that reference themselves, with the order that writes parents first, so a plain
 * `COPY … FROM` restores them (foreign keys are not deferrable). A new self-reference fails
 * the backup until it is listed here.
 */
const PARENTS_FIRST: Record<string, (columns: string[]) => string> = {
  board: (columns) =>
    `with recursive d(id, depth) as (
       select id, 0 from board where parent_board_id is null
       union all select b.id, d.depth + 1 from board b join d on b.parent_board_id = d.id)
     select ${columns.map((c) => `board."${c}"`).join(', ')} from board join d using (id)
     order by d.depth, board.id`,
  // By depth too: older data may hold replies to replies, which a plain "starts first"
  // order would write before the reply they point to.
  comment: (columns) =>
    `with recursive d(id, depth) as (
       select id, 0 from comment where thread_id is null
       union all select c.id, d.depth + 1 from comment c join d on c.thread_id = d.id)
     select ${columns.map((c) => `comment."${c}"`).join(', ')} from comment join d using (id)
     order by d.depth, comment.id`,
};

/**
 * Rows written differently from the table, for files a backup leaves out because they can be
 * made again: the playable copies of videos (decision 0048), as large as the videos
 * themselves. Their `proxy` variant rows are skipped, and the assets that had one restore as
 * `skipped`: the card falls back to the poster and the original until it is processed again.
 */
const WITHOUT_DERIVED: Record<string, (columns: string[]) => string> = {
  asset_variant: (columns) =>
    `select ${columns.map((c) => `"${c}"`).join(', ')} from asset_variant where size <> 'proxy'`,
  asset: (columns) =>
    `select ${columns
      .map((c) =>
        c === 'proxy_status'
          ? `case when proxy_status in ('queued', 'processing', 'ready') then 'skipped' else proxy_status end`
          : c === 'proxy_progress'
            ? 'null::integer'
            : `"${c}"`,
      )
      .join(', ')} from asset`,
};

export type BackupRow = typeof instanceBackup.$inferSelect;

export function toBackup(row: BackupRow): InstanceBackup {
  return {
    id: row.id,
    // Older clients know two triggers: a backup before an upgrade is the server's own.
    trigger: row.trigger === 'pre-upgrade' ? 'scheduled' : row.trigger,
    ...(row.trigger === 'pre-upgrade' ? { beforeUpgrade: true } : {}),
    status: row.status,
    fileName: row.removedAt ? null : row.fileName,
    size: row.size,
    copiedToBucket: row.copiedToBucket,
    files: row.fileCount === null ? null : { count: row.fileCount, bytes: row.fileBytes ?? 0 },
    media: row.mediaCount === null ? null : { count: row.mediaCount, bytes: row.mediaBytes ?? 0 },
    failure: row.failure,
    verification: row.verifiedAt
      ? {
          at: row.verifiedAt.toISOString(),
          missingFiles: row.missingFiles ?? 0,
          checkedFiles: row.checkedFiles ?? row.fileCount ?? 0,
          unverifiedFiles: row.unverifiedFiles ?? 0,
          complete: row.verifyComplete ?? true,
        }
      : null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function readBackupSettings(db: Pick<Database, 'select'>): Promise<BackupSettings> {
  const [row] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, 'backup'));
  const parsed = Settings.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_BACKUP_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

/** BullMQ cron pattern of the nightly backup. */
export function backupCron(settings: BackupSettings): string {
  const [h, m] = settings.time.split(':').map(Number);
  return `${m} ${h} * * *`;
}

/** The next start after `from`, in the server's local time zone. */
export function nextBackupAt(settings: BackupSettings, from = new Date()): Date | null {
  if (!settings.enabled) return null;
  const [h = 0, m = 0] = settings.time.split(':').map(Number);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}

export const serverTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

interface Journal {
  entries: Array<{ tag: string; when: number }>;
}
async function readJournal(migrationsFolder: string): Promise<Journal> {
  return JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
}

function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export interface BackupDeps {
  db: Database;
  /** The dump opens its own connection. */
  databaseUrl: string;
  /** Tests: how long a dump may stand still before it fails as `stalled`. */
  stallMs?: number;
  /** Tests: how often the heartbeat beats. */
  heartbeatMs?: number;
  /** Tests: the most files of a backup with media (`MEDIA_FILES_MAX`). */
  mediaFilesMax?: number;
  /** Tests: the time the verification of tables and file list may take (`VERIFY_BUDGET_MS`). */
  verifyBudgetMs?: number;
  storage: Storage;
  /** BACKUP_DIR or `DATA_DIR/backups` (#899). */
  backupDir: string;
  migrationsFolder: string;
  /** Where the archive is copied once verified (`backupRemote`), or null. */
  remote: BackupRemote | null;
  log: Logger;
}

/** Marks running backups whose heartbeat stopped (a crash or restart) as interrupted. */
export async function reapStaleBackups(db: Database, olderThanMs = STALE_MS) {
  const rows = await db
    .update(instanceBackup)
    .set({ status: 'failed', failure: 'interrupted', finishedAt: new Date() })
    .where(
      and(
        eq(instanceBackup.status, 'running'),
        lt(instanceBackup.heartbeatAt, new Date(Date.now() - olderThanMs)),
      ),
    )
    .returning({ id: instanceBackup.id });
  return rows.length;
}

/** Starts a backup row, unless one is running (the partial unique index decides). */
export async function startBackup(
  db: Database,
  trigger: 'scheduled' | 'manual',
  requestedBy: string | null,
): Promise<BackupRow | null> {
  await reapStaleBackups(db);
  const rows = await db
    .insert(instanceBackup)
    .values({ trigger, requestedBy })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

/** Writes the archive of `row` and applies retention. Never throws: failures go in the row. */
export async function runBackup(deps: BackupDeps, id: string): Promise<BackupRow | null> {
  const { db, log } = deps;
  const dir = deps.backupDir;
  // The id keeps two backups of the same second apart.
  const fileName = `inkadra-backup-${stamp(new Date())}-${id.slice(0, 8)}.zip`;
  const partial = join(dir, `${fileName}.partial`);
  // Set by the claim below: only this run moves or finishes the row from then on.
  const runId = randomUUID();
  const ours = and(
    eq(instanceBackup.id, id),
    eq(instanceBackup.status, 'running'),
    eq(instanceBackup.runId, runId),
  );
  // Two clocks. The heartbeat says this process is alive: it beats on a timer for the whole
  // run (rename and bucket copy included), so a worker that starts elsewhere never takes a
  // live backup for a dead one. Stall detection watches the dump only: when no data moved
  // for `stallMs` and its connection is not working on a query either, the dump is stuck.
  let movedAt = Date.now();
  let dumping = false;
  // The verification has its own stop: a stall or the time budget ends it as incomplete.
  let verifying = false;
  const verifyStop = new AbortController();
  let dumpPid: number | null = null;
  const stall = new AbortController();
  const stallMs = deps.stallMs ?? STALL_MS;
  const stalled = new Promise<never>((_, reject) =>
    stall.signal.addEventListener('abort', () => reject(new BackupStalled()), { once: true }),
  );
  stalled.catch(() => {});
  const watch = async () => {
    if (verifying && Date.now() - movedAt > stallMs && !verifyStop.signal.aborted) {
      log.warn({ backup: id, stalledFor: Date.now() - movedAt }, 'backup verification stalled');
      verifyStop.abort();
      return;
    }
    if (!dumping || stall.signal.aborted || Date.now() - movedAt <= stallMs) return;
    // Quiet is fine while Postgres works on the dump's query (sorting a large table for a
    // parents-first COPY, counting rows); waiting on a lock or on us reading is not.
    if (dumpPid !== null) {
      const [activity] = await db.execute<{ state: string | null; wait: string | null }>(
        sql`select state, wait_event_type as wait from pg_stat_activity where pid = ${dumpPid}`,
      );
      if (activity?.state === 'active' && activity.wait !== 'Lock' && activity.wait !== 'Client') {
        movedAt = Date.now();
        return;
      }
    }
    if (!dumping || stall.signal.aborted) return;
    log.error({ backup: id, stalledFor: Date.now() - movedAt }, 'backup stalled, giving up');
    stall.abort();
  };
  const heartbeat = setInterval(
    () => {
      db.update(instanceBackup)
        .set({ heartbeatAt: sql`now()` })
        .where(ours)
        .catch(() => {});
      watch().catch(() => {});
    },
    deps.heartbeatMs ?? Math.min(HEARTBEAT_MS, Math.max(50, stallMs / 4)),
  );
  heartbeat.unref();
  try {
    // A job can run again after its worker died (BullMQ moves it back to the queue): only a
    // row still running is worked on, never one already marked failed or done, nor one another
    // run still beats for.
    const [claimed] = await db
      .update(instanceBackup)
      .set({ runId, heartbeatAt: sql`now()` })
      .where(
        and(
          eq(instanceBackup.id, id),
          eq(instanceBackup.status, 'running'),
          or(
            // Never beaten: created and not claimed yet (a run of an older version beats too).
            and(
              isNull(instanceBackup.runId),
              eq(instanceBackup.heartbeatAt, instanceBackup.startedAt),
            ),
            // The database's clock, not this host's: workers on other hosts may drift.
            lt(
              instanceBackup.heartbeatAt,
              sql`now() - make_interval(secs => ${TAKEOVER_MS / 1000})`,
            ),
          ),
        ),
      )
      .returning({ id: instanceBackup.id });
    if (!claimed) {
      log.warn({ backup: id }, 'backup not running or run elsewhere, skipped');
      return null;
    }
    log.info({ backup: id, fileName }, 'backup started');
    // Backups hold password hashes and sessions: readable by the server's user only.
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => {});
    dumping = true;
    const { includeMedia } = await readBackupSettings(db);
    const dump = dumpDatabase(deps, partial, {
      moved: () => {
        movedAt = Date.now();
      },
      connected: (pid) => {
        dumpPid = pid;
      },
      signal: stall.signal,
      ...(includeMedia ? { media: deps.storage, log } : {}),
    });
    // After a stall the dump may still fail on its own: that is already handled.
    dump.catch(() => {});
    const result = await Promise.race([dump, stalled]).finally(() => {
      dumping = false;
    });
    // Read the archive back before it counts (#794): every table counted and hashed against
    // the manifest, the listed files looked up in storage, the files of the archive hashed.
    // Watched for stalls and bounded in time, each part on its own budget (#899): past either
    // it stops as incomplete and the backup is kept.
    movedAt = Date.now();
    verifying = true;
    const verified = await verifyBackup(partial, deps.storage, {
      signal: verifyStop.signal,
      budgetMs: deps.verifyBudgetMs ?? VERIFY_BUDGET_MS,
      moved: () => {
        movedAt = Date.now();
      },
    }).finally(() => {
      verifying = false;
    });
    if (!verified.complete)
      log.warn({ backup: id, parts: verified.parts }, 'backup verification incomplete');
    if (verified.missing.count > 0 || verified.unverified > 0)
      log.warn(
        {
          backup: id,
          missing: verified.missing.count,
          unverified: verified.unverified,
          examples: verified.missing.examples,
        },
        'backup lists files that storage does not have',
      );
    await rename(partial, join(dir, fileName));
    // The archive on the data volume is a complete backup on its own: a failed copy to the
    // bucket keeps it, reported as not copied (`copiedToBucket: false`) and logged.
    const copied = await copyToBucket(deps, id, fileName);
    // Only a backup still running becomes ready: never one another process marked over.
    const [row] = await db
      .update(instanceBackup)
      .set({
        status: 'ready',
        fileName,
        size: result.size,
        copiedToBucket: copied,
        fileCount: result.files.count,
        fileBytes: result.files.bytes,
        mediaCount: result.media?.count ?? null,
        mediaBytes: result.media?.bytes ?? null,
        verifiedAt: new Date(),
        missingFiles: verified.missing.count,
        checkedFiles: verified.checked,
        unverifiedFiles: verified.unverified,
        verifyComplete: verified.complete,
        finishedAt: new Date(),
      })
      .where(ours)
      .returning();
    if (!row) {
      // No row will ever point to this archive: retention would never remove it.
      log.warn({ backup: id, fileName }, 'backup written after it was marked over: removed');
      await rm(join(dir, fileName), { force: true });
      if (copied) await removeBucketCopy(deps, fileName);
    } else log.info({ backup: id, fileName, size: result.size }, 'backup written');
    await applyBackupRetention(deps);
    return row ?? null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const failure =
      err instanceof BackupStalled
        ? 'stalled'
        : err instanceof BackupInconsistent
          ? 'inconsistent'
          : err instanceof BackupCorrupt || err instanceof ArchiveError
            ? 'corrupt'
            : code === 'ENOSPC'
              ? 'no_space'
              : code === 'EACCES' || code === 'EPERM'
                ? 'permission'
                : 'internal';
    log.error({ err, backup: id, failure }, 'backup failed');
    await rm(partial, { force: true }).catch(() => {});
    const [row] = await db
      .update(instanceBackup)
      .set({ status: 'failed', failure, finishedAt: new Date() })
      .where(ours)
      .returning();
    return row ?? null;
  } finally {
    clearInterval(heartbeat);
  }
}

/** Copies a written, verified archive to the remote bucket, if any; false when it failed. */
async function copyToBucket(
  deps: Pick<BackupDeps, 'remote' | 'backupDir' | 'log'>,
  id: string,
  fileName: string,
) {
  if (!deps.remote) return false;
  try {
    await deps.remote.storage.writeStream(
      `${deps.remote.prefix}${fileName}`,
      createReadStream(join(deps.backupDir, fileName)),
      'application/zip',
    );
    return true;
  } catch (err) {
    deps.log.error(
      { err, backup: id, fileName, remote: deps.remote.label },
      'backup kept in the backup folder, bucket copy failed',
    );
    return false;
  }
}

/**
 * Removes the bucket copy of `fileName`. A failure leaves it there and says so, with its key
 * and the error message (never the request, which carries the credentials' signature).
 */
async function removeBucketCopy(deps: Pick<BackupDeps, 'remote' | 'log'>, fileName: string) {
  if (!deps.remote) return;
  const key = `${deps.remote.prefix}${fileName}`;
  await deps.remote.storage
    .remove([key])
    .catch((err) =>
      deps.log.warn(
        { key, error: err instanceof Error ? err.message : String(err) },
        'backup copy in the bucket not removed',
      ),
    );
}

/** Backups taken before an upgrade (#805) kept, apart from the nightly `retention`. */
export const PRE_UPGRADE_KEEP = 2;

/**
 * Keeps the newest `retention` successful backups, and the newest `PRE_UPGRADE_KEEP` taken
 * before an upgrade; removes older archives and old rows.
 */
export async function applyBackupRetention(
  deps: Pick<BackupDeps, 'db' | 'remote' | 'backupDir' | 'log'>,
) {
  const { db } = deps;
  const { retention } = await readBackupSettings(db);
  const kept = await db
    .select()
    .from(instanceBackup)
    .where(and(eq(instanceBackup.status, 'ready'), isNull(instanceBackup.removedAt)))
    .orderBy(desc(instanceBackup.startedAt));
  const old = [
    ...kept.filter((r) => r.trigger !== 'pre-upgrade').slice(retention),
    ...kept.filter((r) => r.trigger === 'pre-upgrade').slice(PRE_UPGRADE_KEEP),
  ];
  for (const row of old) {
    if (row.fileName) {
      await rm(join(deps.backupDir, row.fileName), { force: true });
      // shortcut: the copy is removed from the bucket configured now; after BACKUP_S3_* changed,
      // copies in the earlier bucket stay there (documented).
      if (row.copiedToBucket) await removeBucketCopy(deps, row.fileName);
    }
  }
  if (old.length)
    await db
      .update(instanceBackup)
      .set({ removedAt: new Date() })
      .where(
        inArray(
          instanceBackup.id,
          old.map((r) => r.id),
        ),
      );
  await reapStaleBackups(db);
  // Rows of archives still kept stay, however old: without them nothing would remove the file.
  await db
    .delete(instanceBackup)
    .where(
      and(
        lt(instanceBackup.startedAt, new Date(Date.now() - 180 * 86400 * 1000)),
        or(ne(instanceBackup.status, 'ready'), isNotNull(instanceBackup.removedAt)),
      ),
    );
  return { removed: old.length };
}

// Before an upgrade ------------------------------------------------------------

/**
 * Free space a backup of `tableBytes` of live table data needs, as far as start-up can tell:
 * the archive is COPY text compressed, mostly well under half the tables, plus a margin.
 * shortcut: an estimate, not the size; a database of incompressible data may still fill the
 * disk (the backup then fails as no_space and nothing is migrated).
 */
export function preUpgradeSpaceNeeded(tableBytes: number) {
  return Math.ceil(tableBytes / 2) + 64 * 1024 * 1024;
}

/**
 * Bytes of live rows in the `public` tables: each table's size (with TOAST) scaled by its
 * share of live tuples, so dead rows and bloat a vacuum has not reclaimed do not count.
 * Tables without statistics yet count whole.
 */
export async function liveTableBytes(sql: postgres.Sql) {
  const [row] = await sql<{ n: string }[]>`
    select coalesce(sum(
      case when coalesce(t.n_live_tup, 0) + coalesce(t.n_dead_tup, 0) = 0
        then pg_table_size(c.oid)
        else pg_table_size(c.oid)::numeric * t.n_live_tup / (t.n_live_tup + t.n_dead_tup) end
    ), 0)::bigint::text as n
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
    left join pg_stat_user_tables t on t.relid = c.oid
    where s.nspname = 'public' and c.relkind = 'r'`;
  return Number(row?.n ?? 0);
}

const mib = (n: number) => `${Math.round(n / 1024 / 1024)} MiB`;

const PRE_UPGRADE = 'inkadra-backup-pre-upgrade-';
/**
 * Archives of one schema state of one database: `m<applied migrations>-<database>-`, then the
 * time and id. The database part keeps another database (a restore, a swapped volume) from
 * having its state mistaken for this one's.
 */
const preUpgradePrefix = (applied: number, database: string) =>
  `${PRE_UPGRADE}m${applied}-${database}-`;

/**
 * Short id of this database: its cluster `system_identifier` and name. Where the role may not
 * call `pg_control_system()` (some managed services), the oldest migration's time stands in
 * for the cluster: the same name and first migration on another cluster is not told apart.
 */
async function databaseFingerprint(sql: postgres.Sql) {
  let ident: string;
  try {
    const [row] = await sql<{ id: string }[]>`
      select system_identifier::text || '/' || current_database() as id from pg_control_system()`;
    ident = row?.id ?? '';
  } catch {
    const [row] = await sql<{ id: string }[]>`
      select current_database() || '/' || coalesce(min(created_at)::text, '') as id
      from drizzle.__drizzle_migrations`;
    ident = row?.id ?? '';
  }
  return createHash('sha256').update(ident).digest('hex').slice(0, 8);
}
/**
 * A start that finds an archive this recent for the same schema state reuses it instead of
 * writing another (#805): a migration that fails restarts the server in a loop, and each start
 * would otherwise fill the disk with a new copy of the same database.
 * shortcut: the database is assumed unchanged since; an older version run on it in between and
 * a retry within this window keeps the earlier copy (logged with its time).
 */
export const PRE_UPGRADE_REUSE_MS = 30 * 60 * 1000;
/**
 * The verification of a backup before an upgrade: every table read back, and storage asked for
 * an even sample of this many files only, within PRE_UPGRADE_VERIFY_MS. It is the way back for
 * the database; the files stay where they are.
 */
const PRE_UPGRADE_VERIFY_SAMPLE = 100;
const PRE_UPGRADE_VERIFY_MS = 5 * 60 * 1000;

/**
 * Lists archives written before an upgrade that the history does not know: those of a start
 * whose migrations failed, or of a database restored since. Retention then keeps the newest.
 */
async function adoptPreUpgradeArchives(
  db: Database,
  dir: string,
  deps: Pick<BackupDeps, 'remote'>,
) {
  const names = (await readdir(dir).catch(() => [] as string[])).filter(
    (n) => n.startsWith(PRE_UPGRADE) && n.endsWith('.zip'),
  );
  if (names.length === 0) return;
  const known = new Set(
    (
      await db
        .select({ fileName: instanceBackup.fileName })
        .from(instanceBackup)
        .where(inArray(instanceBackup.fileName, names))
    ).map((r) => r.fileName),
  );
  for (const fileName of names) {
    if (known.has(fileName)) continue;
    const info = await stat(join(dir, fileName)).catch(() => null);
    if (!info) continue;
    // Retention removes the bucket copy only when the row says there is one.
    const copiedToBucket = deps.remote
      ? (await deps.remote.storage.size(`${deps.remote.prefix}${fileName}`).catch(() => null)) !==
        null
      : false;
    await db.insert(instanceBackup).values({
      trigger: 'pre-upgrade',
      status: 'ready',
      fileName,
      copiedToBucket,
      size: info.size,
      startedAt: info.mtime,
      heartbeatAt: info.mtime,
      finishedAt: info.mtime,
    });
  }
}

/**
 * The step `runMigrations` runs before pending migrations (#805): a database backup on the
 * schema as the previous version left it, in the usual format, read back and verified, in the
 * usual folder (and bucket). A recent archive of the same schema state is reused, and at most
 * one per state kept. Its history row is written once the migrations applied (the table may
 * not have its newest columns before), with an audit event, both best effort. A failure stops
 * the start before anything is migrated; `skip` (SKIP_PRE_MIGRATION_BACKUP) only logs.
 */
export function backupBeforeMigrating(deps: Omit<BackupDeps, 'db'>, opts: { skip?: boolean } = {}) {
  const { log } = deps;
  return async (
    sql: postgres.Sql,
    pending: { applied: number; pending: number },
  ): Promise<((db: Database) => Promise<void>) | undefined> => {
    if (opts.skip) {
      log.warn(
        pending,
        'migrations pending: backup before them skipped (SKIP_PRE_MIGRATION_BACKUP)',
      );
      return undefined;
    }
    const dir = deps.backupDir;
    const prefix = preUpgradePrefix(pending.applied, await databaseFingerprint(sql));
    const listed = await readdir(dir).catch(() => [] as string[]);
    // Under the migration lock no other start writes one: a `.partial` is from a killed start.
    for (const name of listed)
      if (name.startsWith(PRE_UPGRADE) && name.endsWith('.partial'))
        await rm(join(dir, name), { force: true }).catch(() => {});
    // Named with the time: the last in order is the newest.
    const same = listed.filter((n) => n.startsWith(prefix) && n.endsWith('.zip')).sort();
    const newest = same.at(-1);
    const newestAt = newest ? (await stat(join(dir, newest)).catch(() => null))?.mtime : undefined;
    const adopt = async (db: Database) => {
      try {
        await adoptPreUpgradeArchives(db, dir, deps);
        await applyBackupRetention({ db, remote: deps.remote, backupDir: dir, log });
      } catch (err) {
        // The archives are complete on disk: only the history misses them.
        log.error({ err, dir }, 'backups before the migrations written but not listed');
      }
    };
    if (newest && newestAt && Date.now() - newestAt.getTime() < PRE_UPGRADE_REUSE_MS) {
      log.warn(
        { ...pending, file: join(dir, newest), writtenAt: newestAt.toISOString() },
        'migrations pending: reusing the backup an earlier start wrote before them (that ' +
          'start did not finish migrating: its log has the error)',
      );
      return adopt;
    }
    log.info(pending, 'migrations pending: backing up the database before applying them');
    const id = randomUUID();
    const startedAt = new Date();
    const fileName = `${prefix}${stamp(startedAt)}-${id.slice(0, 8)}.zip`;
    const partial = join(dir, `${fileName}.partial`);
    let written: Awaited<ReturnType<typeof dumpDatabase>>;
    let verified: Awaited<ReturnType<typeof verifyBackup>>;
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700).catch(() => {});
      // Timeouts 0 (UNLIMITED_SESSION) on its own connection. No stall watch: start-up waits.
      written = await dumpDatabase(deps, partial, {
        moved: () => {},
        connected: () => {},
        signal: new AbortController().signal,
      });
      verified = await verifyBackup(partial, deps.storage, {
        signal: AbortSignal.timeout(deps.verifyBudgetMs ?? PRE_UPGRADE_VERIFY_MS),
        sample: PRE_UPGRADE_VERIFY_SAMPLE,
      });
      await rename(partial, join(dir, fileName));
    } catch (err) {
      await rm(partial, { force: true }).catch(() => {});
      log.error({ err }, 'backup before the migrations failed: nothing migrated');
      throw new Error(
        `The backup before the database upgrade failed (${(err as Error).message}). Nothing ` +
          'was migrated: the database is as the previous version left it. Fix the cause and ' +
          'start again, or set SKIP_PRE_MIGRATION_BACKUP=true to upgrade without it (take a ' +
          'backup yourself first): see ' +
          'https://github.com/inkadra/inkadra/blob/main/docs/self-hosting/upgrades.md#the-backup-before-an-upgrade',
        { cause: err },
      );
    }
    // One archive per schema state: the new one replaces older copies of the same state.
    for (const old of same) {
      await rm(join(dir, old), { force: true }).catch(() => {});
      await removeBucketCopy(deps, old);
    }
    const copied = await copyToBucket(deps, id, fileName);
    const file = join(dir, fileName);
    log.info(
      { file, size: written.size, complete: verified.complete, missing: verified.missing.count },
      'backup before the migrations written',
    );
    return async (db) => {
      try {
        await db.insert(instanceBackup).values({
          id,
          trigger: 'pre-upgrade',
          status: 'ready',
          fileName,
          size: written.size,
          copiedToBucket: copied,
          fileCount: written.files.count,
          fileBytes: written.files.bytes,
          startedAt,
          heartbeatAt: startedAt,
          finishedAt: new Date(),
          verifiedAt: new Date(),
          missingFiles: verified.missing.count,
          checkedFiles: verified.checked,
          unverifiedFiles: verified.unverified,
          verifyComplete: verified.complete,
        });
        await recordAudit(db, {
          action: 'backup.started',
          targetType: 'backup',
          targetId: id,
          details: { kind: 'pre-upgrade', files: written.files.count, ...pending },
        }).catch((err) => log.error({ err }, 'audit of the backup before the migrations failed'));
      } catch (err) {
        log.error({ err, file }, 'backup before the migrations written but not listed');
      }
      await adopt(db);
    };
  };
}

/** Counts rows of COPY text output: one line each, newlines inside values are escaped. */
function lineCounter(moved: () => void) {
  let lines = 0;
  const hash = createHash('sha256');
  // COPY sends one message per row: hand the zip 64 KiB pieces, not hundreds of thousands of
  // 200-byte ones (deflating those ran at a few MB/s).
  const BATCH = 64 * 1024;
  let pending: Buffer[] = [];
  let size = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, done) {
      moved();
      hash.update(chunk);
      for (let at = chunk.indexOf(10); at !== -1; at = chunk.indexOf(10, at + 1)) lines += 1;
      pending.push(chunk);
      size += chunk.length;
      if (size < BATCH) return done();
      const batch = Buffer.concat(pending, size);
      pending = [];
      size = 0;
      done(null, batch);
    },
    flush(done) {
      done(null, size ? Buffer.concat(pending, size) : undefined);
    },
  });
  return { stream, lines: () => lines, sha256: () => hash.digest('hex') };
}

/**
 * postgres.js 3.4 paused its socket when a COPY stream was full and resumed it only from
 * the stream's `read()`. When the COPY ended while the socket was paused, nothing resumed
 * it and the next query on the connection never got its answer: the backup waited for ever
 * after the last large table. Once the stream has ended, its `read()` resumes the socket.
 * postgres.js 4 also stops reading messages while paused, so `CopyDone` waits for the next
 * `read()` and this is a no-op there; it stays as a guard. postgres is pinned to an exact
 * version in package.json for this: check this workaround (and the large-table backup
 * test) before upgrading it.
 */
export function resumeWhenDone(source: Readable): Readable {
  const resume = () => (source as Readable & { _read(size: number): void })._read(0);
  source.once('end', resume);
  source.once('close', resume);
  return source;
}

/**
 * When a COPY fails right as it starts (for example `57014` on cancel in the same socket
 * read as `CopyOutResponse`), postgres.js destroys the stream on `nextTick`, before `await`
 * resumes on the microtask queue. Attaching the listener in `query.resolve` catches the
 * error as soon as the stream object exists.
 */
function guardCopyStream<T extends Readable | Writable>(
  query: { resolve?: (stream: T) => void },
  open: () => Promise<T>,
  prepare?: (stream: T) => void,
): Promise<T> {
  let earlyError: unknown;
  let attached = false;
  const setup = (stream: T) => {
    if (attached || !stream || typeof stream.on !== 'function') return;
    attached = true;
    stream.on('error', (err) => {
      earlyError ??= err;
    });
    prepare?.(stream);
  };
  const resolve = query.resolve;
  if (typeof resolve === 'function') {
    query.resolve = function (stream: T) {
      setup(stream);
      return resolve.call(this, stream);
    };
  }
  return open().then((stream) => {
    setup(stream);
    const err = earlyError ?? stream.errored;
    if (err) throw err;
    return stream;
  });
}

export function copyReadable(
  query: Pick<postgres.PendingQuery<postgres.Row[]>, 'readable'>,
): Promise<Readable> {
  return guardCopyStream(
    query as { resolve?: (s: Readable) => void },
    () => query.readable(),
    resumeWhenDone,
  );
}

export function copyWritable(
  query: Pick<postgres.PendingQuery<postgres.Row[]>, 'writable'>,
): Promise<Writable> {
  return guardCopyStream(query as { resolve?: (s: Writable) => void }, () => query.writable());
}

/**
 * Bytes of the files a backup with media copies (#899): originals, thumbnails and the other
 * listed copies, feedback attachments; never the playable copies of videos nor ladder rungs.
 * Copies whose size was never recorded (older rows) count as 512 KiB each, a generous thumbnail.
 */
export const MEDIA_BYTES = `select (
  (select coalesce(sum(size), 0) from asset where status <> 'pending')
  + (select coalesce(sum(coalesce(bytes, ${512 * 1024})), 0) from asset_variant where size <> 'proxy')
  + (select coalesce(sum(bytes), 0) from feedback_attachment where expires_at > now())
)::bigint::text as n`;

/** Free bytes of the disk of `dir`. */
async function freeBytes(dir: string) {
  const disk = await statfs(dir);
  return Number(disk.bavail) * Number(disk.bsize);
}

/**
 * The archive, written to `path`: the tables in one read-only snapshot, the list of stored files
 * and, with `media`, the files themselves (#899), streamed from storage after the snapshot.
 * Fails with ENOSPC (`no_space`) before writing when the disk of `path` lacks the space the
 * estimate asks for.
 */
async function dumpDatabase(
  deps: Pick<BackupDeps, 'databaseUrl' | 'migrationsFolder' | 'mediaFilesMax'>,
  path: string,
  hooks: {
    moved: () => void;
    connected: (pid: number) => void;
    signal: AbortSignal;
    media?: Storage;
    log?: Logger;
  },
) {
  const { moved, signal } = hooks;
  const journal = await readJournal(deps.migrationsFolder);
  const tagOf = new Map(journal.entries.map((e) => [String(e.when), e.tag]));
  // A connection of its own: when a COPY breaks off while its socket is paused for
  // backpressure, postgres.js never reads the end of the transaction. Destroying this
  // connection settles it, without touching the pool the rest of the server uses.
  const sql = postgres(deps.databaseUrl, {
    max: 1,
    onnotice: () => {},
    connection: UNLIMITED_SESSION,
  });
  try {
    let needed = preUpgradeSpaceNeeded(await liveTableBytes(sql));
    if (hooks.media) {
      const [row] = await sql.unsafe<{ n: string }[]>(MEDIA_BYTES);
      needed += Number(row?.n ?? 0);
      const [files] = await sql<{ n: number }[]>`select (
        (select count(*) from asset where status <> 'pending')
        + (select count(*) from asset_variant where size <> 'proxy')
        + (select count(*) from feedback_attachment where expires_at > now())
      )::int as n`;
      const max = deps.mediaFilesMax ?? MEDIA_FILES_MAX;
      if ((files?.n ?? 0) > max)
        throw new Error(
          `${files?.n} files are more than a backup with files holds (${max}): turn "Include files" off and back up the data volume or the bucket instead.`,
        );
    }
    const free = await freeBytes(dirname(path));
    if (free < needed)
      throw Object.assign(
        new Error(
          `not enough free space in ${dirname(path)}: about ${mib(needed)} needed, ${mib(free)} free`,
        ),
        { code: 'ENOSPC' },
      );
  } catch (err) {
    await sql.end({ timeout: 0 }).catch(() => {});
    throw err;
  }
  // The list of files, kept on disk next to the archive for the copy of the files after the
  // snapshot: never in memory.
  const listPath = `${path}.list.partial`;
  const list = hooks.media ? createWriteStream(listPath, { mode: 0o600 }) : null;
  const zip = writeZip(path);
  // A stalled dump (see runBackup) gives up its connection and its file.
  const stop = () => {
    void sql.end({ timeout: 0 });
    zip.abort();
  };
  signal.addEventListener('abort', stop, { once: true });
  let cause: unknown;
  try {
    const result = await sql.begin('isolation level repeatable read read only', async (tx) => {
      try {
        const [backend] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
        if (backend) hooks.connected(backend.pid);
        const applied = await tx<{ created_at: string }[]>`
        select created_at::text from drizzle.__drizzle_migrations order by created_at`;
        const migrations = applied.map((m) => tagOf.get(m.created_at) ?? m.created_at);
        const tables = await tx<{ name: string }[]>`
        select tablename as name from pg_tables where schemaname = 'public' order by tablename`;
        const names = tables
          .map((t) => t.name)
          .filter((n) => NAME.test(n) && !SKIPPED_TABLES.has(n));
        const { order, selfReferencing } = await loadOrder(tx, names);
        const unordered = selfReferencing.filter((n) => !PARENTS_FIRST[n]);
        if (unordered.length)
          throw new Error(`No parents-first order for ${unordered.join(', ')}.`);
        const listed: BackupManifest['tables'] = [];
        for (const name of order) {
          const columns = (
            await tx<{ name: string }[]>`
            select column_name as name from information_schema.columns
            where table_schema = 'public' and table_name = ${name} and is_generated = 'NEVER'
            order by ordinal_position`
          ).map((c) => c.name);
          const entry = `db/${name}.copy`;
          moved();
          const counter = lineCounter(moved);
          const ordered = PARENTS_FIRST[name];
          const query = ordered ?? WITHOUT_DERIVED[name];
          const source = await copyReadable(
            query
              ? tx.unsafe(`copy (${query(columns)}) to stdout`)
              : tx`copy ${tx(name)} (${tx(columns)}) to stdout`,
          );
          // piped: a COPY that fails mid-way must fail the backup, never leave it waiting.
          await zip.addStream(entry, piped(source, counter.stream));
          if (ordered) {
            // Rows no root reaches (a cycle of parents) would be left out without a word, and
            // the restore would then fail: say so now, with the table, instead.
            const [all] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(name)}`;
            const missing = (all?.n ?? 0) - counter.lines();
            if (missing !== 0)
              throw new BackupInconsistent(
                `${name}: ${missing} rows are in a cycle of parents and cannot be backed up.`,
              );
          }
          listed.push({ name, columns, rows: counter.lines(), entry, sha256: counter.sha256() });
        }
        // Every stored file: originals with their checksum, thumbnails by key. Playable
        // copies of videos are left out with their rows (WITHOUT_DERIVED). Streamed a page at a
        // time (#794): an instance with millions of files never holds the list in memory.
        let count = 0;
        let bytes = 0;
        const filesHash = createHash('sha256');
        // The backup before an upgrade (#805) dumps the schema of any older release: feedback
        // attachments only exist from migration 0027 (0.9).
        const [feedback] = await tx<{ ok: boolean }[]>`
        select to_regclass('public.feedback_attachment') is not null as ok`;
        const pages = tx<{ key: string; size: string | null; sha256: string | null }[]>`
        select storage_key as key, size::text, sha256 from asset where status <> 'pending'
        union all
        select storage_key, null, null from asset_variant where size <> 'proxy'
        ${
          feedback?.ok
            ? tx`union all
        select 'feedback/' || id, bytes::text, null from feedback_attachment where expires_at > now()`
            : tx``
        }`.cursor(1000);
        async function* fileLines() {
          for await (const rows of pages) {
            let out = '';
            for (const f of rows) {
              count += 1;
              bytes += Number(f.size ?? 0);
              out += `${JSON.stringify({
                key: f.key,
                size: f.size === null ? null : Number(f.size),
                sha256: f.sha256,
              })}\n`;
            }
            moved();
            const chunk = Buffer.from(out);
            filesHash.update(chunk);
            if (list && !list.write(chunk)) await once(list, 'drain');
            yield chunk;
          }
        }
        await zip.addStream('files.jsonl', Readable.from(fileLines(), { objectMode: false }));
        const manifest: BackupManifest = {
          format: BACKUP_FORMAT,
          formatVersion: BACKUP_FORMAT_VERSION,
          appVersion: VERSION,
          createdAt: new Date().toISOString(),
          migrations,
          tables: listed,
          rebuilt: [...BACKUP_REBUILT_TABLES],
          files: { count, bytes, entry: 'files.jsonl', sha256: filesHash.digest('hex') },
        };
        return manifest;
      } catch (err) {
        // Ending the connection rejects the transaction with its own error: keep ours.
        cause = err;
        void sql.end({ timeout: 0 });
        throw err;
      }
    });
    await sql.end({ timeout: 0 }).catch(() => {});
    const manifest = result;
    let media: { count: number; bytes: number } | null = null;
    if (list && hooks.media) {
      list.end();
      await once(list, 'close');
      manifest.media = await addMedia(zip, listPath, hooks.media, moved, hooks.log);
      media = { count: manifest.media.count, bytes: manifest.media.bytes };
    }
    await zip.addJson('manifest.json', manifest);
    const size = await zip.close();
    return { size, files: { count: manifest.files.count, bytes: manifest.files.bytes }, media };
  } catch (err) {
    zip.abort();
    throw cause ?? err;
  } finally {
    signal.removeEventListener('abort', stop);
    list?.destroy();
    await rm(listPath, { force: true }).catch(() => {});
    await sql.end({ timeout: 0 }).catch(() => {});
  }
}

/** Where a stored file is in an archive with media. */
const mediaEntry = (key: string) => `media/${key}`;

/**
 * Copies the files of the list at `listPath` into the archive, one at a time and streamed, each
 * hashed on the way (#899); `media.jsonl` records key, size and SHA-256 of the bytes read, for
 * the verification and the restore. A file storage no longer has, or that went away between its
 * lookup and its read, is left out and counted (`missing`): it was already lost, the database
 * still restores. A file whose size changed meanwhile is kept as read and logged.
 */
async function addMedia(
  zip: ZipWriter,
  listPath: string,
  storage: Storage,
  moved: () => void,
  log?: Logger,
) {
  const linesPath = `${listPath}.media`;
  const lines = createWriteStream(linesPath, { mode: 0o600 });
  const linesHash = createHash('sha256');
  let count = 0;
  let bytes = 0;
  let missing = 0;
  let changed = 0;
  try {
    for await (const line of createInterface({
      input: createReadStream(listPath),
      crlfDelay: Number.POSITIVE_INFINITY,
    })) {
      if (!line) continue;
      const { key } = JSON.parse(line) as { key: string };
      const size = await storage.size(key);
      const body = size === null ? null : await openStored(storage, key);
      if (size === null || body === null) {
        missing += 1;
        continue;
      }
      const hash = createHash('sha256');
      let read = 0;
      const hashing = new Transform({
        transform(chunk: Buffer, _enc, done) {
          moved();
          hash.update(chunk);
          read += chunk.length;
          done(null, chunk);
        },
      });
      // Stored, not deflated: pictures and videos are compressed already. No size given to
      // yazl: a file rewritten since its lookup goes in as read, never fails the archive.
      await zip.addStream(mediaEntry(key), piped(body, hashing), { compress: false });
      if (read !== size) {
        changed += 1;
        log?.warn({ key, listed: size, read }, 'file changed while it was backed up');
      }
      const out = Buffer.from(
        `${JSON.stringify({ key, size: read, sha256: hash.digest('hex') })}\n`,
      );
      linesHash.update(out);
      if (!lines.write(out)) await once(lines, 'drain');
      count += 1;
      bytes += read;
    }
    lines.end();
    await once(lines, 'close');
    await zip.addStream('media.jsonl', createReadStream(linesPath));
    if (missing > 0 || changed > 0)
      log?.warn({ missing, changed }, 'some files changed or went away while backed up');
    return {
      count,
      bytes,
      missing,
      entry: 'media.jsonl' as const,
      sha256: linesHash.digest('hex'),
    };
  } finally {
    lines.destroy();
    await rm(linesPath, { force: true }).catch(() => {});
  }
}

/**
 * A stored file opened for reading, or null when it is gone: a local file is only opened on
 * its first read, so this waits for that before the archive gets an entry it could not fill.
 */
async function openStored(storage: Storage, key: string) {
  try {
    const body = await storage.read(key);
    await once(body, 'readable');
    return body;
  } catch (err) {
    if ((await storage.size(key).catch(() => 0)) === null) return null;
    throw err;
  }
}

// Restore --------------------------------------------------------------------

export interface RestoreReport {
  tables: number;
  rows: number;
  migrationsBefore: number;
  migrationsAfter: number;
  /**
   * `restored`: files put back into storage from a backup with media (#899); `failed`: those
   * that could not be, named in `failedExamples` (run `backup restore-files` again).
   */
  files: {
    listed: number;
    restored: number;
    kept: number;
    failed: number;
    failedExamples: string[];
    missing: number;
    unverified: number;
    examples: string[];
  };
}

/**
 * Tables in an order where each comes after those its foreign keys point to, and the tables
 * that reference themselves.
 */
async function loadOrder(
  sql: postgres.Sql | postgres.TransactionSql,
  names: string[],
): Promise<{ order: string[]; selfReferencing: string[] }> {
  const edges = await sql<{ child: string; parent: string }[]>`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'`;
  const clean = (t: string) => t.replace(/^public\./, '').replaceAll('"', '');
  const deps = new Map(names.map((n) => [n, new Set<string>()]));
  const selfReferencing = new Set<string>();
  for (const e of edges) {
    const child = clean(e.child);
    const parent = clean(e.parent);
    if (child === parent && deps.has(child)) selfReferencing.add(child);
    else if (deps.has(child) && deps.has(parent)) deps.get(child)?.add(parent);
  }
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (n: string) => {
    if (state.get(n) === 'done') return;
    if (state.get(n) === 'visiting') throw new Error(`Foreign keys form a cycle at ${n}.`);
    state.set(n, 'visiting');
    for (const p of deps.get(n) ?? []) visit(p);
    state.set(n, 'done');
    order.push(n);
  };
  for (const n of names) visit(n);
  return { order, selfReferencing: [...selfReferencing] };
}

/** A migrations folder with the first `count` migrations of `source`. */
async function partialMigrations(source: string, count: number, into: string) {
  const journal = JSON.parse(await readFile(join(source, 'meta', '_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, count);
  await mkdir(join(into, 'meta'), { recursive: true });
  await writeFile(join(into, 'meta', '_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries as Journal['entries'])
    await copyFile(join(source, `${entry.tag}.sql`), join(into, `${entry.tag}.sql`));
}

/**
 * Restores a backup into an empty database: migrations of the backup, the data, then the
 * migrations this version adds. Refuses a database with accounts in it and backups from a
 * newer version. The archive is read back whole first (`verifyBackup`, no time limit): a
 * corrupt one never touches the database. A backup with media puts its files back into
 * storage (#899); the files are then checked against the list. Files that failed are in
 * `files.failed`: the database is restored, `restoreBackupFiles` finishes the files.
 */
export async function restoreBackup(opts: {
  file: string;
  databaseUrl: string;
  migrationsFolder: string;
  storage: Storage;
  tmpDir: string;
  log: Logger;
  /** Compare stored files by hash too before keeping them (local storage). */
  hashExisting?: boolean;
  retryMs?: number;
  /** Tests of the load itself only: no reading back first. */
  skipVerify?: boolean;
}): Promise<RestoreReport> {
  if (!opts.skipVerify) {
    opts.log.info('reading the backup back before restoring it');
    await verifyBackup(opts.file, opts.storage, { lookUp: false });
  }
  const zip = await readZip(opts.file, ARCHIVE_LIMITS);
  try {
    const manifest = await zip.json('manifest.json', BackupManifest, 64 * 1024 * 1024);
    if (manifest.format !== BACKUP_FORMAT || manifest.formatVersion > BACKUP_FORMAT_VERSION)
      throw new Error('Not an Inkadra backup this version can read.');
    const local = (await readJournal(opts.migrationsFolder)).entries.map((e) => e.tag);
    const count = manifest.migrations.length;
    if (count > local.length || manifest.migrations.some((tag, i) => local[i] !== tag))
      throw new Error(
        `The backup comes from a newer or different Inkadra (${manifest.appVersion}): restore it with that version.`,
      );

    const { sql } = createDatabase(opts.databaseUrl, 1);
    try {
      const [users] = await sql<{ n: number }[]>`
        select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name = 'user'`;
      if ((users?.n ?? 0) > 0) {
        const [people] = await sql<{ n: number }[]>`select count(*)::int as n from "user"`;
        if ((people?.n ?? 0) > 0)
          throw new Error('The database is not empty: restore into a new, empty database.');
      }
      const [applied] = await sql<{ n: number }[]>`
        select count(*)::int as n from information_schema.tables
        where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`;
      if ((applied?.n ?? 0) > 0) {
        const [done] = await sql<{ n: number }[]>`
          select count(*)::int as n from drizzle.__drizzle_migrations`;
        if ((done?.n ?? 0) > count)
          throw new Error(
            'The database already has newer migrations: restore into a new, empty database.',
          );
      }
    } finally {
      await sql.end();
    }

    await mkdir(opts.tmpDir, { recursive: true });
    const folder = await mkdtemp(join(opts.tmpDir, 'restore-'));
    try {
      await partialMigrations(opts.migrationsFolder, count, folder);
      await runMigrations(opts.databaseUrl, folder, { schemaOnly: true });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    opts.log.info({ migrations: count }, 'schema of the backup ready');

    let rows = 0;
    const { sql: target } = createDatabase(opts.databaseUrl, 1);
    try {
      // The manifest lists tables in load order, self-referencing rows parents first.
      await target.begin(async (tx) => {
        // The storage totals are rebuilt once at the end, not file by file as the rows arrive
        // (#879). Before migration 0052 there are neither triggers nor totals: it builds them.
        const [totals] = await tx<{ ok: boolean }[]>`
          select to_regclass('storage_total') is not null as ok`;
        const counted = totals?.ok ? STORAGE_TOTAL_TABLES : [];
        for (const name of counted) await tx`alter table ${tx(name)} disable trigger user`;
        for (const table of manifest.tables) {
          const name = table.name;
          const sink = await copyWritable(
            tx`copy ${tx(table.name)} (${tx(table.columns)}) from stdin`,
          );
          const entry = await zip.stream(table.entry, Number.MAX_SAFE_INTEGER).catch((err) => {
            sink.destroy();
            throw err;
          });
          if (sink.errored) {
            entry.destroy();
            throw sink.errored;
          }
          await pipeline(entry, sink);
          rows += table.rows;
          opts.log.info({ table: name, rows: table.rows }, 'table restored');
        }
        for (const name of counted) await tx`alter table ${tx(name)} enable trigger user`;
        if (counted.length > 0) await tx.unsafe(REBUILD_STORAGE_TOTALS);
      });
    } finally {
      await target.end();
    }
    await runMigrations(opts.databaseUrl, opts.migrationsFolder);
    // The search index is not in backups: the startup backfill rebuilds it from documents.
    const { sql: after } = createDatabase(opts.databaseUrl, 1);
    try {
      await after`update board_doc set indexed_at = null`;
    } finally {
      await after.end();
    }

    const media = manifest.media
      ? await restoreMedia(zip, manifest.media, opts.storage, opts.log, opts)
      : null;
    if (media) opts.log.info(media, 'files of the backup restored');
    const files = await checkFiles(zip, opts.storage);
    // In the restored database: who restored is not known (the command line), when and what is.
    // Best effort: the restore itself succeeded, a failed record must not report it failed.
    const { sql: audit } = createDatabase(opts.databaseUrl, 1);
    try {
      await audit`
        insert into audit_event (action, target_type, target_id, details)
        values ('backup.restored', 'backup', ${basename(opts.file)},
          ${JSON.stringify({
            createdAt: manifest.createdAt,
            appVersion: manifest.appVersion,
            missingFiles: files.missing.count,
            failedFiles: media?.failed.count ?? 0,
          })}::jsonb)`;
    } catch (err) {
      opts.log.error({ err }, 'restore not recorded in the audit log');
    } finally {
      await audit.end().catch(() => {});
    }
    return {
      tables: manifest.tables.length,
      rows,
      migrationsBefore: count,
      migrationsAfter: local.length,
      files: {
        listed: files.listed,
        restored: media?.restored ?? 0,
        kept: media?.kept ?? 0,
        failed: media?.failed.count ?? 0,
        failedExamples: media?.failed.examples ?? [],
        missing: files.missing.count,
        unverified: files.unverified,
        examples: files.missing.examples,
      },
    };
  } finally {
    zip.close();
  }
}

const ARCHIVE_LIMITS = {
  // shortcut: one entry per file of a backup with media (#899), and yazl and yauzl keep the
  // central directory in memory: about 1 KiB an entry each (measured with 10 000 to 40 000
  // entries), and yazl's writing slows down as the square of the entries. Past this many files,
  // media backups need a format with an index of its own.
  entries: 500_000,
  totalBytes: Number.MAX_SAFE_INTEGER,
  compressionRatio: 10_000,
};

/**
 * Reads `files.jsonl` line by line and looks files up in storage, `VERIFY_CONCURRENCY` at a
 * time: the files a restore of this backup would miss (#794). Never holds the whole list in
 * memory. With `sample`, a list longer than that is checked on an even sample of that size.
 * A lookup that fails (not a missing file: an error) is tried once more, then counted as
 * `unverified`, neither missing nor found. After `signal` aborts it stops looking files up
 * (`complete: false`) but still reads the list to the end, for its count and hash.
 */
async function checkFiles(
  zip: ZipReader,
  storage: Storage,
  opts: {
    listed?: number;
    sample?: number;
    signal?: AbortSignal;
    moved?: () => void;
    lookUp?: boolean;
  } = {},
) {
  const hash = createHash('sha256');
  const source = piped(
    await zip.stream('files.jsonl', Number.MAX_SAFE_INTEGER),
    new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    }),
  );
  const every =
    opts.sample && opts.listed && opts.listed > opts.sample
      ? Math.ceil(opts.listed / opts.sample)
      : 1;
  const stopped = opts.signal
    ? new Promise<void>((resolve) => {
        if (opts.signal?.aborted) resolve();
        opts.signal?.addEventListener('abort', () => resolve(), { once: true });
      })
    : null;
  const missing = { count: 0, examples: [] as string[] };
  let listed = 0;
  let checked = 0;
  let unverified = 0;
  let batch: Array<{ key: string; size: number | null }> = [];
  const sizeOf = async (key: string) => {
    try {
      return await storage.size(key);
    } catch {
      return await storage.size(key);
    }
  };
  const flush = async () => {
    const work = Promise.all(
      batch.map(async (f) => {
        let size: number | null;
        try {
          size = await sizeOf(f.key);
        } catch {
          unverified += 1;
          return;
        }
        checked += 1;
        if (size === null || (f.size !== null && size !== f.size)) {
          missing.count += 1;
          if (missing.examples.length < 10) missing.examples.push(f.key);
        }
      }),
    );
    // A lookup that hangs past the stop does not hold the verification.
    await (stopped ? Promise.race([work, stopped]) : work);
    batch = [];
    opts.moved?.();
  };
  for await (const line of createInterface({
    input: source,
    crlfDelay: Number.POSITIVE_INFINITY,
  })) {
    if (!line) continue;
    listed += 1;
    if (opts.lookUp === false || opts.signal?.aborted || (listed - 1) % every !== 0) continue;
    batch.push(JSON.parse(line) as { key: string; size: number | null });
    if (batch.length === VERIFY_CONCURRENCY) await flush();
  }
  if (!opts.signal?.aborted) await flush();
  return {
    listed,
    checked,
    unverified,
    missing,
    complete: !opts.signal?.aborted,
    sha256: hash.digest('hex'),
  };
}

/**
 * Reads a written archive back (#794): the manifest, each table entry counted and hashed
 * against it, the file list checked against storage (a sample above `VERIFY_SAMPLE` files) and,
 * in a backup with media, every file hashed against `media.jsonl` (#899). Throws
 * `BackupCorrupt` when the archive does not match what was written; files missing from storage
 * are only reported. Once `signal` aborts (a stall) it stops; `budgetMs` bounds the tables and
 * the file list, the files of the archive get it plus the time `MEDIA_VERIFY_BYTES_PER_MS`
 * needs for their bytes. A part stopped early answers `complete: false` with what it checked,
 * named in `parts`: never corrupt for lack of time. With `lookUp: false` the file list is read
 * and hashed but not looked up (a restore, before the files are back).
 */
export async function verifyBackup(
  file: string,
  storage: Storage,
  opts: {
    signal?: AbortSignal;
    moved?: () => void;
    sample?: number;
    budgetMs?: number;
    lookUp?: boolean;
  } = {},
) {
  const zip = await readZip(file, ARCHIVE_LIMITS);
  const within = (ms: number | undefined) => {
    const signals = [
      ...(opts.signal ? [opts.signal] : []),
      ...(ms === undefined ? [] : [AbortSignal.timeout(ms)]),
    ];
    return signals.length ? AbortSignal.any(signals) : undefined;
  };
  const parts = { tables: false, files: false, media: null as boolean | null };
  const incomplete = (tables: number) => ({
    tables,
    files: 0,
    checked: 0,
    unverified: 0,
    missing: { count: 0, examples: [] as string[] },
    media: null,
    complete: false,
    parts,
  });
  try {
    const manifest = await zip.json('manifest.json', BackupManifest, 64 * 1024 * 1024);
    // One budget for the tables and the file list, as before files were in backups.
    const signal = within(opts.budgetMs);
    let tables = 0;
    for (const table of manifest.tables) {
      if (signal?.aborted) return incomplete(tables);
      const counter = lineCounter(() => opts.moved?.());
      await pipeline(
        await zip.stream(table.entry, Number.MAX_SAFE_INTEGER),
        counter.stream,
        new Writable({ write: (_chunk, _enc, done) => done() }),
        { signal: signal ?? new AbortController().signal },
      ).catch((err) => {
        if (!signal?.aborted) throw err;
      });
      if (signal?.aborted) return incomplete(tables);
      if (counter.lines() !== table.rows || (table.sha256 && counter.sha256() !== table.sha256))
        throw new BackupCorrupt(`${table.name} does not read back as written.`);
      tables += 1;
    }
    parts.tables = true;
    const files = await checkFiles(zip, storage, {
      listed: manifest.files.count,
      sample: opts.sample ?? VERIFY_SAMPLE,
      signal,
      moved: opts.moved,
      lookUp: opts.lookUp,
    });
    if (
      files.listed !== manifest.files.count ||
      (manifest.files.sha256 && files.sha256 !== manifest.files.sha256)
    )
      throw new BackupCorrupt('files.jsonl does not read back as written.');
    parts.files = files.complete;
    // The files of the archive last, on a budget of their own: a large library never keeps
    // the file list from being looked up.
    let media: { checked: number; count: number } | null = null;
    if (manifest.media) {
      const checked = await checkMedia(zip, manifest.media, {
        signal: within(
          opts.budgetMs === undefined
            ? undefined
            : Math.ceil(opts.budgetMs + manifest.media.bytes / MEDIA_VERIFY_BYTES_PER_MS),
        ),
        moved: opts.moved,
      });
      media = { checked: checked.checked, count: manifest.media.count };
      parts.media = checked.complete;
    }
    return {
      tables,
      files: files.listed,
      checked: files.checked,
      unverified: files.unverified,
      missing: files.missing,
      media,
      complete: parts.tables && parts.files && parts.media !== false,
      parts,
    };
  } finally {
    zip.close();
  }
}

/**
 * A key a backup may hold a file of: a safe storage key under one of the folders of stored
 * files (`STORAGE_PREFIXES`), never anywhere else in storage (#899).
 */
const MEDIA_KEY = new RegExp(
  `^(${STORAGE_PREFIXES.map((p) => p.slice(0, -1)).join('|')})(/[A-Za-z0-9._-]+)+$`,
);

/** The keys of `files.jsonl`, in its order. */
async function* listedKeys(zip: ZipReader) {
  const source = await zip.stream('files.jsonl', Number.MAX_SAFE_INTEGER);
  try {
    for await (const line of createInterface({
      input: source,
      crlfDelay: Number.POSITIVE_INFINITY,
    }))
      if (line) yield (JSON.parse(line) as { key: string }).key;
  } finally {
    source.destroy();
  }
}

/**
 * The lines of `media.jsonl`, each checked: a well-formed line for a stored-file key that
 * `files.jsonl` lists, in its order (the backup copies files in the order of the list), and,
 * at the end, the count and hash of the listing. A line that fails throws `BackupCorrupt`:
 * read the whole listing once before writing anything (#899).
 */
async function* mediaLines(zip: ZipReader, media: NonNullable<BackupManifest['media']>) {
  const hash = createHash('sha256');
  let count = 0;
  const source = piped(
    await zip.stream(media.entry, Number.MAX_SAFE_INTEGER),
    new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    }),
  );
  const listed = listedKeys(zip);
  try {
    for await (const line of createInterface({
      input: source,
      crlfDelay: Number.POSITIVE_INFINITY,
    })) {
      if (!line) continue;
      count += 1;
      let file: { key: string; size: number; sha256: string };
      try {
        file = JSON.parse(line);
      } catch {
        throw new BackupCorrupt(`media.jsonl line ${count} is not JSON.`);
      }
      if (
        typeof file?.key !== 'string' ||
        !MEDIA_KEY.test(file.key) ||
        file.key.includes('..') ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        typeof file.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(file.sha256)
      )
        throw new BackupCorrupt(`media.jsonl line ${count} is not a stored file of a backup.`);
      let next = await listed.next();
      while (!next.done && next.value !== file.key) next = await listed.next();
      if (next.done) throw new BackupCorrupt(`${file.key} is not in the file list of the backup.`);
      yield file;
    }
  } finally {
    await listed.return(undefined);
    source.destroy();
  }
  if (count !== media.count || hash.digest('hex') !== media.sha256)
    throw new BackupCorrupt('media.jsonl does not read back as written.');
}

/**
 * Reads every file of a backup with media back (#899): its size and SHA-256 against
 * `media.jsonl`. `complete: false` when `signal` stopped it first, with the files checked by
 * then; throws `BackupCorrupt` on a mismatch.
 */
async function checkMedia(
  zip: ZipReader,
  media: NonNullable<BackupManifest['media']>,
  opts: { signal?: AbortSignal; moved?: () => void },
) {
  let checked = 0;
  for await (const file of mediaLines(zip, media)) {
    if (opts.signal?.aborted) return { checked, complete: false };
    await pipeline(
      await zip.stream(mediaEntry(file.key), file.size),
      matching(file, opts.moved),
      new Writable({ write: (_chunk, _enc, done) => done() }),
      { signal: opts.signal ?? new AbortController().signal },
    ).catch((err) => {
      if (!opts.signal?.aborted) throw err;
    });
    if (opts.signal?.aborted) return { checked, complete: false };
    checked += 1;
  }
  return { checked, complete: true };
}

/**
 * Passes a file of the archive through, and fails with `BackupCorrupt` at its end when its size
 * or SHA-256 is not what `media.jsonl` says: before the end of the stream, so a write it feeds
 * never completes with other bytes (a local file is not renamed into place, an S3 upload is
 * not completed). The archive's own CRC is not checked by yauzl: this is the check.
 */
function matching(file: { key: string; size: number; sha256: string }, moved?: () => void) {
  const hash = createHash('sha256');
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      moved?.();
      hash.update(chunk);
      size += chunk.length;
      done(null, chunk);
    },
    flush(done) {
      done(
        size === file.size && hash.digest('hex') === file.sha256
          ? null
          : new BackupCorrupt(`${file.key} does not read back as written.`),
      );
    },
  });
}

/** Waits before trying a storage call again: `RESTORE_RETRY_MS`, then twice, then four times. */
export const RESTORE_RETRY_MS = 1000;
const RESTORE_ATTEMPTS = 4;

/**
 * `work` tried again with backoff after an error of storage (a 5xx, a timeout); never after an
 * error of the archive itself, which trying again would not mend.
 */
async function retried<T>(work: () => Promise<T>, waitMs: number): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (err) {
      if (
        attempt >= RESTORE_ATTEMPTS ||
        err instanceof BackupCorrupt ||
        err instanceof ArchiveError
      )
        throw err;
      await delay(waitMs * 2 ** (attempt - 1));
    }
  }
}

/** SHA-256 of a stored file. */
async function storedHash(storage: Storage, key: string) {
  const hash = createHash('sha256');
  for await (const chunk of await storage.read(key)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface MediaRestore {
  /** Files written back. */
  restored: number;
  /** Files storage already had with the same size (and hash, with `hashExisting`). */
  kept: number;
  /** Files that could not be written back, or whose bytes in the archive are not as listed. */
  failed: { count: number; examples: string[] };
}

/**
 * Puts the files of a backup with media back into storage (#899), local or bucket: those
 * storage lacks or has with another size (or, with `hashExisting`, other bytes: cheap on a
 * local disk only). `media.jsonl` is read and checked whole first: an archive listing a key
 * outside the folders of stored files, or not in its file list, writes nothing. Each file is
 * hashed as it is written and only lands when it matches; storage errors are tried again with
 * backoff. A file that still fails is counted and named, and the others go on: running it again
 * (`backup restore-files`) writes only what is still missing.
 */
async function restoreMedia(
  zip: ZipReader,
  media: NonNullable<BackupManifest['media']>,
  storage: Storage,
  log: Logger,
  opts: { hashExisting?: boolean; retryMs?: number } = {},
): Promise<MediaRestore> {
  // Read to the end first: every line checked before the first write.
  let listed = 0;
  for await (const _file of mediaLines(zip, media)) listed += 1;
  log.info({ files: listed }, 'restoring the files of the backup');
  const waitMs = opts.retryMs ?? RESTORE_RETRY_MS;
  const result: MediaRestore = { restored: 0, kept: 0, failed: { count: 0, examples: [] } };
  for await (const file of mediaLines(zip, media)) {
    try {
      const present = await retried(() => storage.size(file.key), waitMs);
      if (
        present === file.size &&
        (!opts.hashExisting ||
          (await retried(() => storedHash(storage, file.key), waitMs)) === file.sha256)
      ) {
        result.kept += 1;
        continue;
      }
      await retried(
        async () =>
          storage.writeStream(
            file.key,
            piped(await zip.stream(mediaEntry(file.key), file.size), matching(file)),
            'application/octet-stream',
          ),
        waitMs,
      );
      result.restored += 1;
      if (result.restored % 1000 === 0) log.info({ restored: result.restored }, 'restoring files');
    } catch (err) {
      result.failed.count += 1;
      if (result.failed.examples.length < 20) result.failed.examples.push(file.key);
      log.error({ err, key: file.key }, 'file of the backup not restored');
    }
  }
  return result;
}

/**
 * `backup restore-files` (#899): puts the files of a backup with media back into storage
 * without touching the database, after a restore whose files did not all land (a bucket that
 * failed mid-way). Writes only what storage lacks or has with other bytes: run it again until
 * nothing fails.
 */
export async function restoreBackupFiles(opts: {
  file: string;
  storage: Storage;
  log: Logger;
  hashExisting?: boolean;
  retryMs?: number;
}) {
  const zip = await readZip(opts.file, ARCHIVE_LIMITS);
  try {
    const manifest = await zip.json('manifest.json', BackupManifest, 64 * 1024 * 1024);
    if (manifest.format !== BACKUP_FORMAT || manifest.formatVersion > BACKUP_FORMAT_VERSION)
      throw new Error('Not an Inkadra backup this version can read.');
    if (!manifest.media)
      throw new Error('This backup holds no files: it was made without "Include files".');
    const media = await restoreMedia(zip, manifest.media, opts.storage, opts.log, opts);
    const files = await checkFiles(zip, opts.storage);
    return {
      listed: files.listed,
      restored: media.restored,
      kept: media.kept,
      failed: media.failed.count,
      failedExamples: media.failed.examples,
      missing: files.missing.count,
      unverified: files.unverified,
      examples: files.missing.examples,
    };
  } finally {
    zip.close();
  }
}

/**
 * The archive a restore reads: a path, a name in the backup folder, or a name only the backup
 * bucket has, downloaded into the backup folder first (#899) when its disk has room for it.
 * `downloaded`: the copy is this restore's, to remove once it succeeded.
 */
export async function archiveToRestore(
  file: string,
  dir: string,
  remote: BackupRemote | null,
  log: Logger,
) {
  const exists = async (path: string) => (await stat(path).catch(() => null)) !== null;
  // A path that is not there: the restore says so.
  if ((await exists(file)) || basename(file) !== file) return { path: file, downloaded: false };
  const local = join(dir, file);
  if ((await exists(local)) || !remote) return { path: local, downloaded: false };
  const key = `${remote.prefix}${file}`;
  const size = await remote.storage.size(key);
  if (size === null) throw new Error(`${file} is neither in ${dir} nor in ${remote.label}.`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const free = await freeBytes(dir);
  if (free < size)
    throw Object.assign(
      new Error(
        `not enough free space in ${dir} to download ${file}: ${mib(size)} needed, ${mib(free)} free`,
      ),
      { code: 'ENOSPC' },
    );
  log.info({ from: `${remote.label}${file}`, to: local }, 'downloading the backup');
  const partial = `${local}.partial`;
  try {
    await pipeline(await remote.storage.read(key), createWriteStream(partial, { mode: 0o600 }));
    await rename(partial, local);
  } finally {
    await rm(partial, { force: true });
  }
  return { path: local, downloaded: true };
}

/** Removes `.partial` files left by a backup that was interrupted. */
export async function sweepPartialBackups(dir: string) {
  for (const name of await readdir(dir).catch(() => [] as string[]))
    if (name.endsWith('.partial')) {
      const info = await stat(join(dir, name)).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 12 * 3600 * 1000)
        await rm(join(dir, name), { force: true });
    }
}
