import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database, runMigrations } from './db/client.ts';
import { asset, pendingFileDeletion, project, projectTransfer, user } from './db/schema.ts';
import { assetIdOf, DELETION_GRACE_MS, recordDeletions, sweepDeletions } from './file-deletions.ts';
import { removeFilesLater } from './queues.ts';
import type { Storage } from './storage.ts';
import { freshDatabase, testDeps } from './test-deps.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

it('reads the asset of a storage key', () => {
  const id = randomUUID();
  expect(assetIdOf(`originals/${id}`)).toBe(id);
  expect(assetIdOf(`variants/${id}/256.webp`)).toBe(id);
  expect(assetIdOf(`feedback/${id}`)).toBeNull();
  expect(assetIdOf(`originals/${id}.info`)).toBeNull();
});

describe.skipIf(!url)('recorded file removals (needs DATABASE_URL)', () => {
  // Its own database: an import running in another test file would pause the sweep.
  let db: Database;
  let sql: { end: () => Promise<void> };
  const log = pino({ level: 'silent' });
  let storage: Storage;
  const keysIn = async (keys: string[]) =>
    (
      await db
        .select({ key: pendingFileDeletion.key })
        .from(pendingFileDeletion)
        .where(inArray(pendingFileDeletion.key, keys))
    ).map((r) => r.key);
  const write = (key: string) => storage.write(key, Buffer.from('x'), 'text/plain');

  beforeAll(async () => {
    const own = await freshDatabase(url as string, 'file_deletions');
    await runMigrations(own, migrationsFolder);
    ({ db, sql } = createDatabase(own));
    ({ storage } = testDeps(db, log));
  });
  afterAll(() => sql.end());

  it('removes the files when the queue does not answer (#758)', async () => {
    const key = `feedback/${randomUUID()}`;
    await write(key);
    await recordDeletions(db, [key]);
    const started = Date.now();
    await removeFilesLater(
      { db, jobs: { deleteFiles: () => new Promise(() => {}) }, storage },
      [key],
      log,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await storage.size(key)).toBeNull();
    expect(await keysIn([key])).toEqual([]);
  });

  it('sweeps removals a day old, keeping the files of assets that exist again (#801)', async () => {
    const [p] = await db.insert(project).values({ name: 'Sweep', position: 'a0' }).returning();
    const live = randomUUID();
    await db.insert(asset).values({
      id: live,
      projectId: p?.id as string,
      kind: 'file',
      mime: 'text/plain',
      filename: 'a.txt',
      size: 1,
      storageKey: `originals/${live}`,
    });
    const gone = `originals/${randomUUID()}`;
    const fresh = `variants/${randomUUID()}/256.webp`;
    const kept = `originals/${live}`;
    for (const key of [gone, fresh, kept]) await write(key);
    await recordDeletions(db, [gone, fresh, kept]);
    const old = new Date(Date.now() - DELETION_GRACE_MS - 60_000);
    await db
      .update(pendingFileDeletion)
      .set({ createdAt: old })
      .where(inArray(pendingFileDeletion.key, [gone, kept]));

    // An import running: its files are recorded before its rows exist, so nothing goes.
    const [u] = await db
      .insert(user)
      .values({ name: 'Sweep', email: `${randomUUID()}@example.com` })
      .returning();
    const [t] = await db
      .insert(projectTransfer)
      .values({ kind: 'import', status: 'running', userId: u?.id as string, projectName: 'In' })
      .returning();
    expect(await sweepDeletions(db, storage)).toBe(0);
    expect(await storage.size(gone)).not.toBeNull();
    await db.delete(projectTransfer).where(eq(projectTransfer.id, t?.id as string));

    expect(await sweepDeletions(db, storage)).toBeGreaterThanOrEqual(1);
    expect(await storage.size(gone)).toBeNull();
    expect(await storage.size(kept)).not.toBeNull();
    expect(await storage.size(fresh)).not.toBeNull();
    expect(await keysIn([gone, fresh, kept])).toEqual([fresh]);
  });
});
