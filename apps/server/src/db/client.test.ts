import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freshDatabase } from '../test-deps.ts';
import { createDatabase, runMigrations } from './client.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('runMigrations (needs DATABASE_URL)', () => {
  it('lets two processes that start together take turns (#807)', async () => {
    const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
    const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
    const fresh = await freshDatabase(url ?? '', 'concurrent_start');
    // Without a lock the second fails on a table the first just created.
    await Promise.all([runMigrations(fresh, folder), runMigrations(fresh, folder)]);
    const { sql } = createDatabase(fresh, 1);
    try {
      const [row] = await sql<
        { n: number }[]
      >`select count(*)::int as n from drizzle.__drizzle_migrations`;
      expect(row?.n).toBe(journal.entries.length);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});
