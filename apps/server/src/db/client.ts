import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { mergeCastLinks } from '../cast-crew.ts';
import { moveToProductionBoards } from '../production.ts';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof createDatabase>['db'];

/** Per-session limits of a pool (#800), in milliseconds; 0 or unset keeps Postgres's (none). */
export interface DatabaseTimeouts {
  statementMs?: number;
  lockMs?: number;
  idleInTransactionMs?: number;
}

/** Startup parameters for postgres.js: only the limits that are set. */
export function sessionLimits(t: DatabaseTimeouts = {}) {
  const out: Record<string, number> = {};
  if (t.statementMs) out.statement_timeout = t.statementMs;
  if (t.lockMs) out.lock_timeout = t.lockMs;
  if (t.idleInTransactionMs) out.idle_in_transaction_session_timeout = t.idleInTransactionMs;
  return out;
}

/**
 * Startup parameters of connections that must never be cut (#879): migrations, backups,
 * restores and CLI commands. Explicit, so limits configured on the database role (as behind
 * PgBouncer) do not reach them.
 */
export const UNLIMITED_SESSION = {
  statement_timeout: 0,
  lock_timeout: 0,
  idle_in_transaction_session_timeout: 0,
};

/** A pool with the server's limits (`timeouts`), or without any when they are not given. */
export function createDatabase(url: string, max = 10, timeouts?: DatabaseTimeouts) {
  const sql = postgres(url, {
    max,
    onnotice: () => {},
    ...(timeouts
      ? // Idle connections close after a minute; a database that does not answer fails in 10 s.
        { idle_timeout: 60, connect_timeout: 10, connection: sessionLimits(timeouts) }
      : { connection: UNLIMITED_SESSION }),
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql };
}

/** Session lock key that serializes the start of every process on one database (#807). */
const MIGRATION_LOCK = 10894;

/**
 * Applies the migrations and the data steps only code can do. Processes starting together take
 * turns on an advisory lock: Drizzle's migrator takes none, so two replicas would apply the same
 * migrations at once and the second would fail with "already exists". `productionBoards` runs the move
 * of decision 0123 too: the server's start passes it (PRODUCTION_BOARD_MOVE), a backup restore
 * on a partial schema does not.
 */
export async function runMigrations(
  url: string,
  migrationsFolder: string,
  opts: { productionBoards?: boolean; log?: Parameters<typeof moveToProductionBoards>[1] } = {},
) {
  // One connection (max 1) that is never recycled: the session lock holds until sql.end() below.
  const sql = postgres(url, {
    max: 1,
    max_lifetime: null,
    onnotice: () => {},
    // Building an index or a backfill on a large instance may take minutes.
    connection: UNLIMITED_SESSION,
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  try {
    const [free] = await sql`select pg_try_advisory_lock(${MIGRATION_LOCK}) as locked`;
    if (!free?.locked) {
      opts.log?.info(
        { lock: MIGRATION_LOCK },
        'another process is migrating the database: waiting',
      );
      await sql`select pg_advisory_lock(${MIGRATION_LOCK})`;
    }
    await refuseNewerDatabase(sql, migrationsFolder);
    await migrate(db, { migrationsFolder });
    // Data that only code can move: the old board cast links become crew rows (decision 0091).
    await mergeCastLinks(db);
    // Every project's days go to its Production board (decision 0123); per project, never fatal.
    if (opts.productionBoards) await moveToProductionBoards(db, opts.log);
  } finally {
    await sql.end();
  }
}

/**
 * Refuses a database that a newer Inkadra migrated (#805). Drizzle's migrator only applies what
 * is newer than the last applied migration, so an older server would otherwise start on a schema
 * it does not know. The way back is the backup taken before the upgrade (upgrades.md).
 */
async function refuseNewerDatabase(sql: postgres.Sql, migrationsFolder: string) {
  const [table] = await sql<{ ok: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as ok`;
  if (!table?.ok) return;
  const [applied] = await sql<{ n: number; last: string | null }[]>`
    select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`;
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { when: number }[] };
  const known = journal.entries.length;
  const newest = Math.max(0, ...journal.entries.map((e) => e.when));
  if (applied && applied.last !== null && Number(applied.last) > newest)
    throw new Error(
      `This database was migrated by a newer Inkadra (${applied.n} migrations applied, this ` +
        `version knows ${known}). Start that newer version again, or go back by restoring the ` +
        'backup taken before the upgrade into a new, empty database with this version: see ' +
        'https://github.com/inkadra/inkadra/blob/main/docs/self-hosting/upgrades.md#going-back-to-an-older-version',
    );
}
