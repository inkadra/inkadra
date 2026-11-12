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

/**
 * Applies the migrations and the data steps only code can do. `productionBoards` runs the move
 * of decision 0123 too: the server's start passes it (PRODUCTION_BOARD_MOVE), a backup restore
 * on a partial schema does not.
 */
export async function runMigrations(
  url: string,
  migrationsFolder: string,
  opts: { productionBoards?: boolean; log?: Parameters<typeof moveToProductionBoards>[1] } = {},
) {
  const { db, sql } = createDatabase(url, 1);
  try {
    await migrate(db, { migrationsFolder });
    // Data that only code can move: the old board cast links become crew rows (decision 0091).
    await mergeCastLinks(db);
    // Every project's days go to its Production board (decision 0123); per project, never fatal.
    if (opts.productionBoards) await moveToProductionBoards(db, opts.log);
  } finally {
    await sql.end();
  }
}
