import { createReadStream } from 'node:fs';
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
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Logger } from 'pino';
import postgres from 'postgres';
import { VERSION } from './config.ts';
import { createDatabase, type Database, runMigrations } from './db/client.ts';
import { instanceBackup, instanceSetting } from './db/schema.ts';
import type { Storage } from './storage.ts';
import { piped, readZip, writeZip } from './transfers/zip.ts';

/**
 * Instance backups (decision 0037): a logical dump of every table of the `public` schema with
 * `COPY`, taken in one read-only snapshot, plus a manifest of stored files. No pg_dump needed.
 */
export const backupsDir = (dataDir: string) => join(dataDir, 'backups');
export const BUCKET_PREFIX = 'backups/';

/**
 * Left out of every backup: the feature's own bookkeeping (a restored running row would block
 * later backups; transfer archives are not in it) and derived tables a restore rebuilds.
 */
const SKIPPED_TABLES = new Set<string>([
  'instance_backup',
  'project_transfer',
  ...BACKUP_REBUILT_TABLES,
]);
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** A dump with no data moving for this long has stalled and fails (`stalled`). */
export const STALL_MS = 5 * 60 * 1000;
class BackupStalled extends Error {
  constructor() {
    super('The backup made no progress and was stopped.');
  }
}

/** A running backup moves its heartbeat this often; one silent for STALE_MS was interrupted. */
const HEARTBEAT_MS = 10 * 1000;
export const STALE_MS = 15 * 60 * 1000;
/** A worker that starts runs no backup yet: older silent rows belong to a process now gone. */
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
  comment: (columns) =>
    `select ${columns.map((c) => `"${c}"`).join(', ')} from comment
     order by thread_id nulls first, id`,
};

export type BackupRow = typeof instanceBackup.$inferSelect;

export function toBackup(row: BackupRow): InstanceBackup {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    fileName: row.removedAt ? null : row.fileName,
    size: row.size,
    copiedToBucket: row.copiedToBucket,
    files: row.fileCount === null ? null : { count: row.fileCount, bytes: row.fileBytes ?? 0 },
    failure: row.failure,
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
  storage: Storage;
  dataDir: string;
  migrationsFolder: string;
  /** Files live in S3: copy the archive to the bucket as well. */
  bucket: boolean;
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
  const dir = backupsDir(deps.dataDir);
  // The id keeps two backups of the same second apart.
  const fileName = `inkadra-backup-${stamp(new Date())}-${id.slice(0, 8)}.zip`;
  const partial = join(dir, `${fileName}.partial`);
  // The heartbeat moves only while data moves: a dump stuck on a query that never answers
  // stops beating and is reaped as interrupted, instead of staying `running` for ever.
  let movedAt = Date.now();
  let beatAt = 0;
  // Nothing moved for this long: the dump is stuck (a query that never answers, a stream
  // that never ends). Fail it with `stalled` instead of leaving it `running`.
  const stall = new AbortController();
  const stallMs = deps.stallMs ?? STALL_MS;
  const stalled = new Promise<never>((_, reject) =>
    stall.signal.addEventListener('abort', () => reject(new BackupStalled()), { once: true }),
  );
  stalled.catch(() => {});
  const heartbeat = setInterval(
    () => {
      if (Date.now() - movedAt > stallMs && !stall.signal.aborted) {
        log.error({ backup: id, stalledFor: Date.now() - movedAt }, 'backup stalled, giving up');
        stall.abort();
      }
      if (movedAt <= beatAt) return;
      beatAt = Date.now();
      db.update(instanceBackup)
        .set({ heartbeatAt: new Date() })
        .where(and(eq(instanceBackup.id, id), eq(instanceBackup.status, 'running')))
        .catch(() => {});
    },
    Math.min(HEARTBEAT_MS, Math.max(50, stallMs / 4)),
  );
  heartbeat.unref();
  try {
    // A job can run again after its worker died (BullMQ moves it back to the queue): only a
    // row still running is worked on, never one already marked failed or done.
    const [claimed] = await db
      .select({ status: instanceBackup.status })
      .from(instanceBackup)
      .where(eq(instanceBackup.id, id));
    if (claimed?.status !== 'running') {
      log.warn({ backup: id, status: claimed?.status ?? null }, 'backup not running, skipped');
      clearInterval(heartbeat);
      return null;
    }
    log.info({ backup: id, fileName }, 'backup started');
    // Backups hold password hashes and sessions: readable by the server's user only.
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => {});
    const dump = dumpDatabase(
      deps,
      partial,
      () => {
        movedAt = Date.now();
      },
      stall.signal,
    );
    // After a stall the dump may still fail on its own: that is already handled.
    dump.catch(() => {});
    const result = await Promise.race([dump, stalled]);
    await rename(partial, join(dir, fileName));
    let copied = false;
    if (deps.bucket) {
      await deps.storage.writeStream(
        `${BUCKET_PREFIX}${fileName}`,
        createReadStream(join(dir, fileName)),
        'application/zip',
      );
      copied = true;
    }
    const [row] = await db
      .update(instanceBackup)
      .set({
        status: 'ready',
        fileName,
        size: result.size,
        copiedToBucket: copied,
        fileCount: result.files.count,
        fileBytes: result.files.bytes,
        finishedAt: new Date(),
      })
      .where(eq(instanceBackup.id, id))
      .returning();
    log.info({ backup: id, fileName, size: result.size }, 'backup written');
    await applyBackupRetention(deps);
    return row ?? null;
  } catch (err) {
    const failure =
      err instanceof BackupStalled
        ? 'stalled'
        : (err as NodeJS.ErrnoException)?.code === 'ENOSPC'
          ? 'no_space'
          : (err as NodeJS.ErrnoException)?.code === 'EACCES' ||
              (err as NodeJS.ErrnoException)?.code === 'EPERM'
            ? 'permission'
            : 'internal';
    log.error({ err, backup: id, failure }, 'backup failed');
    await rm(partial, { force: true }).catch(() => {});
    const [row] = await db
      .update(instanceBackup)
      .set({
        status: 'failed',
        failure,
        finishedAt: new Date(),
      })
      .where(eq(instanceBackup.id, id))
      .returning();
    return row ?? null;
  } finally {
    clearInterval(heartbeat);
  }
}

/** Keeps the newest `retention` successful backups; removes older archives and old rows. */
export async function applyBackupRetention(deps: Pick<BackupDeps, 'db' | 'storage' | 'dataDir'>) {
  const { db } = deps;
  const { retention } = await readBackupSettings(db);
  const kept = await db
    .select()
    .from(instanceBackup)
    .where(and(eq(instanceBackup.status, 'ready'), isNull(instanceBackup.removedAt)))
    .orderBy(desc(instanceBackup.startedAt));
  const old = kept.slice(retention);
  for (const row of old) {
    if (row.fileName) {
      await rm(join(backupsDir(deps.dataDir), row.fileName), { force: true });
      if (row.copiedToBucket)
        await deps.storage.remove([`${BUCKET_PREFIX}${row.fileName}`]).catch(() => {});
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
  await db
    .delete(instanceBackup)
    .where(lt(instanceBackup.startedAt, new Date(Date.now() - 180 * 86400 * 1000)));
  return { removed: old.length };
}

/** Counts rows of COPY text output: one line each, newlines inside values are escaped. */
function lineCounter(moved: () => void) {
  let lines = 0;
  // COPY sends one message per row: hand the zip 64 KiB pieces, not hundreds of thousands of
  // 200-byte ones (deflating those ran at a few MB/s).
  const BATCH = 64 * 1024;
  let pending: Buffer[] = [];
  let size = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, done) {
      moved();
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
  return { stream, lines: () => lines };
}

/**
 * postgres.js (3.4) pauses its socket when a COPY stream is full and resumes it only from
 * the stream's `read()`. When the COPY ends while the socket is paused, nothing resumes it
 * and the next query on the connection never gets its answer: the backup waited for ever
 * after the last large table. Once the stream has ended, its `read()` resumes the socket.
 */
export function resumeWhenDone(source: Readable): Readable {
  const resume = () => (source as Readable & { _read(size: number): void })._read(0);
  source.once('end', resume);
  source.once('close', resume);
  return source;
}

async function dumpDatabase(
  deps: BackupDeps,
  path: string,
  moved: () => void,
  signal: AbortSignal,
) {
  const journal = await readJournal(deps.migrationsFolder);
  const tagOf = new Map(journal.entries.map((e) => [String(e.when), e.tag]));
  // A connection of its own: when a COPY breaks off while its socket is paused for
  // backpressure, postgres.js never reads the end of the transaction. Destroying this
  // connection settles it, without touching the pool the rest of the server uses.
  const sql = postgres(deps.databaseUrl, { max: 1, onnotice: () => {} });
  const zip = writeZip(path);
  // A stalled dump (see runBackup) gives up its connection and its file.
  const stop = () => {
    void sql.end({ timeout: 0 });
    zip.abort();
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const result = await sql.begin('isolation level repeatable read read only', async (tx) => {
      try {
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
          const source = resumeWhenDone(
            ordered
              ? await tx.unsafe(`copy (${ordered(columns)}) to stdout`).readable()
              : await tx`copy ${tx(name)} (${tx(columns)}) to stdout`.readable(),
          );
          // piped: a COPY that fails mid-way must fail the backup, never leave it waiting.
          await zip.addStream(entry, piped(source, counter.stream));
          listed.push({ name, columns, rows: counter.lines(), entry });
        }
        // Every stored file: originals with their checksum, thumbnails by key.
        const files = await tx<{ key: string; size: string | null; sha256: string | null }[]>`
        select storage_key as key, size::text, sha256 from asset where status <> 'pending'
        union all
        select storage_key, null, null from asset_variant`;
        let bytes = 0;
        const lines = files.map((f) => {
          bytes += Number(f.size ?? 0);
          return JSON.stringify({
            key: f.key,
            size: f.size === null ? null : Number(f.size),
            sha256: f.sha256,
          });
        });
        await zip.addBuffer('files.jsonl', lines.length ? `${lines.join('\n')}\n` : '');
        const manifest: BackupManifest = {
          format: BACKUP_FORMAT,
          formatVersion: BACKUP_FORMAT_VERSION,
          appVersion: VERSION,
          createdAt: new Date().toISOString(),
          migrations,
          tables: listed,
          rebuilt: [...BACKUP_REBUILT_TABLES],
          files: { count: files.length, bytes, entry: 'files.jsonl' },
        };
        await zip.addJson('manifest.json', manifest);
        return { files: { count: files.length, bytes } };
      } catch (err) {
        void sql.end({ timeout: 0 });
        throw err;
      }
    });
    const size = await zip.close();
    return { size, ...result };
  } catch (err) {
    zip.abort();
    throw err;
  } finally {
    signal.removeEventListener('abort', stop);
    await sql.end({ timeout: 0 }).catch(() => {});
  }
}

// Restore --------------------------------------------------------------------

export interface RestoreReport {
  tables: number;
  rows: number;
  migrationsBefore: number;
  migrationsAfter: number;
  files: { listed: number; missing: number; examples: string[] };
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
 * newer version. Files are only checked against the manifest.
 */
export async function restoreBackup(opts: {
  file: string;
  databaseUrl: string;
  migrationsFolder: string;
  storage: Storage;
  tmpDir: string;
  log: Logger;
}): Promise<RestoreReport> {
  const zip = await readZip(opts.file, {
    entries: 10_000,
    totalBytes: Number.MAX_SAFE_INTEGER,
    compressionRatio: 10_000,
  });
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
      await runMigrations(opts.databaseUrl, folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    opts.log.info({ migrations: count }, 'schema of the backup ready');

    let rows = 0;
    const { sql: target } = createDatabase(opts.databaseUrl, 1);
    try {
      // The manifest lists tables in load order, self-referencing rows parents first.
      await target.begin(async (tx) => {
        for (const table of manifest.tables) {
          const name = table.name;
          const sink =
            await tx`copy ${tx(table.name)} (${tx(table.columns)}) from stdin`.writable();
          await pipeline(await zip.stream(table.entry, Number.MAX_SAFE_INTEGER), sink);
          rows += table.rows;
          opts.log.info({ table: name, rows: table.rows }, 'table restored');
        }
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

    const files = (await zip.buffer('files.jsonl', 1024 * 1024 * 1024))
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { key: string; size: number | null });
    const missing: string[] = [];
    for (let i = 0; i < files.length; i += 16) {
      await Promise.all(
        files.slice(i, i + 16).map(async (f) => {
          const size = await opts.storage.size(f.key).catch(() => null);
          if (size === null || (f.size !== null && size !== f.size)) missing.push(f.key);
        }),
      );
    }
    return {
      tables: manifest.tables.length,
      rows,
      migrationsBefore: count,
      migrationsAfter: local.length,
      files: { listed: files.length, missing: missing.length, examples: missing.slice(0, 10) },
    };
  } finally {
    zip.close();
  }
}

/** Removes `.partial` files left by a backup that was interrupted. */
export async function sweepPartialBackups(dataDir: string) {
  const dir = backupsDir(dataDir);
  for (const name of await readdir(dir).catch(() => [] as string[]))
    if (name.endsWith('.partial')) {
      const info = await stat(join(dir, name)).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 12 * 3600 * 1000)
        await rm(join(dir, name), { force: true });
    }
}
