import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { mergeCastLinks } from '../cast-crew.ts';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(url: string, max = 10) {
  const sql = postgres(url, { max, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql };
}

export async function runMigrations(url: string, migrationsFolder: string) {
  const { db, sql } = createDatabase(url, 1);
  try {
    await migrate(db, { migrationsFolder });
    // Data that only code can move: the old board cast links become crew rows (decision 0091).
    await mergeCastLinks(db);
  } finally {
    await sql.end();
  }
}
