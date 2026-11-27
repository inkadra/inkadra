import { join } from 'node:path';
import type { Logger } from 'pino';
import { createDatabase, type Database } from './db/client.ts';
import { inlineJobs } from './queues.ts';
import { localStorage } from './storage.ts';
import { settleBeforeRemoving, tempDir } from './test-tmpdir.ts';

/**
 * Storage in a fresh temporary directory, removed after the test file once the jobs, run
 * in-process, are done: a job still running (the files of a demo sandbox, say) writes there.
 */
export function testDeps(db: Database, log: Logger) {
  const root = tempDir('inkadra-test-');
  const storage = localStorage(join(root, 'files'));
  const jobs = inlineJobs({ db, storage, tmpDir: join(root, 'tmp'), heic: true }, log, {
    dataDir: root,
    uploadMaxSize: 0,
    importMaxSize: 1024 ** 3,
    migrationsFolder: join(import.meta.dirname, '..', 'drizzle'),
    backupDir: join(root, 'backups'),
    backupRemote: null,
    databaseUrl: process.env.DATABASE_URL ?? '',
  });
  settleBeforeRemoving(() => jobs.idle());
  return { root, storage, jobs };
}

/**
 * An empty database next to the one of `url`, named after it with `suffix`, for tests that
 * need a fresh instance (imports, restores). Dropped and created again on every call.
 */
export async function freshDatabase(url: string, suffix: string): Promise<string> {
  const target = new URL(url);
  const name = `${target.pathname.slice(1)}_${suffix}`.replace(/[^a-z0-9_]/gi, '_');
  const { sql } = createDatabase(url, 1);
  try {
    await sql.unsafe(`drop database if exists "${name}" with (force)`);
    await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end({ timeout: 1 });
  }
  target.pathname = `/${name}`;
  return target.toString();
}
