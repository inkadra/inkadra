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
    // Counts each update of a running total, for the tests of #879.
    await db.execute(q`create table storage_total_updates (xid bigint not null)`);
    await db.execute(q`create function count_storage_total_update() returns trigger
      language plpgsql as $$ begin insert into storage_total_updates values (txid_current());
      return null; end $$`);
    await db.execute(q`create trigger count_update after update on storage_total
      for each row execute function count_storage_total_update()`);
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
    const pending = async (userId: string) =>
      (
        await db.execute<{ n: string }>(
          q`select pending_bytes::text as n from storage_total where user_id = ${userId}`,
        )
      )[0]?.n;
    // A new file is still arriving; once processed it no longer counts as such.
    expect(await pending(anna)).toBe('1000');
    await db.update(asset).set({ status: 'ready' }).where(eq(asset.id, a));
    expect(await pending(anna)).toBe('0');
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

  it('updates each total once per statement, even for thousands of files (#879)', async () => {
    const [p] = await db.insert(project).values({ name: 'Big', position: 'a1' }).returning();
    const big = p?.id as string;
    const elena = await person();
    const fabio = await person();
    const ids = Array.from({ length: 3000 }, () => randomUUID());
    type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
    // Row versions of storage_total written by this transaction: one per owner and statement.
    const updates = async (tx: Tx) =>
      Number(
        (
          await tx.execute<{ n: string }>(
            q`select count(*)::text as n from storage_total_updates where xid = txid_current()`,
          )
        )[0]?.n,
      );
    const before = await reservedBytes(db);
    await db.transaction(async (tx) => {
      await tx.insert(asset).values(
        ids.map((id, i) => ({
          id,
          projectId: big,
          kind: 'image' as const,
          mime: 'image/jpeg',
          filename: 'a.jpg',
          size: 100,
          storageKey: `originals/${id}`,
          status: 'ready' as const,
          createdBy: i % 2 ? elena : fabio,
        })),
      );
      await tx.insert(assetVariant).values(
        ids.map((assetId) => ({
          assetId,
          size: '256' as const,
          width: 1,
          height: 1,
          storageKey: `variants/${assetId}`,
          bytes: 10,
        })),
      );
      await tx.insert(assetRendition).values(
        ids.map((assetId) => ({
          assetId,
          name: '480' as const,
          status: 'ready' as const,
          recipe: 'r',
          bytes: 1,
        })),
      );
      expect(await updates(tx)).toBeLessThanOrEqual(4);
    });
    expect(await reservedBytes(db, { userId: elena })).toBe(1500 * 110);
    expect(await reservedBytes(db, { userId: fabio })).toBe(1500 * 110);
    expect(await reservedBytes(db)).toBe(before + 3000 * 111);

    // The project goes with its files, their copies and rungs in the cascade.
    const started = Date.now();
    await db.transaction(async (tx) => {
      await tx.delete(project).where(eq(project.id, big));
      expect(await updates(tx)).toBeLessThanOrEqual(2);
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await reservedBytes(db, { userId: elena })).toBe(0);
    expect(await reservedBytes(db, { userId: fabio })).toBe(0);
    expect(await reservedBytes(db)).toBe(before);
    const [parked] = await db.execute<{ n: string }>(
      q`select count(*)::text as n from storage_total_gone`,
    );
    expect(parked?.n).toBe('0');
  }, 60_000);

  it('moves the files of a deleted person in one step', async () => {
    const gino = await person();
    await db.insert(asset).values(
      Array.from({ length: 2000 }, () => {
        const id = randomUUID();
        return {
          id,
          projectId,
          kind: 'image' as const,
          mime: 'image/jpeg',
          filename: 'a.jpg',
          size: 5,
          storageKey: `originals/${id}`,
          createdBy: gino,
        };
      }),
    );
    const before = await reservedBytes(db);
    await db.transaction(async (tx) => {
      await tx.delete(user).where(eq(user.id, gino));
      const [n] = await tx.execute<{ n: string }>(
        q`select count(*)::text as n from storage_total_updates where xid = txid_current()`,
      );
      expect(Number(n?.n)).toBeLessThanOrEqual(2);
    });
    expect(await reservedBytes(db)).toBe(before);
    const [row] = await db.execute<{ n: string }>(
      q`select count(*)::text as n from storage_total where user_id = ${gino}`,
    );
    expect(row?.n).toBe('0');
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
