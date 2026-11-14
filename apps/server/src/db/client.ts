import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { mergeCastLinks } from '../cast-crew.ts';
import { moveToProductionBoards } from '../production.ts';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(url: string, max = 10) {
  const sql = postgres(url, { max, onnotice: () => {} });
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
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => {} });
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
    await migrate(db, { migrationsFolder });
    // Data that only code can move: the old board cast links become crew rows (decision 0091).
    await mergeCastLinks(db);
    // Every project's days go to its Production board (decision 0123); per project, never fatal.
    if (opts.productionBoards) await moveToProductionBoards(db, opts.log);
  } finally {
    await sql.end();
  }
}
