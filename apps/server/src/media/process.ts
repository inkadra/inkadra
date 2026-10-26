import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MOVING_THUMBNAIL_MAX_WIDTH, ThumbnailSize } from '@inkadra/shared';
import { eq } from 'drizzle-orm';
import sharp, { type Sharp } from 'sharp';
import type { Database } from '../db/client.ts';
import { asset, assetVariant } from '../db/schema.ts';
import { animatedVariantKey, readAll, type Storage, variantKey } from '../storage.ts';
import { readExif } from './exif.ts';
import { decodeHeic, sniffImage } from './heic.ts';
import { palette } from './palette.ts';
import { extractPoster, mediaTools, probeVideo, sniffVideo } from './video.ts';

export interface MediaDeps {
  db: Database;
  storage: Storage;
  tmpDir: string;
  heic: boolean;
}

/** Limits on the moving variants of a GIF or an animated WebP, beyond which cards stay static. */
export interface AnimatedCaps {
  /** Frames decodable at once: a GIF with more is shown as a poster only. */
  maxFrames: number;
  /** Widest moving variant; a larger poster in the viewer stays static. */
  maxWidth: number;
  /** Pixels decoded at once (frames × scaled frame area), a rough memory limit for sharp. */
  maxPixels: number;
  /** Total bytes of the moving variants; past this they are dropped altogether. */
  maxBytes: number;
}

/**
 * Moving WebP thumbnails are cheap while they fit: up to three sizes and an ordinary GIF
 * length. A long or huge GIF keeps only its poster, and so do animated WebPs like it.
 */
export const ANIMATED_CAPS: AnimatedCaps = {
  maxFrames: 300,
  maxWidth: MOVING_THUMBNAIL_MAX_WIDTH,
  maxPixels: 64_000_000,
  maxBytes: 6 * 1024 * 1024,
};

const SIZES = ThumbnailSize.options.map(Number).sort((a, b) => a - b);

/** Formats sharp reads with its bundled libvips, mapped to the type we store. */
const SHARP_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  heif: 'image/avif',
};

/** Widths to render for an image `width` pixels wide: no upscaling, at least one. */
export function variantWidths(width: number): number[] {
  const fit = SIZES.filter((s) => s < width);
  return fit.length > 0 ? fit : SIZES.slice(0, 1);
}

async function sha256(storage: Storage, key: string) {
  const hash = createHash('sha256');
  await pipeline(await storage.read(key), hash);
  return hash.digest('hex');
}

/**
 * Turns an uploaded original into a ready asset: checksum always; for images also the real
 * type, dimensions, EXIF without location, palette and WebP thumbnails without metadata; for
 * videos, when ffmpeg is installed, the duration and thumbnails of a poster frame.
 * Animated GIFs and animated WebPs also get moving thumbnails, when they fit `caps`.
 * Safe to run twice: variants are overwritten.
 */
export async function processAsset(deps: MediaDeps, assetId: string, caps = ANIMATED_CAPS) {
  const { db, storage } = deps;
  const [row] = await db.select().from(asset).where(eq(asset.id, assetId));
  if (!row) return { skipped: 'gone' as const };
  await db.update(asset).set({ status: 'processing' }).where(eq(asset.id, assetId));

  const digest = await sha256(storage, row.storageKey);
  const head = await readAll(await storage.read(row.storageKey, { start: 0, end: 255 }));
  const sniffed = sniffImage(head);
  // SVG is rasterised only when it was declared as such: it cannot be sniffed safely.
  const svg = !sniffed && row.kind === 'image' && row.mime === 'image/svg+xml';
  const video = !sniffed && !svg && row.kind === 'video' ? sniffVideo(head) : null;
  const tools = video ? await mediaTools() : null;
  if (!sniffed && !svg && !(video && tools?.ffmpeg)) {
    await db.update(asset).set({ sha256: digest, status: 'ready' }).where(eq(asset.id, assetId));
    return { variants: 0 };
  }

  const copy = await storage.localCopy(row.storageKey, join(deps.tmpDir, assetId));
  const posterPath = join(deps.tmpDir, `${assetId}.poster.png`);
  try {
    if (video && tools?.ffmpeg) {
      await mkdir(deps.tmpDir, { recursive: true });
      const { durationMs } = tools.ffprobe
        ? await probeVideo(tools.ffprobe, copy.path).catch(() => ({ durationMs: null }))
        : { durationMs: null };
      await extractPoster(tools.ffmpeg, copy.path, posterPath, durationMs);
      const result = await thumbnails(deps, assetId, sharp(posterPath, { failOn: 'error' }));
      await save(db, assetId, result.variants, {
        sha256: digest,
        width: result.width,
        height: result.height,
        durationMs,
        palette: result.palette,
        status: 'ready',
      });
      return { variants: result.variants.length };
    }

    let mime = sniffed ?? row.mime;
    let input: Sharp;
    // Frames and frame size, for the moving variants: 1 frame for a still picture.
    let frames = 1;
    let frameWidth = 0;
    let frameHeight = 0;
    if (mime === 'image/heic') {
      if (!deps.heic) {
        await db
          .update(asset)
          .set({ sha256: digest, mime, kind: 'image', status: 'ready' })
          .where(eq(asset.id, assetId));
        return { variants: 0 };
      }
      const image = await decodeHeic(await readFile(copy.path));
      input = sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } });
    } else {
      input = sharp(copy.path, { failOn: 'error', animated: false });
      const meta = await input.metadata();
      mime = (meta.format && SHARP_MIME[meta.format]) ?? mime;
      frames = meta.pages ?? 1;
      frameWidth = meta.width ?? 0;
      frameHeight = meta.height ?? 0;
    }

    const exif = await readExif(copy.path);
    const result = await thumbnails(deps, assetId, input);
    const animated =
      frames > 1 && (mime === 'image/gif' || mime === 'image/webp')
        ? await animatedThumbnails(deps, assetId, copy.path, result.widths, caps, {
            frames,
            width: frameWidth,
            height: frameHeight,
          })
        : 0;
    await save(db, assetId, result.variants, {
      sha256: digest,
      mime,
      kind: 'image',
      width: result.width,
      height: result.height,
      exif,
      palette: result.palette,
      status: 'ready',
    });
    return { variants: result.variants.length, animated };
  } finally {
    await copy.done();
    await rm(posterPath, { force: true });
  }
}

/** WebP thumbnails and dominant colours of a picture, upright. */
async function thumbnails(deps: MediaDeps, assetId: string, input: Sharp) {
  // Orientation is applied to the pixels, so the variants need no EXIF to display upright.
  const { data: pixels, info } = await input.rotate().raw().toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const base = () => sharp(pixels, { raw });
  const colours = await base().resize(64, 64, { fit: 'inside' }).removeAlpha().raw().toBuffer();

  const widths = variantWidths(info.width);
  const variants: Array<typeof assetVariant.$inferInsert> = [];
  for (const width of widths) {
    const { data, info: out } = await base()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const size = String(width) as ThumbnailSize;
    const key = variantKey(assetId, size);
    await deps.storage.write(key, data, 'image/webp');
    variants.push({ assetId, size, width: out.width, height: out.height, storageKey: key });
  }
  return { variants, widths, width: info.width, height: info.height, palette: palette(colours) };
}

/**
 * Moving WebP copies of the thumbnails of an animated source, at keys of their own
 * (`variants/<assetId>/<size>-animated.webp`), never rows: the database has no room for a
 * second variant at the same size, and whether one exists is derived from these caps.
 * Returns how many were written; 0 when the source is too long or the result too heavy,
 * and the posters stay the only variants.
 */
async function animatedThumbnails(
  deps: MediaDeps,
  assetId: string,
  source: string,
  widths: number[],
  caps: AnimatedCaps,
  meta: { frames: number; width: number; height: number },
) {
  const targets = widths
    .filter((w) => w <= caps.maxWidth)
    .map((width) => ({ width, key: animatedVariantKey(assetId, String(width)) }));
  // A previous run may have written them for a file that no longer fits.
  await deps.storage.remove(targets.map((t) => t.key));
  if (targets.length === 0 || meta.width === 0 || meta.height === 0) return 0;
  const scale = Math.min(1, caps.maxWidth / meta.width);
  const pixels = meta.frames * meta.width * meta.height * scale * scale;
  if (meta.frames > caps.maxFrames || pixels > caps.maxPixels) return 0;

  const rendered: Array<{ key: string; data: Buffer }> = [];
  let bytes = 0;
  for (const target of targets) {
    const { data } = await sharp(source, { animated: true, failOn: 'error' })
      .rotate()
      .resize({ width: target.width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4, loop: 0 })
      .toBuffer({ resolveWithObject: true });
    bytes += data.length;
    if (bytes > caps.maxBytes) return 0;
    rendered.push({ key: target.key, data });
  }
  for (const r of rendered) await deps.storage.write(r.key, r.data, 'image/webp');
  return rendered.length;
}

async function save(
  db: Database,
  assetId: string,
  variants: Array<typeof assetVariant.$inferInsert>,
  fields: Partial<typeof asset.$inferInsert>,
) {
  await db.transaction(async (tx) => {
    await tx.delete(assetVariant).where(eq(assetVariant.assetId, assetId));
    if (variants.length > 0) await tx.insert(assetVariant).values(variants);
    await tx.update(asset).set(fields).where(eq(asset.id, assetId));
  });
}

/** Called when the last retry failed. */
export async function markFailed(db: Database, assetId: string) {
  await db.update(asset).set({ status: 'failed' }).where(eq(asset.id, assetId));
}
