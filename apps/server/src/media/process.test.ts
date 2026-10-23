import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, assetVariant, project } from '../db/schema.ts';
import { originalKey, readAll } from '../storage.ts';
import { testDeps } from '../test-deps.ts';
import { processAsset, variantWidths } from './process.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

describe('variantWidths', () => {
  it('never upscales and always gives one thumbnail', () => {
    expect(variantWidths(6000)).toEqual([256, 512, 1024, 2048]);
    expect(variantWidths(800)).toEqual([256, 512]);
    expect(variantWidths(120)).toEqual([256]);
  });
});

describe.skipIf(!url)('processAsset (needs DATABASE_URL)', () => {
  const { db, sql: client } = createDatabase(url ?? 'postgres://unused', 2);
  const log = pino({ level: 'silent' });
  const { storage, root } = testDeps(db, log);
  const deps = { db, storage, tmpDir: join(root, 'tmp'), heic: true };
  let projectId = '';

  beforeAll(async () => {
    await runMigrations(url ?? '', migrationsFolder);
    await db.execute(sql`truncate table "user", project, instance_setting cascade`);
    const [p] = await db.insert(project).values({ name: 'Media', position: 'a0' }).returning();
    projectId = p?.id ?? '';
  });
  afterAll(() => client.end());

  async function upload(body: Buffer, mime: string, filename: string) {
    const id = randomUUID();
    await storage.write(originalKey(id), body, mime);
    await db.insert(asset).values({
      id,
      projectId,
      kind: mime.startsWith('image/') || filename.endsWith('.heic') ? 'image' : 'file',
      mime,
      filename,
      size: body.length,
      storageKey: originalKey(id),
    });
    return id;
  }

  const load = async (id: string) => {
    const [row] = await db.select().from(asset).where(eq(asset.id, id));
    const variants = await db.select().from(assetVariant).where(eq(assetVariant.assetId, id));
    return { row, variants: variants.sort((a, b) => a.width - b.width) };
  };

  it('makes WebP thumbnails without location data, keeps camera EXIF', async () => {
    const jpeg = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#C83C28' },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: 'FUJIFILM', Model: 'X-T5' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 4/1 12/1' },
      })
      .toBuffer();
    // The camera data is really there, location included.
    expect((await sharp(jpeg).metadata()).exif?.length).toBeGreaterThan(0);

    const id = await upload(jpeg, 'application/octet-stream', 'IMG_0001.jpg');
    await processAsset(deps, id);
    const { row, variants } = await load(id);

    expect(row).toMatchObject({ status: 'ready', mime: 'image/jpeg', width: 1200, height: 800 });
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.exif).toMatchObject({ Make: 'FUJIFILM', Model: 'X-T5' });
    expect(JSON.stringify(row?.exif)).not.toMatch(/GPS|latitude/i);
    // JPEG shifts the colour by a unit or two.
    expect(row?.palette?.[0]).toMatch(/^#C[89A]3[BCD]2[789]$/);
    expect(variants.map((v) => [v.size, v.width, v.height])).toEqual([
      ['256', 256, 171],
      ['512', 512, 341],
      ['1024', 1024, 683],
    ]);
    const thumb = await readAll(await storage.read(variants[0]?.storageKey ?? ''));
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
  });

  it('applies the EXIF orientation to the pixels', async () => {
    const portrait = await sharp({
      create: { width: 600, height: 300, channels: 3, background: '#000000' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const id = await upload(portrait, 'image/jpeg', 'rotated.jpg');
    await processAsset(deps, id);
    const { row, variants } = await load(id);
    expect([row?.width, row?.height]).toEqual([300, 600]);
    expect(variants[0]).toMatchObject({ width: 256, height: 512 });
  });

  it('decodes HEIC photos from iPhones', async () => {
    const id = await upload(fixture('gradient.heic'), '', 'IMG_4321.HEIC');
    await processAsset(deps, id);
    const { row, variants } = await load(id);
    expect(row).toMatchObject({ status: 'ready', mime: 'image/heic', width: 320, height: 240 });
    expect(variants.map((v) => v.size)).toEqual(['256']);
    expect(row?.palette?.length).toBeGreaterThan(1);
  });

  it('stores HEIC without previews when they are turned off', async () => {
    const id = await upload(fixture('gradient.heic'), 'image/heic', 'IMG_4322.HEIC');
    await processAsset({ ...deps, heic: false }, id);
    const { row, variants } = await load(id);
    expect(row?.status).toBe('ready');
    expect(variants).toHaveLength(0);
  });

  it('only checksums other files', async () => {
    const id = await upload(
      Buffer.from('%PDF-1.7 not really'),
      'application/pdf',
      'call-sheet.pdf',
    );
    await processAsset(deps, id);
    const { row, variants } = await load(id);
    expect(row?.status).toBe('ready');
    expect(row?.sha256).toHaveLength(64);
    expect(variants).toHaveLength(0);
  });

  it('rejects a broken image so the job can be retried and then marked failed', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const id = await upload(png.subarray(0, 40), 'image/png', 'broken.png');
    await expect(processAsset(deps, id)).rejects.toThrow();
  });
});
