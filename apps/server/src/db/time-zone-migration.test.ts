import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { describe, expect, it } from 'vitest';
import { freshDatabase } from '../test-deps.ts';
import { createDatabase } from './client.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('migration 0036 (needs DATABASE_URL)', () => {
  it('turns the old default UTC into an unset zone and keeps every other zone', async () => {
    const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
    // The migrations up to 0035, as a database made before this one has them.
    const before = mkdtempSync(join(tmpdir(), 'inkadra-0036-'));
    cpSync(folder, before, { recursive: true });
    const journal = JSON.parse(readFileSync(join(before, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 36);
    writeFileSync(join(before, 'meta/_journal.json'), JSON.stringify(journal));
    const { db, sql: client } = createDatabase(await freshDatabase(url ?? '', 'tz0036'), 1);
    try {
      await migrate(db, { migrationsFolder: before });
      await db.execute(sql`
        insert into project (name, position, time_zone) values
          ('Default', 'a0', default), ('Rome', 'a1', 'Europe/Rome')`);
      await migrate(db, { migrationsFolder: folder });
      const rows = await db.execute<{ name: string; time_zone: string | null }>(
        sql`select name, time_zone from project order by name`,
      );
      expect([...rows]).toEqual([
        { name: 'Default', time_zone: null },
        { name: 'Rome', time_zone: 'Europe/Rome' },
      ]);
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
