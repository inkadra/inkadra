import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MOVING_THUMBNAIL_MAX_WIDTH, ThumbnailSize } from '@inkadra/shared';
import { and, eq, ne } from 'drizzle-orm';
import sharp, { type Sharp } from 'sharp';
import type { Database } from '../db/client.ts';
import { asset, assetVariant } from '../db/schema.ts';
import { animatedVariantKey, readAll, type Storage, variantKey } from '../storage.ts';
import { readExif } from './exif.ts';
import { decodeHeic, sniffImage } from './heic.ts';
import { palette } from './palette.ts';
import { isPdf, readPdfInfo, renderFirstPage } from './pdf.ts';
import { extractRawPreview, orientedPixels, readRawExif, sniffRaw } from './raw.ts';
import {
  DEFAULT_PROXY_SETTINGS,
  extractPoster,
  mediaTools,
  type ProxySettings,
  probeVideo,
  proxyPlan,
  sniffVideo,
  type VideoInfo,
} from './video.ts';

export interface MediaDeps {
  db: Database;
  storage: Storage;
  tmpDir: string;
  heic: boolean;
  /** Camera RAW thumbnails from their embedded JPEG (RAW_PREVIEWS); on if unset. */
  raw?: boolean;
  /** Thumbnails of page 1 of PDFs and their page count (PDF_PREVIEWS); on if unset. */
  pdf?: boolean;
  /** Playable copies of videos browsers cannot play (decision 0048); on with defaults if unset. */
  proxies?: ProxySettings;
  /**
   * Queues the playable copy of a video. Without it (tests, tools) none is made and the asset
   * says `skipped`.
   */
  enqueueProxy?: (assetId: string) => Promise<void>;
  /** Where a failed pass of the moving variants is reported; the posters are still saved. */
  log?: { warn: (fields: Record<string, unknown>, message: string) => void };
}

/** Limits on the moving variants of a GIF or an animated WebP, beyond which cards stay static. */
export interface AnimatedCaps {
  /** Frames decodable at once: a GIF with more is shown as a poster only. */
  maxFrames: number;
  /** Widest moving variant; a larger poster in the viewer stays static. */
  maxWidth: number;
  /**
   * Pixels of the whole source (frames × source frame area), unscaled: sharp decodes every
   * frame at the size of the original before resizing, so 60 frames of 4000×4000 are a
   * billion pixels even though the variants are small.
   */
  maxPixels: number;
  /** Pixels of one source frame, so a single huge frame is never decoded at all. */
  maxFramePixels: number;
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
  // 4096×4096: one frame of a GIF this big already costs 67 MB of raw pixels.
  maxFramePixels: 16_777_216,
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

/** Every moving variant an asset could have, whatever sizes the posters ended up at. */
const animatedKeys = (assetId: string) =>
  ThumbnailSize.options.map((size) => animatedVariantKey(assetId, size));

/**
 * Whether the moving thumbnails of `meta` are worth making. The caps are on the source
 * pixels, not on the variants: sharp decodes each frame at full size before resizing it.
 */
export function fitsAnimatedCaps(
  meta: { frames: number; width: number; height: number },
  caps: AnimatedCaps,
) {
  const framePixels = meta.width * meta.height;
  return (
    meta.frames > 1 &&
    framePixels > 0 &&
    meta.frames <= caps.maxFrames &&
    framePixels <= caps.maxFramePixels &&
    meta.frames * framePixels <= caps.maxPixels
  );
}

async function sha256(storage: Storage, key: string) {
  const hash = createHash('sha256');
  await pipeline(await storage.read(key), hash);
  return hash.digest('hex');
}

/**
 * Turns an uploaded original into a ready asset: checksum always; for images also the real
 * type, dimensions, EXIF without location, palette and WebP thumbnails without metadata; for
 * videos, when ffmpeg is installed, the duration, codecs and thumbnails of a poster frame,
 * and the playable copy queued when browsers cannot play the original (decision 0048).
 * Animated GIFs and animated WebPs also get moving thumbnails, when they fit `caps`. Camera
 * RAW files get the thumbnails of their embedded JPEG preview, with exiftool; PDFs those of
 * page 1 and their page count, with poppler.
 * Safe to run twice: variants are overwritten.
 */
export async function processAsset(deps: MediaDeps, assetId: string, caps = ANIMATED_CAPS) {
  const { db, storage } = deps;
  const [row] = await db.select().from(asset).where(eq(asset.id, assetId));
  if (!row) return { skipped: 'gone' as const };
  await db.update(asset).set({ status: 'processing' }).where(eq(asset.id, assetId));

  const digest = await sha256(storage, row.storageKey);
  const head = await readAll(await storage.read(row.storageKey, { start: 0, end: 255 }));
  // Most RAW formats are TIFF inside: they are told apart before the photos.
  const rawType = sniffRaw(head, row.filename, row.mime);
  if (rawType) return processRaw(deps, row, digest, rawType);
  if (row.kind === 'file' && isPdf(head)) return processPdf(deps, row, digest);
  const sniffed = sniffImage(head);
  // SVG is rasterised only when it was declared as such: it cannot be sniffed safely.
  const svg = !sniffed && row.kind === 'image' && row.mime === 'image/svg+xml';
  const video = !sniffed && !svg && row.kind === 'video' ? sniffVideo(head) : null;
  const tools = video ? await mediaTools() : null;
  if (!sniffed && !svg && !(video && tools?.ffmpeg)) {
    await db
      .update(asset)
      .set({ sha256: digest, status: 'ready', animated: false })
      .where(eq(asset.id, assetId));
    return { variants: 0 };
  }

  const copy = await storage.localCopy(row.storageKey, join(deps.tmpDir, assetId));
  const posterPath = join(deps.tmpDir, `${assetId}.poster.png`);
  try {
    if (video && tools?.ffmpeg) {
      await mkdir(deps.tmpDir, { recursive: true });
      const info: VideoInfo | null = tools.ffprobe
        ? await probeVideo(tools.ffprobe, copy.path).catch(() => null)
        : null;
      const durationMs = info?.durationMs ?? null;
      await extractPoster(tools.ffmpeg, copy.path, posterPath, durationMs);
      const result = await thumbnails(deps, assetId, sharp(posterPath, { failOn: 'error' }));
      const proxyStatus = await proxyState(deps, assetId, video, info, row.size);
      await save(db, assetId, result.variants, {
        sha256: digest,
        width: result.width,
        height: result.height,
        durationMs,
        videoCodec: info?.videoCodec ?? null,
        audioCodec: info?.audioCodec ?? null,
        frameRate: info?.frameRate ?? null,
        proxyStatus,
        proxyProgress: proxyStatus === 'ready' ? 100 : null,
        palette: result.palette,
        status: 'ready',
        animated: false,
      });
      if (proxyStatus === 'queued') await deps.enqueueProxy?.(assetId);
      return { variants: result.variants.length, proxy: proxyStatus };
    }

    let mime = sniffed ?? row.mime;
    let input: Sharp;
    // Frames and frame size, for the moving variants: 1 frame for a still picture.
    let frames = 1;
    let frameWidth = 0;
    let frameHeight = 0;
    let delays: number[] | undefined;
    if (mime === 'image/heic') {
      if (!deps.heic) {
        await db
          .update(asset)
          .set({ sha256: digest, mime, kind: 'image', status: 'ready', animated: false })
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
      delays = meta.delay;
    }

    const exif = await readExif(copy.path);
    const result = await thumbnails(deps, assetId, input);
    let animated = 0;
    if (frames > 1 && (mime === 'image/gif' || mime === 'image/webp')) {
      animated = await animatedThumbnails(deps, assetId, copy.path, result.widths, caps, {
        frames,
        width: frameWidth,
        height: frameHeight,
        delays,
      });
    } else {
      // A previous run may have made moving copies of a source that no longer moves.
      await deps.storage.remove(animatedKeys(assetId));
    }
    await save(db, assetId, result.variants, {
      sha256: digest,
      mime,
      kind: 'image',
      width: result.width,
      height: result.height,
      exif,
      palette: result.palette,
      status: 'ready',
      animated: animated > 0,
    });
    return { variants: result.variants.length, animated };
  } finally {
    await copy.done();
    await rm(posterPath, { force: true });
  }
}

/**
 * A camera RAW file: thumbnails from the largest JPEG preview the camera embedded, turned by
 * the orientation of the RAW, and its EXIF, read by exiftool. The RAW itself is never
 * developed. Without exiftool, or without a preview, the file is ready with no thumbnails and
 * keeps its kind: a file card with its RAW type.
 */
async function processRaw(
  deps: MediaDeps,
  row: typeof asset.$inferSelect,
  digest: string,
  mime: string,
) {
  const { db, storage } = deps;
  const plain = { sha256: digest, mime, status: 'ready' as const, animated: false };
  const { exiftool } = await mediaTools();
  if (deps.raw === false || !exiftool) {
    await save(db, row.id, [], plain);
    return { variants: 0 };
  }
  await mkdir(deps.tmpDir, { recursive: true });
  const copy = await storage.localCopy(row.storageKey, join(deps.tmpDir, row.id));
  try {
    const [preview, meta] = await Promise.all([
      extractRawPreview(exiftool, copy.path, join(deps.tmpDir, `${row.id}.previews`)),
      readRawExif(exiftool, copy.path),
    ]);
    const pixels = preview
      ? await orientedPixels(preview, meta.orientation).catch((err) => {
          // A broken preview is not a broken upload: the RAW is kept, without thumbnails.
          deps.log?.warn({ err, assetId: row.id }, 'RAW preview does not decode');
          return null;
        })
      : null;
    if (!pixels) {
      await save(db, row.id, [], { ...plain, exif: meta.exif });
      return { variants: 0 };
    }
    const { data, ...raw } = pixels;
    const result = await thumbnails(deps, row.id, sharp(data, { raw }));
    await save(db, row.id, result.variants, {
      ...plain,
      kind: 'image',
      width: result.width,
      height: result.height,
      exif: meta.exif,
      palette: result.palette,
    });
    return { variants: result.variants.length };
  } finally {
    await copy.done();
  }
}

/**
 * A PDF: its page count and thumbnails of page 1, rendered by poppler with time and memory
 * limits. Encrypted or broken PDFs, or a server without poppler, leave the file ready with no
 * thumbnails: the card falls back to its badge.
 */
async function processPdf(deps: MediaDeps, row: typeof asset.$inferSelect, digest: string) {
  const { db, storage } = deps;
  const plain = { sha256: digest, mime: 'application/pdf', status: 'ready' as const };
  const { pdftoppm, pdfinfo } = await mediaTools();
  if (deps.pdf === false || !pdftoppm || !pdfinfo) {
    await save(db, row.id, [], { ...plain, pageCount: null });
    return { variants: 0 };
  }
  await mkdir(deps.tmpDir, { recursive: true });
  const copy = await storage.localCopy(row.storageKey, join(deps.tmpDir, row.id));
  const prefix = join(deps.tmpDir, `${row.id}.page1`);
  try {
    const { pageCount } = await readPdfInfo(pdfinfo, copy.path);
    const page = pageCount ? await renderFirstPage(pdftoppm, copy.path, prefix) : null;
    if (!page) {
      await save(db, row.id, [], { ...plain, pageCount });
      return { variants: 0, pageCount };
    }
    const result = await thumbnails(deps, row.id, sharp(page, { failOn: 'error' }));
    await save(db, row.id, result.variants, {
      ...plain,
      pageCount,
      width: result.width,
      height: result.height,
      palette: result.palette,
    });
    return { variants: result.variants.length, pageCount };
  } finally {
    await copy.done();
    await rm(`${prefix}.png`, { force: true });
  }
}

/**
 * Where the playable copy of a video stands before the poster is saved: `queued` when one is
 * to be made (the caller queues it), `ready` when an earlier run made it, `skipped` when the
 * instance does not make it, null when the original plays as it is.
 */
async function proxyState(
  deps: MediaDeps,
  assetId: string,
  container: string,
  info: VideoInfo | null,
  size: number,
): Promise<(typeof asset.$inferInsert)['proxyStatus']> {
  if (!info) return null;
  const plan = proxyPlan(container, info, size, deps.proxies ?? DEFAULT_PROXY_SETTINGS);
  if (plan === 'none') return null;
  if (plan === 'skip' || !deps.enqueueProxy) return 'skipped';
  const [made] = await deps.db
    .select({ size: assetVariant.size })
    .from(assetVariant)
    .where(and(eq(assetVariant.assetId, assetId), eq(assetVariant.size, 'proxy')));
  return made ? 'ready' : 'queued';
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
    variants.push({
      assetId,
      size,
      width: out.width,
      height: out.height,
      storageKey: key,
      bytes: data.length,
    });
  }
  return { variants, widths, width: info.width, height: info.height, palette: palette(colours) };
}

/**
 * Moving WebP copies of the thumbnails of an animated source, at keys of their own
 * (`variants/<assetId>/<size>-animated.webp`), never rows: the database has no room for a
 * second variant at the same size, and whether one exists is derived from these caps.
 * Returns how many were written; 0 when the source is too long or the result too heavy,
 * and the posters stay the only variants. A source that does not decode frame by frame is
 * never an error for the asset: the posters are already saved, and this pass just gives up.
 */
async function animatedThumbnails(
  deps: MediaDeps,
  assetId: string,
  source: string,
  widths: number[],
  caps: AnimatedCaps,
  meta: { frames: number; width: number; height: number; delays?: number[] | undefined },
) {
  // Whatever a previous run wrote goes: the source may no longer move, or no longer fit.
  await deps.storage.remove(animatedKeys(assetId));
  if (!fitsAnimatedCaps(meta, caps)) return 0;
  const targets = widths
    .filter((w) => w <= caps.maxWidth)
    .map((width) => ({ width, key: animatedVariantKey(assetId, String(width)) }));
  if (targets.length === 0) return 0;

  try {
    // Every frame is decoded once, at its own size: decoding the source again for each
    // variant is what the caps above are about, and it would pay that cost three times.
    const { data: pixels, info } = await sharp(source, { animated: true, failOn: 'none' })
      .rotate()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pageHeight = info.pageHeight;
    if (!pageHeight || pageHeight >= info.height) return 0;
    const pages = Math.round(info.height / pageHeight);
    const raw = {
      width: info.width,
      height: info.height,
      // Animated WebPs decode to RGB, GIFs to RGBA: the buffer is as wide as it says.
      channels: info.channels as 3 | 4,
      pageHeight,
    };
    // Timings are lost in the raw pixels: they come from the metadata of the source.
    const delay = meta.delays?.length === pages ? meta.delays : undefined;

    const rendered: Array<{ key: string; data: Buffer }> = [];
    let bytes = 0;
    for (const target of targets) {
      const { data } = await sharp(pixels, { raw, animated: true })
        .resize({ width: target.width, withoutEnlargement: true })
        .webp({ quality: 80, effort: 4, loop: 0, delay })
        .toBuffer({ resolveWithObject: true });
      bytes += data.length;
      if (bytes > caps.maxBytes) return 0;
      rendered.push({ key: target.key, data });
    }
    for (const r of rendered) await deps.storage.write(r.key, r.data, 'image/webp');
    return rendered.length;
  } catch (err) {
    // A corrupt frame must not cost the asset: the posters are saved, the motion is not.
    deps.log?.warn({ err, assetId }, 'moving thumbnails failed: keeping the posters');
    await deps.storage.remove(animatedKeys(assetId));
    return 0;
  }
}

async function save(
  db: Database,
  assetId: string,
  variants: Array<typeof assetVariant.$inferInsert>,
  fields: Partial<typeof asset.$inferInsert>,
) {
  await db.transaction(async (tx) => {
    // The playable copy of a video is made by a job of its own and outlives a second pass.
    await tx
      .delete(assetVariant)
      .where(and(eq(assetVariant.assetId, assetId), ne(assetVariant.size, 'proxy')));
    if (variants.length > 0) await tx.insert(assetVariant).values(variants);
    await tx.update(asset).set(fields).where(eq(asset.id, assetId));
  });
}

/** Called when the last retry failed. */
export async function markFailed(db: Database, assetId: string) {
  await db.update(asset).set({ status: 'failed' }).where(eq(asset.id, assetId));
}
