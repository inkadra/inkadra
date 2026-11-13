import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations } from './db/client.ts';
import { asset, assetRendition, assetVariant, project } from './db/schema.ts';
import type { Jobs } from './jobs.ts';
import {
  BACKFILL_BLOCK,
  countNeeding,
  readBackfill,
  startBackfill,
  stepBackfill,
  stopBackfill,
} from './video-backfill.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const RECIPE = 'h264/balanced/1';

describe.skipIf(!url)('video backfill (needs DATABASE_URL)', () => {
  const { db, sql: client } = createDatabase(url ?? 'postgres://unused', 2);
  let projectId = '';
  const video = async (fields: Partial<typeof asset.$inferInsert>) => {
    const id = randomUUID();
    await db.insert(asset).values({
      id,
      projectId,
      kind: 'video',
      mime: 'video/quicktime',
      filename: 'clip.mov',
      size: 10_000_000,
      storageKey: `originals/${id}`,
      status: 'ready',
      width: 3840,
      height: 2160,
      durationMs: 60_000,
      frameRate: 25,
      videoCodec: 'prores',
      ...fields,
    });
    return id;
  };

  beforeAll(async () => {
    await runMigrations(url ?? '', migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    const [p] = await db.insert(project).values({ name: 'Videos', position: 'a0' }).returning();
    projectId = p?.id ?? '';
  });
  afterAll(() => client.end());

  it('chooses missing and outdated copies, never a light remux', async () => {
    const skipped = await video({ proxyStatus: 'skipped' });
    const old = await video({ proxyStatus: 'ready' });
    await db.insert(assetVariant).values({
      assetId: old,
      size: 'proxy',
      width: 1920,
      height: 1080,
      storageKey: `variants/${old}/proxy.mp4`,
      mime: 'video/mp4',
    });
    const remux = await video({ proxyStatus: 'ready', videoCodec: 'h264', width: 1920, height: 1080 });
    await db.insert(assetVariant).values({
      assetId: remux,
      size: 'proxy',
      width: 1920,
      height: 1080,
      storageKey: `variants/${remux}/proxy.mp4`,
      mime: 'video/mp4',
    });
    const done = await video({ proxyStatus: 'ready' });
    await db.insert(assetRendition).values({ assetId: done, name: '1080', status: 'ready', recipe: RECIPE });
    const light = await video({ proxyStatus: 'ready' });
    await db
      .insert(assetRendition)
      .values({ assetId: light, name: '480', status: 'ready', recipe: 'h264/light/1' });
    expect(await countNeeding(db, 'missing', RECIPE)).toBe(1);
    expect(await countNeeding(db, 'outdated', RECIPE)).toBe(3);
    void skipped;
  });

  it('queues blocks at a low priority, waits for the queue, and can be stopped', async () => {
    const queued: Array<{ id: string; regenerate?: boolean }> = [];
    let waiting = 0;
    let steps = 0;
    const jobs: Jobs = {
      processAsset: async () => {},
      deleteFiles: async () => {},
      makeProxy: async (id, opts) => void queued.push({ id, ...opts }),
      runVideoBackfill: async () => void (steps += 1),
      regenerationsWaiting: async () => waiting,
      cancelRegenerations: async () => {},
    };
    await startBackfill(db, jobs, 'outdated', RECIPE);
    expect(steps).toBe(1);
    await expect(startBackfill(db, jobs, 'outdated', RECIPE)).rejects.toThrow(/already/);
    expect(await stepBackfill(db, jobs, RECIPE)).toBe(true);
    expect(queued).toHaveLength(3);
    expect(queued.every((q) => q.regenerate)).toBe(true);
    expect(queued.length).toBeLessThanOrEqual(BACKFILL_BLOCK);
    // Nothing more past the cursor; the queue still works on them.
    waiting = 2;
    expect(await stepBackfill(db, jobs, RECIPE)).toBe(true);
    expect(await readBackfill(db, jobs)).toMatchObject({ status: 'running', total: 3, done: 1 });
    waiting = 0;
    expect(await stepBackfill(db, jobs, RECIPE)).toBe(false);
    expect(await readBackfill(db, jobs)).toMatchObject({ status: 'done', done: 3 });
    await startBackfill(db, jobs, 'missing', RECIPE);
    await stopBackfill(db, jobs);
    expect((await readBackfill(db, jobs))?.status).toBe('stopped');
    expect(await stepBackfill(db, jobs, RECIPE)).toBe(false);
  });
});
