// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset } from '@inkadra/shared';
import { fetchAsset, getCachedAsset } from '../assets.ts';
import type { ImageInfo } from './pages.ts';

/** A picture ready for both backends: decoded for the canvas, JPEG or PNG bytes for the PDF. */
export interface LoadedImage extends ImageInfo {
  bitmap: ImageBitmap;
  bytes: Uint8Array;
  type: 'jpeg' | 'png';
}

/**
 * Smallest WebP thumbnail at least `pixels` wide, else the largest. Exports never use the
 * original file (decision 0037): thumbnails are what everyone who can open the board sees.
 */
export function thumbnailFor(asset: Asset, pixels: number): string | null {
  const variants = [...asset.variants].sort((a, b) => a.width - b.width);
  return (variants.find((v) => v.width >= pixels) ?? variants.at(-1))?.url ?? null;
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

/** Decodes a blob and re-encodes it for the PDF: JPEG for photos, PNG when it has alpha. */
export async function decodeImage(blob: Blob, keepAlpha = false): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  if (!keepAlpha) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  const type = keepAlpha ? 'png' : 'jpeg';
  const out = await canvas.convertToBlob(
    keepAlpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 },
  );
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    bytes: new Uint8Array(await out.arrayBuffer()),
    type,
  };
}

/** Loads the thumbnail of an asset, or null when it has none or it fails to load. */
export async function loadAssetImage(id: string, pixels: number): Promise<LoadedImage | null> {
  const asset = await assetMeta(id);
  if (!asset) return null;
  const url = thumbnailFor(asset, pixels);
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return await decodeImage(await res.blob());
  } catch {
    return null;
  }
}
