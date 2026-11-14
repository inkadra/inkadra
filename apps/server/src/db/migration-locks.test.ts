import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Migrations run in one transaction when the server starts (#805): a statement that rewrites
 * or scans an existing table holds its lock, and blocks the instance, until every pending
 * migration is done. Such a statement needs a `-- lock-ok: <why>` comment in front of it (the
 * table is small, or a new one), so the cost is decided, not found by customers.
 * Migrations up to BASELINE were released before this check and are left as they are.
 */
const BASELINE = 52;

const HEAVY: [RegExp, string][] = [
  [
    /^create\s+(?:unique\s+)?index\s+(?!concurrently)(?:if not exists\s+)?"?\w+"?\s+on\s+"?(?<table>\w+)"?/i,
    'index build blocks writes',
  ],
  [
    /^alter\s+table\s+"?(?<table>\w+)"?\s+add\s+constraint\s+(?!.*not valid).*\b(?:foreign key|check|unique|primary key)\b/is,
    'constraint scans the table',
  ],
  [
    /^alter\s+table\s+"?(?<table>\w+)"?\s+alter\s+column\s+"?\w+"?\s+(?:set\s+data\s+)?type\b/i,
    'type change rewrites the table',
  ],
  [
    /^alter\s+table\s+"?(?<table>\w+)"?\s+alter\s+column\s+"?\w+"?\s+set\s+not\s+null/i,
    'NOT NULL scans the table',
  ],
  [
    /^alter\s+table\s+"?(?<table>\w+)"?\s+add\s+column\b.*\bdefault\s+(?:gen_random_uuid|random|clock_timestamp)\s*\(/is,
    'volatile default rewrites the table',
  ],
];

/** The statements of a migration that lock an existing table, without a `-- lock-ok:` reason. */
function heavyLocks(sqlText: string): string[] {
  const created = new Set(
    [...sqlText.matchAll(/create\s+table\s+(?:if not exists\s+)?"?(\w+)"?/gi)].map((m) =>
      (m[1] ?? '').toLowerCase(),
    ),
  );
  const found: string[] = [];
  for (const chunk of sqlText.split('--> statement-breakpoint')) {
    if (/--\s*lock-ok:/i.test(chunk)) continue;
    const statement = chunk
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim();
    for (const [pattern, why] of HEAVY) {
      const table = statement.match(pattern)?.groups?.table;
      if (table && !created.has(table.toLowerCase()))
        found.push(`${why}: ${statement.split('\n')[0]?.slice(0, 120)}`);
    }
  }
  return found;
}

describe('migration locks (#805)', () => {
  it('finds the statements that lock an existing table, unless a reason is given', () => {
    expect(heavyLocks('CREATE INDEX "a_idx" ON "asset" USING btree ("x");')).toHaveLength(1);
    expect(
      heavyLocks('-- lock-ok: a few rows\nCREATE INDEX "a_idx" ON "asset" USING btree ("x");'),
    ).toEqual([]);
    expect(
      heavyLocks(
        'CREATE TABLE "fresh" ("id" uuid);--> statement-breakpoint\nCREATE INDEX "f_idx" ON "fresh" ("id");',
      ),
    ).toEqual([]);
    expect(
      heavyLocks('ALTER TABLE "board" ALTER COLUMN "title" SET NOT NULL;'),
    ).toHaveLength(1);
    expect(
      heavyLocks(
        'ALTER TABLE "asset" ADD CONSTRAINT "c" FOREIGN KEY ("u") REFERENCES "user"("id") NOT VALID;',
      ),
    ).toEqual([]);
    expect(heavyLocks('ALTER TABLE "board_doc" ADD COLUMN "tasks" jsonb;')).toEqual([]);
  });

  it('every migration after the baseline gives a reason for each heavy lock', () => {
    const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
    const problems = readdirSync(folder)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > BASELINE)
      .flatMap((f) =>
        heavyLocks(readFileSync(join(folder, f), 'utf8')).map((p) => `${f}: ${p}`),
      );
    expect(problems).toEqual([]);
  });
});
