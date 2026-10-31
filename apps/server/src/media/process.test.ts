import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations } from '../db/client.ts';
import { asset, assetVariant, project } from '../db/schema.ts';
import { animatedVariantKey, originalKey, proxyKey, readAll } from '../storage.ts';
import { testDeps } from '../test-deps.ts';
import { ANIMATED_CAPS, fitsAnimatedCaps, processAsset, variantWidths } from './process.ts';
import { runProxy } from './proxy.ts';
import {
  DEFAULT_PROXY_SETTINGS,
  mediaTools,
  probeVideo,
  resetMediaTools,
  sniffVideo,
} from './video.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

/** A tiny animated GIF, generated on the fly: no binary fixture in the repository. */
async function animatedGif(frames: number, width = 120, height = 80, delay?: number[]) {
  const pages = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: (i * 70) % 256, g: 60, b: 150, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
    ),
  );
  return sharp(pages, { join: { animated: true } })
    .gif({ loop: 0, delay })
    .toBuffer();
}

/** The same frames as an animated WebP, which sharp decodes to RGB rather than RGBA. */
async function animatedWebp(frames: number, delay: number[]) {
  const pages = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp({
        create: {
          width: 120,
          height: 80,
          channels: 3,
          background: { r: (i * 70) % 256, g: 60, b: 150 },
        },
      })
        .png()
        .toBuffer(),
    ),
  );
  return sharp(pages, { join: { animated: true } })
    .webp({ loop: 0, delay })
    .toBuffer();
}

/** A still picture, to re-process an asset whose source has stopped moving. */
async function stillPng(width = 120, height = 80) {
  return sharp({ create: { width, height, channels: 3, background: '#334455' } })
    .png()
    .toBuffer();
}

/**
 * The same GIF with a frame that no longer decodes: sharp still reads the metadata and the
 * poster, and fails when it has to decode every frame. No huge or binary fixture needed.
 */
async function brokenAnimation(gif: Buffer) {
  const decodes = async (body: Buffer, animated: boolean) => {
    try {
      const pipeline = sharp(body, { animated, failOn: 'error' });
      await (animated ? pipeline.rotate().raw() : pipeline.resize({ width: 32 }).webp()).toBuffer();
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 32; i < gif.length; i++) {
    const body = Buffer.from(gif);
    body[i] = body[i] === 0xff ? 0x00 : 0xff;
    if (!(await decodes(body, false))) continue;
    if (!(await decodes(body, true))) return body;
  }
  throw new Error('could not corrupt the animation of this GIF');
}

describe('fitsAnimatedCaps', () => {
  it('counts the pixels of the source, not of the scaled variants', () => {
    // 60 frames of 4000×4000 are 960 MP for sharp, whatever width the variants end up at.
    expect(fitsAnimatedCaps({ frames: 60, width: 4000, height: 4000 }, ANIMATED_CAPS)).toBe(false);
    expect(fitsAnimatedCaps({ frames: 3, width: 120, height: 80 }, ANIMATED_CAPS)).toBe(true);
  });

  it('caps one frame and the frame count too', () => {
    // 25 MP per frame is past the per-frame cap, though 50 MP in all is not.
    expect(fitsAnimatedCaps({ frames: 2, width: 5000, height: 5000 }, ANIMATED_CAPS)).toBe(false);
    expect(fitsAnimatedCaps({ frames: 301, width: 120, height: 80 }, ANIMATED_CAPS)).toBe(false);
    expect(fitsAnimatedCaps({ frames: 1, width: 120, height: 80 }, ANIMATED_CAPS)).toBe(false);
    expect(fitsAnimatedCaps({ frames: 3, width: 0, height: 0 }, ANIMATED_CAPS)).toBe(false);
  });
});

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
      kind:
        mime.startsWith('image/') || filename.endsWith('.heic')
          ? 'image'
          : mime.startsWith('video/') || mime === 'application/vnd.apple.mpegurl'
            ? 'video'
            : 'file',
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

  it('writes moving thumbnails beside the posters of an animated GIF', async () => {
    const id = await upload(await animatedGif(3), 'image/gif', 'loop.gif');
    const result = await processAsset(deps, id);
    const { row, variants } = await load(id);

    expect(result).toEqual({ variants: 1, animated: 1 });
    expect(row).toMatchObject({ status: 'ready', mime: 'image/gif', width: 120, height: 80 });
    // The poster is the first frame; the moving copy keeps all three.
    const poster = await sharp(
      await readAll(await storage.read(variants[0]?.storageKey ?? '')),
    ).metadata();
    expect(poster.pages).toBeUndefined();
    expect(row?.animated).toBe(true);
    const key = animatedVariantKey(id, '256');
    expect(await storage.size(key)).toBeGreaterThan(0);
    const moving = await sharp(await readAll(await storage.read(key))).metadata();
    expect(moving).toMatchObject({ format: 'webp', pages: 3 });
  });

  it('makes the moving copies of every size from one decode, timings kept', async () => {
    // Wide enough for 256, 512 and 1024, all below the moving cap.
    const id = await upload(
      await animatedGif(3, 1200, 800, [100, 200, 300]),
      'image/gif',
      'wide.gif',
    );
    expect((await processAsset(deps, id)).animated).toBe(3);
    for (const size of ['256', '512', '1024']) {
      const moving = await sharp(
        await readAll(await storage.read(animatedVariantKey(id, size))),
      ).metadata();
      // The raw pixels carry no timings: they must come back from the source metadata.
      expect(moving).toMatchObject({ format: 'webp', pages: 3, delay: [100, 200, 300] });
    }
  });

  it('makes moving thumbnails of an animated WebP too', async () => {
    const id = await upload(await animatedWebp(3, [80, 90, 100]), 'image/webp', 'loop.webp');
    expect((await processAsset(deps, id)).animated).toBe(1);
    expect((await load(id)).row).toMatchObject({ status: 'ready', mime: 'image/webp' });
    const moving = await sharp(
      await readAll(await storage.read(animatedVariantKey(id, '256'))),
    ).metadata();
    expect(moving).toMatchObject({ format: 'webp', pages: 3, delay: [80, 90, 100] });
  });

  it('keeps the posters when a frame of the animation does not decode', async () => {
    const warnings: string[] = [];
    const id = await upload(await brokenAnimation(await animatedGif(3)), 'image/gif', 'broken.gif');
    const result = await processAsset(
      { ...deps, log: { warn: (_fields, message) => warnings.push(message) } },
      id,
    );
    const { row, variants } = await load(id);

    expect(result).toMatchObject({ variants: 1, animated: 0 });
    expect(row).toMatchObject({ status: 'ready', mime: 'image/gif', animated: false });
    expect(variants).toHaveLength(1);
    expect(await storage.size(animatedVariantKey(id, '256'))).toBeNull();
    expect(warnings).toEqual(['moving thumbnails failed: keeping the posters']);
  });

  it('removes stale moving copies when the source no longer moves', async () => {
    const id = await upload(await animatedGif(3), 'image/gif', 'loop.gif');
    expect((await processAsset(deps, id)).animated).toBe(1);
    expect(await storage.size(animatedVariantKey(id, '256'))).toBeGreaterThan(0);

    // The same asset is processed again from a still picture.
    await storage.write(originalKey(id), await stillPng(), 'image/png');
    const result = await processAsset(deps, id);
    expect(result).toMatchObject({ variants: 1, animated: 0 });
    for (const size of ['256', '512', '1024', '2048'])
      expect(await storage.size(animatedVariantKey(id, size))).toBeNull();
    expect((await load(id)).row).toMatchObject({ status: 'ready', mime: 'image/png' });
    expect((await load(id)).row?.animated).toBe(false);
  });

  it('falls back to the poster when the animation is past the caps', async () => {
    const id = await upload(await animatedGif(5), 'image/gif', 'long.gif');
    expect((await processAsset(deps, id)).animated).toBe(1);

    // Re-running under a cap drops the moving copies the first run wrote.
    const result = await processAsset(deps, id, { ...ANIMATED_CAPS, maxFrames: 2 });
    expect(result).toMatchObject({ variants: 1, animated: 0 });
    expect(await storage.size(animatedVariantKey(id, '256'))).toBeNull();
    const { row, variants } = await load(id);
    expect(row?.status).toBe('ready');
    expect(row?.animated).toBe(false);
    expect(variants).toHaveLength(1);
  });

  it('falls back to the poster when the frames are too many pixels, unscaled', async () => {
    // A small GIF, under a cap its source pixels do not fit: no fixture of a billion pixels.
    const id = await upload(await animatedGif(3), 'image/gif', 'big.gif');
    const caps = { ...ANIMATED_CAPS, maxPixels: 3 * 120 * 80 - 1 };
    expect((await processAsset(deps, id, caps)).animated).toBe(0);
    expect(await storage.size(animatedVariantKey(id, '256'))).toBeNull();
    expect((await load(id)).row).toMatchObject({ status: 'ready', animated: false });
  });

  it('falls back to the poster when one frame is too many pixels', async () => {
    const id = await upload(await animatedGif(3), 'image/gif', 'tall.gif');
    const caps = { ...ANIMATED_CAPS, maxFramePixels: 120 * 80 - 1 };
    expect((await processAsset(deps, id, caps)).animated).toBe(0);
    expect((await load(id)).row?.animated).toBe(false);
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

  describe('camera RAW', async () => {
    const tools = await mediaTools();

    it.skipIf(!tools.exiftool)('makes upright thumbnails from the embedded preview', async () => {
      const body = fixture('orientation-6.dng');
      const id = await upload(body, 'application/octet-stream', 'IMG_0006.DNG');
      await processAsset(deps, id);
      const { row, variants } = await load(id);
      expect(row).toMatchObject({
        status: 'ready',
        kind: 'image',
        mime: 'image/x-adobe-dng',
        // The 320×200 preview, turned a quarter as the RAW says.
        width: 200,
        height: 320,
      });
      expect(row?.exif).toMatchObject({
        Make: 'Inkadra',
        Model: 'Test DNG',
        FNumber: 2.8,
        ExposureTime: 0.004,
        ISO: 400,
        FocalLength: 50,
        Orientation: 6,
      });
      expect(variants.map((v) => [v.size, v.width, v.height])).toEqual([['256', 200, 320]]);
      // Red was on the left of the sensor: on the top once upright.
      const thumb = await sharp(await readAll(await storage.read(variants[0]?.storageKey ?? '')))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const px = (y: number) => {
        const at = y * thumb.info.width * thumb.info.channels;
        return [...thumb.data.subarray(at, at + 3)];
      };
      expect(px(10)[0]).toBeGreaterThan(200);
      expect(px(310)[2]).toBeGreaterThan(200);
      // The RAW itself is never changed.
      expect(await readAll(await storage.read(originalKey(id)))).toEqual(body);
    });

    it('keeps a RAW without a preview as a file of its RAW type', async () => {
      // TIFF magic and nothing else: no IFD, no preview.
      const body = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0, ...new Array(64).fill(0)]);
      const id = await upload(body, 'application/octet-stream', 'DSC_0001.NEF');
      await processAsset(deps, id);
      const { row, variants } = await load(id);
      expect(row).toMatchObject({ status: 'ready', mime: 'image/x-nikon-nef', kind: 'file' });
      expect(variants).toHaveLength(0);
    });

    it.skipIf(!tools.exiftool)('makes no thumbnails when RAW previews are off', async () => {
      const id = await upload(fixture('orientation-6.dng'), 'image/x-adobe-dng', 'off.dng');
      await processAsset({ ...deps, raw: false }, id);
      const { row, variants } = await load(id);
      expect(row).toMatchObject({ status: 'ready', mime: 'image/x-adobe-dng' });
      expect(variants).toHaveLength(0);
    });
  });

  describe('PDF', async () => {
    const tools = await mediaTools();
    const poppler = Boolean(tools.pdftoppm && tools.pdfinfo);

    it.skipIf(!poppler)('renders page 1 and counts the pages', async () => {
      const id = await upload(fixture('two-pages.pdf'), 'application/pdf', 'call-sheet.pdf');
      await processAsset(deps, id);
      const { row, variants } = await load(id);
      // Page 1 is A4 portrait (page 2 is landscape): 2048 high, its width in proportion.
      expect(row).toMatchObject({
        status: 'ready',
        kind: 'file',
        mime: 'application/pdf',
        pageCount: 2,
        width: 1448,
        height: 2048,
      });
      expect(variants.map((v) => v.size)).toEqual(['256', '512', '1024']);
      // Red on the top half, blue on the bottom one.
      const thumb = await sharp(await readAll(await storage.read(variants[0]?.storageKey ?? '')))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const px = (y: number) => {
        const at = y * thumb.info.width * thumb.info.channels;
        return [...thumb.data.subarray(at, at + 3)];
      };
      expect(px(20)[0]).toBeGreaterThan(200);
      expect(px(thumb.info.height - 20)[2]).toBeGreaterThan(200);
    });

    it('keeps encrypted and broken PDFs ready, without thumbnails', async () => {
      const locked = await upload(fixture('encrypted.pdf'), 'application/pdf', 'locked.pdf');
      await processAsset(deps, locked);
      const a = await load(locked);
      expect(a.row).toMatchObject({ status: 'ready', mime: 'application/pdf', pageCount: null });
      expect(a.variants).toHaveLength(0);

      const broken = await upload(
        fixture('two-pages.pdf').subarray(0, 300),
        'application/octet-stream',
        'broken.pdf',
      );
      await processAsset(deps, broken);
      const b = await load(broken);
      expect(b.row).toMatchObject({ status: 'ready', mime: 'application/pdf', pageCount: null });
      expect(b.variants).toHaveLength(0);
    });

    it.skipIf(!poppler)('makes no thumbnails when PDF previews are off', async () => {
      const id = await upload(fixture('two-pages.pdf'), 'application/pdf', 'off.pdf');
      await processAsset({ ...deps, pdf: false }, id);
      const { row, variants } = await load(id);
      expect(row).toMatchObject({ status: 'ready', pageCount: null });
      expect(variants).toHaveLength(0);
    });
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

  describe('videos', async () => {
    const tools = await mediaTools();
    // A 2 s, 640x360 clip with a red frame after 0.1 s, so the poster is not the first frame.
    const clip = () => {
      const out = join(root, `clip-${randomUUID()}.mp4`);
      execFileSync(tools.ffmpeg ?? 'ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=640x360:r=24:d=0.1',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=640x360:r=24:d=1.9',
        '-filter_complex',
        '[0][1]concat=n=2:v=1',
        '-pix_fmt',
        'yuv420p',
        out,
      ]);
      return readFileSync(out);
    };

    it.skipIf(!tools.ffmpeg)('makes a poster and reads the duration with ffmpeg', async () => {
      const id = await upload(clip(), 'video/mp4', 'take-4C.mp4');
      await processAsset(deps, id);
      const { row, variants } = await load(id);
      expect(row).toMatchObject({ status: 'ready', kind: 'video', mime: 'video/mp4' });
      expect([row?.width, row?.height]).toEqual([640, 360]);
      expect(row?.durationMs).toBeGreaterThan(1900);
      expect(row?.durationMs).toBeLessThan(2200);
      expect(variants.map((v) => v.size)).toEqual(['256', '512']);
      expect(row?.palette?.[0]).toMatch(/^#[EF][0-9A-F]/);
    });

    it('never hands playlists to ffmpeg', async () => {
      const playlist = Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n');
      expect(sniffVideo(playlist)).toBeNull();
      const id = await upload(playlist, 'application/vnd.apple.mpegurl', 'evil.m3u8');
      await processAsset(deps, id);
      const { row, variants } = await load(id);
      expect(row?.status).toBe('ready');
      expect(variants).toHaveLength(0);
    });

    it.skipIf(!tools.ffmpeg)('makes no playable copy of a video browsers play', async () => {
      const queued: string[] = [];
      const id = await upload(clip(), 'video/mp4', 'plays.mp4');
      await processAsset({ ...deps, enqueueProxy: async (a) => void queued.push(a) }, id);
      const { row } = await load(id);
      expect(row).toMatchObject({ proxyStatus: null, videoCodec: 'h264', frameRate: 24 });
      expect(queued).toEqual([]);
    });

    describe.skipIf(!tools.ffmpeg || !tools.ffprobe)('playable copies', () => {
      const withQueue = () => {
        const queued: string[] = [];
        return {
          queued,
          deps: { ...deps, enqueueProxy: async (a: string) => void queued.push(a) },
        };
      };

      it('encodes ProRes to H.264/AAC MP4, keeping the original', async () => {
        const body = fixture('prores-proxy.mov');
        const id = await upload(body, 'video/quicktime', 'A001_C002.mov');
        const q = withQueue();
        await processAsset(q.deps, id);
        let { row, variants } = await load(id);
        expect(row).toMatchObject({
          status: 'ready',
          videoCodec: 'prores',
          audioCodec: 'pcm_s16le',
          frameRate: 12,
          proxyStatus: 'queued',
        });
        expect(variants.map((v) => v.size)).toEqual(['256']);
        expect(q.queued).toEqual([id]);

        const progress: number[] = [];
        await runProxy(deps, id, (p) => void progress.push(p));
        ({ row, variants } = await load(id));
        expect(row).toMatchObject({ proxyStatus: 'ready', proxyProgress: 100 });
        expect(progress.at(-1)).toBe(100);
        const proxy = variants.find((v) => v.size === 'proxy');
        expect(proxy).toMatchObject({ mime: 'video/mp4', width: 64, height: 36 });
        expect(proxy?.bytes).toBeGreaterThan(0);
        const out = join(root, `proxy-${id}.mp4`);
        writeFileSync(out, await readAll(await storage.read(proxy?.storageKey ?? '')));
        const made = await probeVideo(tools.ffprobe ?? '', out);
        expect(made).toMatchObject({
          videoCodec: 'h264',
          audioCodec: 'aac',
          pixelFormat: 'yuv420p',
        });
        // The original is untouched.
        expect(await readAll(await storage.read(originalKey(id)))).toEqual(body);

        // A second pass of the thumbnails keeps the copy and does not queue another.
        const again = withQueue();
        await processAsset(again.deps, id);
        ({ row, variants } = await load(id));
        expect(row?.proxyStatus).toBe('ready');
        expect(variants.some((v) => v.size === 'proxy')).toBe(true);
        expect(again.queued).toEqual([]);
      });

      it('removes a copy written for an asset deleted meanwhile', async () => {
        const id = randomUUID();
        await storage.write(proxyKey(id), Buffer.from('left over'), 'video/mp4');
        expect(await runProxy(deps, id)).toEqual({ skipped: 'gone' });
        expect(await storage.size(proxyKey(id))).toBeNull();
      });

      it('only remuxes H.264 out of Matroska, with the sound as AAC', async () => {
        const id = await upload(fixture('h264-opus.mkv'), 'video/x-matroska', 'take.mkv');
        const q = withQueue();
        await processAsset(q.deps, id);
        expect((await load(id)).row?.proxyStatus).toBe('queued');
        await runProxy(deps, id);
        const { variants } = await load(id);
        const proxy = variants.find((v) => v.size === 'proxy');
        const out = join(root, `remux-${id}.mp4`);
        writeFileSync(out, await readAll(await storage.read(proxy?.storageKey ?? '')));
        expect(await probeVideo(tools.ffprobe ?? '', out)).toMatchObject({
          videoCodec: 'h264',
          audioCodec: 'aac',
        });
      });

      it('says skipped when proxies are turned off or the video is too long', async () => {
        const off = withQueue();
        const id = await upload(fixture('prores-proxy.mov'), 'video/quicktime', 'off.mov');
        await processAsset(
          { ...off.deps, proxies: { ...DEFAULT_PROXY_SETTINGS, enabled: false } },
          id,
        );
        expect((await load(id)).row?.proxyStatus).toBe('skipped');
        expect(off.queued).toEqual([]);

        // Turned off after it was queued: the job gives up without running ffmpeg.
        await processAsset(withQueue().deps, id);
        await runProxy({ ...deps, proxies: { ...DEFAULT_PROXY_SETTINGS, maxDurationS: 0.1 } }, id);
        const { row, variants } = await load(id);
        expect(row?.proxyStatus).toBe('skipped');
        expect(variants.some((v) => v.size === 'proxy')).toBe(false);
      });
    });

    it.skipIf(!tools.ffmpeg)('stores videos without poster when ffmpeg is missing', async () => {
      const body = clip();
      process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
      resetMediaTools();
      try {
        const id = await upload(body, 'video/mp4', 'no-tools.mp4');
        await processAsset(deps, id);
        const { row, variants } = await load(id);
        expect(row?.status).toBe('ready');
        expect(variants).toHaveLength(0);
      } finally {
        delete process.env.FFMPEG_PATH;
        resetMediaTools();
      }
    });
  });
});
