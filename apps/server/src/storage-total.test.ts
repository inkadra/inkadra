import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, sql as q } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database, runMigrations } from './db/client.ts';
import { asset, assetRendition, assetVariant, project, user } from './db/schema.ts';
import { reconcileStorageTotals, reservedBytes } from './storage-limits.ts';
import { freshDatabase } from './test-deps.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

describe.skipIf(!url)('running storage totals (#799, needs DATABASE_URL)', () => {
  let db: Database;
  let end: () => Promise<void>;
  let projectId: string;

  beforeAll(async () => {
    const own = await freshDatabase(url as string, 'storage_total');
    await runMigrations(own, migrationsFolder);
    const created = createDatabase(own, 2);
    db = created.db;
    end = () => created.sql.end();
    const [p] = await db.insert(project).values({ name: 'Usage', position: 'a0' }).returning();
    projectId = p?.id as string;
  });
  afterAll(() => end());

  const person = async () => {
    const [u] = await db
      .insert(user)
      .values({ name: 'U', email: `${randomUUID()}@example.com` })
      .returning();
    return u?.id as string;
  };
  const file = async (createdBy: string, size: number) => {
    const id = randomUUID();
    await db.insert(asset).values({
      id,
      projectId,
      kind: 'video',
      mime: 'video/mp4',
      filename: 'a.mp4',
      size,
      storageKey: `originals/${id}`,
      createdBy,
    });
    return id;
  };

  it('follows files, copies and rungs through inserts, moves and deletes', async () => {
    const anna = await person();
    const bruno = await person();
    const a = await file(anna, 1000);
    await db
      .insert(assetVariant)
      .values({ assetId: a, size: '256', width: 1, height: 1, storageKey: 'v', bytes: 50 });
    await db
      .insert(assetRendition)
      .values({ assetId: a, name: '480', status: 'ready', recipe: 'r', bytes: 300 });
    expect(await reservedBytes(db, { userId: anna })).toBe(1050);
    expect(await reservedBytes(db)).toBe(1350);
    // Finishing an upload weighs it without itself.
    expect(await reservedBytes(db, { userId: anna, exclude: a })).toBe(0);
    expect(await reservedBytes(db, { exclude: a })).toBe(0);

    await db.update(asset).set({ size: 1200 }).where(eq(asset.id, a));
    expect(await reservedBytes(db, { userId: anna })).toBe(1250);
    await db.update(asset).set({ createdBy: bruno }).where(eq(asset.id, a));
    expect(await reservedBytes(db, { userId: anna })).toBe(0);
    expect(await reservedBytes(db, { userId: bruno })).toBe(1250);

    // The copies go with the file in the cascade, counted once.
    await db.delete(asset).where(eq(asset.id, a));
    expect(await reservedBytes(db, { userId: bruno })).toBe(0);
    expect(await reservedBytes(db)).toBe(0);
  });

  it('keeps the files of a deleted person in the instance total', async () => {
    const carla = await person();
    await file(carla, 700);
    const before = await reservedBytes(db);
    await db.delete(user).where(eq(user.id, carla));
    expect(await reservedBytes(db)).toBe(before);
  });

  it('heals a total that drifted', async () => {
    const dario = await person();
    await file(dario, 400);
    await db.execute(q`update storage_total set bytes = 5 where user_id = ${dario}`);
    expect((await reconcileStorageTotals(db)).corrected).toBe(1);
    expect(await reservedBytes(db, { userId: dario })).toBe(400);
    expect((await reconcileStorageTotals(db)).corrected).toBe(0);
  });
});
