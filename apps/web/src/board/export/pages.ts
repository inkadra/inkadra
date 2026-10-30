// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pages of an export as a list of drawing operations, in PDF points (1/72 in) with the origin
 * at the top left. The PDF and the canvas backends draw the same list (decision 0038).
 */

import {
  croppedRotatedSize,
  FULL_CROP,
  hasImageTransform,
  normalizeRotation,
  rotatedBounds,
  sanitizeCrop,
} from '../image-crop.ts';

export type FontWeight = 400 | 500 | 600;

export type Op =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      stroke?: string;
      lineWidth?: number;
      radius?: number;
      dash?: number[];
    }
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
      dash?: number[];
    }
  /** `y` is the baseline. */
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      weight: FontWeight;
      color: string;
    }
  /** A picture filling the box: cropped (`cover`) or letterboxed (`contain`). */
  | {
      kind: 'image';
      key: string;
      x: number;
      y: number;
      w: number;
      h: number;
      fit: 'cover' | 'contain';
      opacity?: number;
      crop?: { x: number; y: number; w: number; h: number };
      rotation?: number;
    }
  /** Flat list x0, y0, x1, y1, … of an open line with round caps and joins. */
  | { kind: 'polyline'; points: number[]; color: string; width: number; opacity?: number }
  | { kind: 'polygon'; points: number[]; fill: string }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      stroke: string;
      width: number;
    }
  /** Operations drawn inside a (rounded) box and cut at its edges. */
  | { kind: 'clip'; x: number; y: number; w: number; h: number; radius?: number; ops: Op[] };

export interface Page {
  width: number;
  height: number;
  ops: Op[];
}

/** Natural size of a picture, used to keep its proportions. */
export interface ImageInfo {
  width: number;
  height: number;
}

export type Measure = (text: string, size: number, weight: FontWeight) => number;

/** Path of a rectangle with rounded corners, top-left origin, for SVG and canvas alike. */
export function roundedRectPath(x: number, y: number, w: number, h: number, r = 0): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  // 0.5523 places the control points of a cubic curve that follows a quarter circle.
  const k = rr * 0.5523;
  return [
    `M${x + rr} ${y}`,
    `H${x + w - rr}`,
    `C${x + w - rr + k} ${y} ${x + w} ${y + rr - k} ${x + w} ${y + rr}`,
    `V${y + h - rr}`,
    `C${x + w} ${y + h - rr + k} ${x + w - rr + k} ${y + h} ${x + w - rr} ${y + h}`,
    `H${x + rr}`,
    `C${x + rr - k} ${y + h} ${x} ${y + h - rr + k} ${x} ${y + h - rr}`,
    `V${y + rr}`,
    `C${x} ${y + rr - k} ${x + rr - k} ${y} ${x + rr} ${y}`,
    'Z',
  ].join('');
}

/** Box a picture is drawn in so that it covers or fits the target box, centred. */
export function fitBox(
  info: ImageInfo,
  box: { x: number; y: number; w: number; h: number },
  fit: 'cover' | 'contain',
) {
  const ratio = info.width / info.height;
  const boxRatio = box.w / box.h;
  const wider = ratio > boxRatio;
  const w = fit === 'cover' ? (wider ? box.h * ratio : box.w) : wider ? box.w : box.h * ratio;
  const h = w / ratio;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * Computes the unrotated image dimensions `(drawW, drawH)`, center `(cx, cy)` in page coordinates,
 * and clockwise rotation `rotation` so that the cropped + rotated region fills `op` according to `op.fit`.
 */
export function imagePlacement(
  info: ImageInfo,
  op: Pick<Extract<Op, { kind: 'image' }>, 'x' | 'y' | 'w' | 'h' | 'fit' | 'crop' | 'rotation'>,
): {
  transformed: boolean;
  cx: number;
  cy: number;
  drawW: number;
  drawH: number;
  rotation: number;
} {
  if (!hasImageTransform({ crop: op.crop, rotation: op.rotation })) {
    const box = fitBox(info, op, op.fit);
    return {
      transformed: false,
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
      drawW: box.w,
      drawH: box.h,
      rotation: 0,
    };
  }
  const rot = normalizeRotation(op.rotation);
  const c = op.crop ? sanitizeCrop(op.crop) : FULL_CROP;
  const rBounds = rotatedBounds(info.width, info.height, rot);
  const eff = croppedRotatedSize(info.width, info.height, c, rot);
  const dest = fitBox(eff, op, op.fit);
  const planeW = dest.w / c.w;
  const planeH = dest.h / c.h;
  const planeX = dest.x - c.x * planeW;
  const planeY = dest.y - c.y * planeH;
  return {
    transformed: true,
    cx: planeX + planeW / 2,
    cy: planeY + planeH / 2,
    drawW: info.width * (planeW / rBounds.width),
    drawH: info.height * (planeH / rBounds.height),
    rotation: rot,
  };
}
