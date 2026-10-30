// SPDX-License-Identifier: AGPL-3.0-only
import type { ImageCrop, ImageCropAspect } from '@inkadra/doc-schema';

export const FULL_CROP: ImageCrop = { x: 0, y: 0, w: 1, h: 1 };

export const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type CropHandle = (typeof CROP_HANDLES)[number];

/** Smallest crop the editor lets a hand drag to; documents may hold smaller ones. */
const MIN_CROP_SIZE = 0.05;
const EPS = 1e-4;
/** Smallest crop any renderer keeps: the rounding step, so every positive schema value survives. */
const MIN_STORED_SIZE = 1e-4;

function round4(n: number): number {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Normalizes a rotation angle in degrees into `(-180, 180]`, with `0` for multiples of 360. */
export function normalizeRotation(deg = 0): number {
  if (!Number.isFinite(deg)) return 0;
  let r = ((deg % 360) + 360) % 360;
  if (r > 180) r -= 360;
  const rounded = Math.round(r * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Splits any rotation angle into the nearest 90° step (`0 | 90 | 180 | 270`) and fine angle (`[-45, 45]`). */
export function splitRotation(rotation = 0): { base: 0 | 90 | 180 | 270; fine: number } {
  const norm = ((rotation % 360) + 360) % 360;
  const nearestQuarter = Math.round(norm / 90) * 90;
  const base = (nearestQuarter % 360) as 0 | 90 | 180 | 270;
  let fine = norm - nearestQuarter;
  if (fine > 180) fine -= 360;
  if (fine <= -180) fine += 360;
  const roundedFine = Math.round(fine * 10) / 10;
  return { base, fine: Object.is(roundedFine, -0) ? 0 : roundedFine };
}

/** Clamps and rounds a crop rectangle so it always satisfies `ImageCrop` schema bounds. */
export function sanitizeCrop(crop?: Partial<ImageCrop> | null): ImageCrop {
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

/** True when the crop covers the full `[0, 1] x [0, 1]` frame. */
export function isIdentityCrop(crop?: ImageCrop | null): boolean {
  if (!crop) return true;
  return (
    Math.abs(crop.x) < EPS &&
    Math.abs(crop.y) < EPS &&
    Math.abs(crop.w - 1) < EPS &&
    Math.abs(crop.h - 1) < EPS &&
    (!crop.aspect || crop.aspect === 'free')
  );
}

/** True when an image element has a non-identity crop or non-zero rotation. */
export function hasImageTransform(el: {
  crop?: ImageCrop | undefined;
  rotation?: number | undefined;
}): boolean {
  if (!isIdentityCrop(el.crop)) return true;
  return Math.abs(normalizeRotation(el.rotation)) >= EPS;
}

/** Bounding box dimensions of an image `(width, height)` rotated by `rotation` degrees. */
export function rotatedBounds(
  width: number,
  height: number,
  rotation = 0,
): { width: number; height: number } {
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
  const rot = rotatedBounds(width, height, rotation);
  const c = sanitizeCrop(crop);
  return {
    width: Math.max(1e-3, rot.width * c.w),
    height: Math.max(1e-3, rot.height * c.h),
  };
}

/** Numeric width/height ratio for a preset, or null for `'free'`. */
export function cropAspectValue(preset: ImageCropAspect | undefined): number | null {
  switch (preset) {
    case '1:1':
      return 1;
    case '4:3':
      return 4 / 3;
    case '16:9':
      return 16 / 9;
    case '2.39:1':
      return 2.39;
    default:
      return null;
  }
}

/** Fits the largest centered crop rectangle matching `preset` inside the rotated image bounds. */
export function fitCropToAspect(
  current: ImageCrop,
  preset: ImageCropAspect,
  rotWidth: number,
  rotHeight: number,
): ImageCrop {
  if (preset === 'free') {
    return sanitizeCrop({ ...current, aspect: 'free' });
  }
  const ratio = cropAspectValue(preset);
  if (!ratio) return sanitizeCrop({ ...current, aspect: 'free' });
  const rw = rotWidth > 0 ? rotWidth : 4;
  const rh = rotHeight > 0 ? rotHeight : 3;
  // Normalized w/h ratio so that (w * rw) / (h * rh) = ratio
  const normRatio = (ratio * rh) / rw;
  const w = Math.min(normRatio, 1);
  const h = normRatio >= 1 ? 1 / normRatio : 1;
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  const x = clamp(cx - w / 2, 0, Math.max(0, 1 - w));
  const y = clamp(cy - h / 2, 0, Math.max(0, 1 - h));
  return sanitizeCrop({ x, y, w, h, aspect: preset });
}

/**
 * Keeps a preset crop at its aspect after the rotated bounds change (fine angle), around its
 * center and at its width where it fits. Free crops are returned as they are.
 */
export function conformCropAspect(crop: ImageCrop, rotWidth: number, rotHeight: number): ImageCrop {
  const ratio = cropAspectValue(crop.aspect);
  if (!ratio) return sanitizeCrop(crop);
  const normRatio = (ratio * (rotHeight > 0 ? rotHeight : 3)) / (rotWidth > 0 ? rotWidth : 4);
  let w = crop.w;
  let h = w / normRatio;
  if (h > 1) {
    h = 1;
    w = normRatio;
  }
  if (w > 1) {
    w = 1;
    h = 1 / normRatio;
  }
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  return sanitizeCrop({
    x: clamp(cx - w / 2, 0, Math.max(0, 1 - w)),
    y: clamp(cy - h / 2, 0, Math.max(0, 1 - h)),
    w,
    h,
    aspect: crop.aspect,
  });
}

/**
 * Crop after a 90° step. A free crop turns with the picture; a preset is the shape of the
 * result, so it stays landscape or portrait as chosen and is refitted, largest and centered
 * on the turned rectangle, inside the new bounds.
 */
export function cropAfterQuarterTurn(
  crop: ImageCrop,
  direction: 1 | -1,
  rotWidth: number,
  rotHeight: number,
): ImageCrop {
  if (isIdentityCrop(crop)) return crop;
  const turned = rotateCrop90(crop, direction);
  return crop.aspect && crop.aspect !== 'free'
    ? fitCropToAspect(turned, crop.aspect, rotWidth, rotHeight)
    : turned;
}

/**
 * True when the crop lies on the picture: at a free angle the corners of the rotated bounding
 * box are empty, and a crop reaching into them would show the canvas behind.
 */
export function cropInsideImage(
  crop: ImageCrop,
  width: number,
  height: number,
  rotation = 0,
): boolean {
  const b = rotatedBounds(width, height, rotation);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tolerance = 0.5;
  for (const [nx, ny] of [
    [crop.x, crop.y],
    [crop.x + crop.w, crop.y],
    [crop.x, crop.y + crop.h],
    [crop.x + crop.w, crop.y + crop.h],
  ] as const) {
    const u = (nx - 0.5) * b.width;
    const v = (ny - 0.5) * b.height;
    // Back into the unrotated picture's frame.
    const px = u * cos + v * sin;
    const py = -u * sin + v * cos;
    if (Math.abs(px) > width / 2 + tolerance || Math.abs(py) > height / 2 + tolerance) return false;
  }
  return true;
}

/**
 * Shrinks a crop that reaches into the empty corners of a free-angle rotation to the largest
 * rectangle of the same aspect centered on the picture, so no empty corner is ever shown.
 */
export function inscribeCrop(
  crop: ImageCrop,
  width: number,
  height: number,
  rotation = 0,
): ImageCrop {
  const W = width > 0 ? width : 4;
  const H = height > 0 ? height : 3;
  if (cropInsideImage(crop, W, H, rotation)) return crop;
  const b = rotatedBounds(W, H, rotation);
  const ratio = cropAspectValue(crop.aspect) ?? (crop.w * b.width) / (crop.h * b.height);
  const rad = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  // Corners (±w/2, ±h/2) with w = ratio·h stay inside the W×H picture turned by the angle.
  const h = Math.min(W / (ratio * c + s), H / (ratio * s + c));
  const nw = Math.min(1, (ratio * h) / b.width);
  const nh = Math.min(1, h / b.height);
  return sanitizeCrop({
    x: (1 - nw) / 2,
    y: (1 - nh) / 2,
    w: nw,
    h: nh,
    ...(crop.aspect ? { aspect: crop.aspect } : {}),
  });
}

/** Rotates a normalized crop rectangle by +90° CW (`1`) or -90° CCW (`-1`) with the image. */
export function rotateCrop90(crop: ImageCrop, direction: 1 | -1): ImageCrop {
  const c = sanitizeCrop(crop);
  if (direction === 1) {
    return sanitizeCrop({
      x: 1 - (c.y + c.h),
      y: c.x,
      w: c.h,
      h: c.w,
      ...(c.aspect ? { aspect: c.aspect } : {}),
    });
  }
  return sanitizeCrop({
    x: c.y,
    y: 1 - (c.x + c.w),
    w: c.h,
    h: c.w,
    ...(c.aspect ? { aspect: c.aspect } : {}),
  });
}

/** Moves a crop rectangle by `(dx, dy)` in normalized `[0, 1]` coordinates. */
export function moveCropRect(start: ImageCrop, dx: number, dy: number): ImageCrop {
  const x = clamp(start.x + dx, 0, Math.max(0, 1 - start.w));
  const y = clamp(start.y + dy, 0, Math.max(0, 1 - start.h));
  return sanitizeCrop({
    ...start,
    x,
    y,
  });
}

/** Resizes a crop rectangle from one of its 8 handles in normalized `[0, 1]` coordinates. */
export function resizeCropRect(
  start: ImageCrop,
  handle: CropHandle,
  dx: number,
  dy: number,
  rotWidth: number,
  rotHeight: number,
): ImageCrop {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_CROP_SIZE);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_CROP_SIZE, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_CROP_SIZE);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_CROP_SIZE, 1);

  let w = right - left;
  let h = bottom - top;

  const targetAspect = cropAspectValue(start.aspect);
  if (targetAspect && rotWidth > 0 && rotHeight > 0) {
    const normRatio = (targetAspect * rotHeight) / rotWidth;
    const maxW = handle.includes('w') ? right : handle.includes('e') ? 1 - left : 1;
    const maxH = handle.includes('n') ? bottom : handle.includes('s') ? 1 - top : 1;

    if (handle === 'n' || handle === 's') {
      w = h * normRatio;
      if (w > 1) {
        w = 1;
        h = w / normRatio;
      }
      const cx = (left + right) / 2;
      left = clamp(cx - w / 2, 0, 1 - w);
      right = left + w;
      if (handle === 'n') top = bottom - h;
      else bottom = top + h;
    } else if (handle === 'e' || handle === 'w') {
      h = w / normRatio;
      if (h > 1) {
        h = 1;
        w = h * normRatio;
      }
      const cy = (top + bottom) / 2;
      top = clamp(cy - h / 2, 0, 1 - h);
      bottom = top + h;
      if (handle === 'w') left = right - w;
      else right = left + w;
    } else {
      // Corner handle
      if (w / h > normRatio) {
        w = h * normRatio;
      } else {
        h = w / normRatio;
      }
      if (w > maxW) {
        w = maxW;
        h = w / normRatio;
      }
      if (h > maxH) {
        h = maxH;
        w = h * normRatio;
      }
      if (w < MIN_CROP_SIZE) {
        w = MIN_CROP_SIZE;
        h = w / normRatio;
      }
      if (h < MIN_CROP_SIZE) {
        h = MIN_CROP_SIZE;
        w = h * normRatio;
      }
      if (handle.includes('w')) left = right - w;
      else right = left + w;
      if (handle.includes('n')) top = bottom - h;
      else bottom = top + h;
    }
  }

  return sanitizeCrop({
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
    ...(start.aspect ? { aspect: start.aspect } : {}),
  });
}
