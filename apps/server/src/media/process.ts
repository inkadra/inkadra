import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ThumbnailSize } from '@inkadra/shared';
import { eq } from 'drizzle-orm';
import sharp, { type Sharp } from 'sharp';
import type { Database } from '../db/client.ts';
import { asset, assetVariant } from '../db/schema.ts';
import { readAll, type Storage, variantKey } from '../storage.ts';
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
 * Safe to run twice: variants are overwritten.
 */
export async function processAsset(deps: MediaDeps, assetId: string) {
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
    }

    const exif = await readExif(copy.path);
    const result = await thumbnails(deps, assetId, input);
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
    return { variants: result.variants.length };
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

  const variants: Array<typeof assetVariant.$inferInsert> = [];
  for (const width of variantWidths(info.width)) {
    const { data, info: out } = await base()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const size = String(width) as ThumbnailSize;
    const key = variantKey(assetId, size);
    await deps.storage.write(key, data, 'image/webp');
    variants.push({ assetId, size, width: out.width, height: out.height, storageKey: key });
  }
  return { variants, width: info.width, height: info.height, palette: palette(colours) };
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
