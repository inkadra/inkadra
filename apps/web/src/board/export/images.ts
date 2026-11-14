// SPDX-License-Identifier: AGPL-3.0-only
import { greyPixels } from '@inkadra/print';
import type { Asset } from '@inkadra/shared';
import { fetchAsset, getCachedAsset } from '../assets.ts';
import type { ImageInfo } from './pages.ts';

// Moved to @inkadra/print (decision 0116).
export { greyPixels } from '@inkadra/print';

/**
 * A picture for one backend: decoded (`bitmap`) for the canvas, or JPEG or PNG bytes for the
 * PDF, whose bitmap is closed as soon as it is encoded so a long export holds only bytes.
 */
export interface LoadedImage extends ImageInfo {
  bitmap?: ImageBitmap;
  /** The encoded file, decoded page by page by `renderImages` so a long export holds few bitmaps. */
  blob?: Blob;
  bytes?: Uint8Array;
  type?: 'jpeg' | 'png';
}

export type ImageMode = 'bitmap' | 'blob' | 'pdf';

/** At most this many pictures are fetched and decoded at once. */
export const IMAGE_CONCURRENCY = 6;

/**
 * Smallest WebP thumbnail at least `pixels` wide, else the largest. Exports never use the
 * original file (decision 0038): thumbnails are what everyone who can open the board sees.
 */
export function thumbnailFor(asset: Asset, pixels: number): string | null {
  return variantFor(asset, pixels)?.url ?? null;
}

export function variantFor(asset: Asset, pixels: number) {
  const variants = [...asset.variants].sort((a, b) => a.width - b.width);
  return variants.find((v) => v.width >= pixels) ?? variants.at(-1);
}

async function assetOf(id: string): Promise<Asset | null> {
  let cached = getCachedAsset(id);
  if (cached === undefined) {
    await fetchAsset(id);
    cached = getCachedAsset(id);
  }
  return cached && cached !== 'missing' ? cached : null;
}

export async function assetMeta(id: string): Promise<Asset | null> {
  try {
    return await assetOf(id);
  } catch {
    return null;
  }
}

/** Decodes a blob: kept decoded for the canvas, or encoded for the PDF (JPEG, PNG with alpha). */
export async function decodeImage(
  blob: Blob,
  mode: ImageMode,
  keepAlpha = false,
): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  if (mode === 'bitmap') return { bitmap, width, height };
  if (mode === 'blob') {
    bitmap.close();
    return { width, height, blob };
  }
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    if (!keepAlpha) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0);
    const out = await canvas.convertToBlob(
      keepAlpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 },
    );
    return {
      width,
      height,
      bytes: new Uint8Array(await out.arrayBuffer()),
      type: keepAlpha ? 'png' : 'jpeg',
    };
  } finally {
    bitmap.close();
  }
}

/** Loads the thumbnail of an asset, or null when it has none or it fails to load. */
export async function loadAssetImage(
  asset: Asset,
  pixels: number,
  mode: ImageMode,
  signal?: AbortSignal,
): Promise<LoadedImage | null> {
  const url = thumbnailFor(asset, pixels);
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: 'same-origin', ...(signal ? { signal } : {}) });
    if (!res.ok) return null;
    return await decodeImage(await res.blob(), mode);
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/** Frees the decoded pictures; bytes go with the garbage collector. */
export function closeImages(images: Iterable<LoadedImage | null | undefined>) {
  for (const img of images) img?.bitmap?.close();
}

/** Runs `run` for every item, at most `limit` at a time; stops early when `signal` aborts. */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const item = items[next++] as T;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  signal?.throwIfAborted();
}

/** A picture drawn in greys on a canvas of its size, for a renderer to draw from. */
export function greyCanvas(source: CanvasImageSource, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  greyPixels(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/** The bytes of a PDF picture in greys, in the same format (decision 0110). */
export async function greyBytes(img: LoadedImage): Promise<LoadedImage | null> {
  if (!img.bytes) return null;
  const bitmap = await createImageBitmap(
    new Blob([img.bytes as BlobPart], { type: img.type === 'png' ? 'image/png' : 'image/jpeg' }),
  );
  try {
    const canvas = greyCanvas(bitmap, bitmap.width, bitmap.height);
    const out = await canvas.convertToBlob(
      img.type === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 },
    );
    return { ...img, bytes: new Uint8Array(await out.arrayBuffer()) };
  } finally {
    bitmap.close();
  }
}
