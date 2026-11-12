// SPDX-License-Identifier: MPL-2.0
import type { ImageCrop } from '@inkadra/doc-schema';

/** The whole picture: the crop of an image without one. */
export const FULL_CROP: ImageCrop = { x: 0, y: 0, w: 1, h: 1 };

/** Smallest crop any renderer keeps: the rounding step, so every positive schema value survives. */
const MIN_STORED_SIZE = 1e-4;

// 'worklet' lets the React Native app call the crop geometry on the UI thread (Reanimated copies
// FULL_CROP and MIN_STORED_SIZE into the worklet); elsewhere it is a no-op string.
function clamp(n: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, n));
}

function round4(n: number): number {
  'worklet';
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
}

/** Clamps and rounds a crop rectangle so it always satisfies `ImageCrop` schema bounds. */
export function sanitizeCrop(crop?: Partial<ImageCrop> | null): ImageCrop {
  'worklet';
  if (!crop) return { ...FULL_CROP };
  const w = round4(clamp(Number.isFinite(crop.w) ? (crop.w as number) : 1, MIN_STORED_SIZE, 1));
  const h = round4(clamp(Number.isFinite(crop.h) ? (crop.h as number) : 1, MIN_STORED_SIZE, 1));
  const x = round4(clamp(Number.isFinite(crop.x) ? (crop.x as number) : 0, 0, Math.max(0, 1 - w)));
  const y = round4(clamp(Number.isFinite(crop.y) ? (crop.y as number) : 0, 0, Math.max(0, 1 - h)));
  return {
    x,
    y,
    w: round4(Math.min(w, 1 - x)),
    h: round4(Math.min(h, 1 - y)),
    ...(crop.aspect ? { aspect: crop.aspect } : {}),
  };
}

/** Bounding box dimensions of an image `(width, height)` rotated by `rotation` degrees. */
export function rotatedBounds(
  width: number,
  height: number,
  rotation = 0,
): { width: number; height: number } {
  'worklet';
  const w = width > 0 ? width : 4;
  const h = height > 0 ? height : 3;
  const rad = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    width: Math.max(1e-3, w * c + h * s),
    height: Math.max(1e-3, w * s + h * c),
  };
}

/** Effective pixel dimensions of an image after applying `rotation` and `crop`. */
export function croppedRotatedSize(
  width: number,
  height: number,
  crop?: ImageCrop | null,
  rotation = 0,
): { width: number; height: number } {
  'worklet';
  const rot = rotatedBounds(width, height, rotation);
  const c = sanitizeCrop(crop);
  return {
    width: Math.max(1e-3, rot.width * c.w),
    height: Math.max(1e-3, rot.height * c.h),
  };
}
