import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  PRE_UPGRADE_KEEP,
  preUpgradeSpaceNeeded,
  toBackup,
} from './backup.ts';
import { createDatabase, runMigrations } from './db/client.ts';
import { auditEvent, instanceBackup } from './db/schema.ts';
import { localStorage } from './storage.ts';
import { freshDatabase } from './test-deps.ts';
import { readZip } from './transfers/zip.ts';

const url = process.env.DATABASE_URL;
const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
const log = pino({ level: 'silent' });

/** The migrations of the previous release: every one but the last. */
function olderFolder() {
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, -1);
  const older = mkdtempSync(join(tmpdir(), 'older-'));
  mkdirSync(join(older, 'meta'));
  writeFileSync(join(older, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    copyFileSync(join(folder, `${e.tag}.sql`), join(older, `${e.tag}.sql`));
  return { older, count: journal.entries.length as number, total: journal.entries.length + 1 };
}

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
});
