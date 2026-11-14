import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupManifest } from '@inkadra/shared';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  applyBackupRetention,
  backupBeforeMigrating,
  backupsDir,
  liveTableBytes,
  PRE_UPGRADE_KEEP,
  PRE_UPGRADE_REUSE_MS,
  preUpgradeSpaceNeeded,
  restoreBackup,
  toBackup,
} from './backup.ts';
import { createDatabase, runMigrations, waitForMigrations } from './db/client.ts';
import { auditEvent, instanceBackup } from './db/schema.ts';
import { startingListener } from './http/starting.ts';
import { localStorage } from './storage.ts';
import { freshDatabase } from './test-deps.ts';
import { readZip } from './transfers/zip.ts';

const url = process.env.DATABASE_URL;
const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
const log = pino({ level: 'silent' });

/** A migrations folder with the first `count` migrations of this build (the last if -1). */
function migrationsUpTo(count: number, broken = false) {
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
  const total = journal.entries.length as number;
  journal.entries = journal.entries.slice(0, count < 0 ? total + count : count);
  const older = mkdtempSync(join(tmpdir(), 'older-'));
  mkdirSync(join(older, 'meta'));
  writeFileSync(join(older, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    copyFileSync(join(folder, `${e.tag}.sql`), join(older, `${e.tag}.sql`));
  // A last migration that fails, for the start that cannot migrate.
  const last = journal.entries.at(-1);
  if (broken && last) writeFileSync(join(older, `${last.tag}.sql`), 'select from no_such_table;');
  return { older, count: journal.entries.length as number, total };
}

/** The migrations of the previous release: every one but the last. */
const olderFolder = () => migrationsUpTo(-1);

/** Migrations of releases an upgrade may start from (docs/self-hosting/upgrades.md). */
const RELEASES = { '0.6.0': 15, '0.8.0': 27 };

function deps(databaseUrl: string, dataDir = mkdtempSync(join(tmpdir(), 'pre-upgrade-'))) {
  return {
    databaseUrl,
    dataDir,
    storage: localStorage(join(mkdtempSync(join(tmpdir(), 'pre-upgrade-files-')), 'files')),
    migrationsFolder: folder,
    bucket: false,
    log,
  };
}

async function applied(databaseUrl: string) {
  const { sql } = createDatabase(databaseUrl, 1);
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from drizzle.__drizzle_migrations`;
    return row?.n;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

it('asks for about half the table data free, plus a margin', () => {
  expect(preUpgradeSpaceNeeded(0)).toBe(64 * 1024 * 1024);
  expect(preUpgradeSpaceNeeded(1024 ** 3)).toBe(512 * 1024 ** 2 + 64 * 1024 ** 2);
});

it('answers alive, not ready, while the server starts', async () => {
  const starting = await startingListener({
    host: '127.0.0.1',
    port: 0,
    reason: 'migrations',
    live: ['/livez'],
  });
  try {
    const at = (path: string) => fetch(`http://127.0.0.1:${starting.port}${path}`);
    expect((await at('/livez')).status).toBe(200);
    const ready = await at('/readyz');
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: 'starting', reason: 'migrations' });
    expect((await at('/api/v1/health')).status).toBe(503);
    expect((await at('/')).status).toBe(503);
  } finally {
    await starting.close();
  }
});

/** Archives written before an upgrade in a data folder. */
const archives = (dataDir: string) =>
  readdirSync(backupsDir(dataDir)).filter((n) => n.startsWith('inkadra-backup-pre-upgrade-'));

describe.skipIf(!url)('backup before migrations (#805, needs DATABASE_URL)', () => {
  it('takes none on a fresh database, nor when nothing is pending', async () => {
    const fresh = await freshDatabase(url ?? '', 'pre_upgrade_fresh');
    const step = vi.fn(async () => undefined);
    await runMigrations(fresh, folder, { beforeMigrating: step });
    await runMigrations(fresh, folder, { beforeMigrating: step });
    expect(step).not.toHaveBeenCalled();
  });

  it('backs up the older database, then migrates and lists it', async () => {
    const { older, count, total } = olderFolder();
    const fresh = await freshDatabase(url ?? '', 'pre_upgrade_pending');
    await runMigrations(fresh, older);
    const d = deps(fresh);
    await runMigrations(fresh, folder, { beforeMigrating: backupBeforeMigrating(d) });
    expect(await applied(fresh)).toBe(total);

    const { db, sql } = createDatabase(fresh, 1);
    try {
      const rows = await db.select().from(instanceBackup);
      expect(rows).toHaveLength(1);
      const listed = toBackup(rows[0] as (typeof rows)[number]);
      expect(listed).toMatchObject({
        trigger: 'scheduled',
        beforeUpgrade: true,
        status: 'ready',
        verification: { complete: true, missingFiles: 0 },
      });
      const file = join(backupsDir(d.dataDir), listed.fileName ?? '');
      expect(existsSync(file)).toBe(true);
      // Written on the schema the previous version left: a restore with it builds that one.
      const zip = await readZip(file, { entries: 10_000, totalBytes: 1e12, compressionRatio: 1e4 });
      try {
        const manifest = await zip.json('manifest.json', BackupManifest, 1e8);
        expect(manifest.migrations).toHaveLength(count);
      } finally {
        zip.close();
      }
      const audit = await db.select().from(auditEvent).where(eq(auditEvent.targetId, listed.id));
      expect(audit[0]).toMatchObject({ action: 'backup.started', actorId: null });
      expect(audit[0]?.details).toMatchObject({ kind: 'pre-upgrade', pending: 1 });
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('migrates nothing when the backup fails', async () => {
    const { older, count } = olderFolder();
    const fresh = await freshDatabase(url ?? '', 'pre_upgrade_failed');
    await runMigrations(fresh, older);
    // The backups folder cannot be made: its parent is a file.
    const blocked = join(mkdtempSync(join(tmpdir(), 'pre-upgrade-')), 'file');
    writeFileSync(blocked, '');
    await expect(
      runMigrations(fresh, folder, {
        beforeMigrating: backupBeforeMigrating(deps(fresh, blocked)),
      }),
    ).rejects.toThrow(/backup before the database upgrade failed.*SKIP_PRE_MIGRATION_BACKUP/s);
    expect(await applied(fresh)).toBe(count);
    // The escape hatch: migrates without it.
    await runMigrations(fresh, folder, {
      beforeMigrating: backupBeforeMigrating(deps(fresh, blocked), { skip: true }),
    });
    expect(await applied(fresh)).toBe(count + 1);
  });

  it('keeps the newest backups before an upgrade apart from the nightly retention', async () => {
    const fresh = await freshDatabase(url ?? '', 'pre_upgrade_retention');
    await runMigrations(fresh, folder);
    const d = deps(fresh);
    const { db, sql } = createDatabase(fresh, 1);
    try {
      const day = 86400 * 1000;
      const row = (trigger: 'scheduled' | 'pre-upgrade', daysAgo: number) => ({
        trigger,
        status: 'ready' as const,
        fileName: `${trigger}-${daysAgo}.zip`,
        startedAt: new Date(Date.now() - daysAgo * day),
      });
      await db
        .insert(instanceBackup)
        .values([
          row('pre-upgrade', 300),
          row('pre-upgrade', 40),
          row('pre-upgrade', 20),
          ...Array.from({ length: 9 }, (_, i) => row('scheduled', i)),
        ]);
      await applyBackupRetention({ ...d, db });
      const kept = await db.select().from(instanceBackup);
      const live = kept.filter((r) => !r.removedAt);
      expect(live.filter((r) => r.trigger === 'pre-upgrade').map((r) => r.fileName)).toEqual(
        expect.arrayContaining(['pre-upgrade-40.zip', 'pre-upgrade-20.zip']),
      );
      expect(live.filter((r) => r.trigger === 'pre-upgrade')).toHaveLength(PRE_UPGRADE_KEEP);
      expect(live.filter((r) => r.trigger === 'scheduled')).toHaveLength(7);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
  for (const [release, count] of Object.entries(RELEASES))
    it(`backs up a ${release} database, which restores (${count} migrations)`, async () => {
      const { older } = migrationsUpTo(count);
      const fresh = await freshDatabase(url ?? '', `pre_upgrade_${release.replaceAll('.', '_')}`);
      // The schema of that release: its data steps are not this version's.
      await runMigrations(fresh, older, { schemaOnly: true });
      const { sql } = createDatabase(fresh, 1);
      try {
        await sql`insert into "user" (name, email) values ('Old', 'old@example.com')`;
      } finally {
        await sql.end({ timeout: 1 });
      }
      const d = deps(fresh);
      await runMigrations(fresh, folder, { beforeMigrating: backupBeforeMigrating(d) });
      const [name] = archives(d.dataDir);
      expect(name).toMatch(new RegExp(`^inkadra-backup-pre-upgrade-m${count}-`));
      const target = await freshDatabase(
        url ?? '',
        `pre_upgrade_${release.replaceAll('.', '_')}_r`,
      );
      const report = await restoreBackup({
        file: join(backupsDir(d.dataDir), name ?? ''),
        databaseUrl: target,
        migrationsFolder: folder,
        storage: d.storage,
        tmpDir: join(d.dataDir, 'tmp'),
        log,
      });
      expect(report.migrationsBefore).toBe(count);
      expect(report.rows).toBeGreaterThan(0);
    });

  it('a start whose migrations fail reuses its backup and logs the migration error', async () => {
    const { older } = olderFolder();
    const fresh = await freshDatabase(url ?? '', 'pre_upgrade_loop');
    await runMigrations(fresh, older);
    const { older: broken } = migrationsUpTo(Number.POSITIVE_INFINITY, true);
    const d = { ...deps(fresh), bucket: true };
    const step = { beforeMigrating: backupBeforeMigrating(d) };
    // A restart loop: each start fails on the migration itself, never on a second backup.
    for (let i = 0; i < 3; i++)
      await expect(runMigrations(fresh, broken, step)).rejects.toThrow(
        /no_such_table|Failed query/,
      );
    expect(archives(d.dataDir)).toHaveLength(1);
    // Past the reuse window a new copy replaces it: one per schema state.
    const [first] = archives(d.dataDir);
    const old = new Date(Date.now() - PRE_UPGRADE_REUSE_MS - 60_000);
    utimesSync(join(backupsDir(d.dataDir), first ?? ''), old, old);
    writeFileSync(join(backupsDir(d.dataDir), 'inkadra-backup-pre-upgrade-m1-x.zip.partial'), '');
    await expect(runMigrations(fresh, broken, step)).rejects.toThrow(/no_such_table|Failed query/);
    // The `.partial` of a killed start is gone too.
    const now = archives(d.dataDir);
    expect(now).toHaveLength(1);
    expect(now[0]).not.toBe(first);
    // The replaced archive's bucket copy goes with it; the new one is in the bucket.
    expect(await d.storage.size(`backups/${first}`)).toBeNull();
    expect(await d.storage.size(`backups/${now[0]}`)).not.toBeNull();
    // Fixed: it migrates, and the history lists the archive the failed starts left.
    await runMigrations(fresh, folder, step);
    const { db, sql } = createDatabase(fresh, 1);
    try {
      const rows = await db.select().from(instanceBackup);
      expect(rows.map((r) => [r.trigger, r.fileName])).toEqual([['pre-upgrade', now[0]]]);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('estimates live table data at most as the tables', async () => {
    const fresh = await freshDatabase(url ?? '', 'pre_upgrade_estimate');
    await runMigrations(fresh, folder);
    const { sql } = createDatabase(fresh, 1);
    try {
      await sql`insert into "user" (name, email)
        select 'U' || i, 'u' || i || '@example.com' from generate_series(1, 2000) i`;
      await sql`delete from "user" where name <> 'U1'`;
      await sql`analyze "user"`;
      const [all] = await sql<{ n: string }[]>`
        select sum(pg_table_size(c.oid))::text as n from pg_class c
        join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r'`;
      const live = await liveTableBytes(sql);
      expect(live).toBeGreaterThan(0);
      expect(live).toBeLessThanOrEqual(Number(all?.n));
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('a collab or worker role waits for the migrations of the web role', async () => {
    const { older } = olderFolder();
    const fresh = await freshDatabase(url ?? '', 'pre_upgrade_wait');
    await runMigrations(fresh, older);
    let done = false;
    const waiting = waitForMigrations(fresh, folder, log, 50).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false);
    await runMigrations(fresh, folder);
    await waiting;
    expect(done).toBe(true);
  });
});
