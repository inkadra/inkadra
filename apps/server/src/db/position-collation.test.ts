import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { describe, expect, it } from 'vitest';
import { freshDatabase } from '../test-deps.ts';
import { createDatabase } from './client.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('position columns (needs DATABASE_URL)', () => {
  it('order fractional-index keys by bytes, whatever the database collation', async () => {
    const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
    const { db, sql: client } = createDatabase(await freshDatabase(url ?? '', 'poscoll'), 1);
    try {
      await migrate(db, { migrationsFolder: folder });
      const columns = await db.execute<{ table_name: string; collation_name: string | null }>(sql`
        select table_name, collation_name from information_schema.columns
        where table_schema = 'public' and column_name = 'position' and data_type = 'text'
        order by table_name`);
      expect([...columns]).toEqual(
        ['board', 'project', 'project_group', 'project_group_item'].map((table_name) => ({
          table_name,
          collation_name: 'C',
        })),
      );
      // fractional-indexing has 'a0V' < 'a0l'; a linguistic collation folds case and swaps them.
      await db.execute(sql`
        insert into project (name, position) values ('l', 'a0l'), ('V', 'a0V'), ('1', 'a1'), ('0', 'a0')`);
      const rows = await db.execute<{ position: string }>(
        sql`select position from project order by position`,
      );
      expect(rows.map((r) => r.position)).toEqual(['a0', 'a0V', 'a0l', 'a1']);
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
