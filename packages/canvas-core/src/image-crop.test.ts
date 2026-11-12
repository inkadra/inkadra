// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  croppedRotatedSize,
  FULL_CROP,
  hasImageTransform,
  isIdentityCrop,
  normalizeImageRotation,
  rotatedBounds,
  sanitizeCrop,
} from './image-crop.ts';

describe('image crop geometry', () => {
  it('reads a missing crop as the whole picture and clamps the others into it', () => {
    expect(sanitizeCrop(undefined)).toEqual(FULL_CROP);
    expect(sanitizeCrop({ x: 0.9, y: -1, w: 0.5, h: 2, aspect: '1:1' })).toEqual({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 1,
      aspect: '1:1',
    });
    expect(sanitizeCrop({ x: 0.123456, w: 0 })).toEqual({ x: 0.1235, y: 0, w: 0.0001, h: 1 });
  });

  it('bounds a rotated picture, with 4:3 for unknown sizes', () => {
    expect(rotatedBounds(0, 0)).toEqual({ width: 4, height: 3 });
    const quarter = rotatedBounds(400, 300, 90);
    expect(quarter.width).toBeCloseTo(300);
    expect(quarter.height).toBeCloseTo(400);
    const size = croppedRotatedSize(400, 300, { x: 0, y: 0, w: 0.5, h: 1 }, 0);
    expect(size).toEqual({ width: 200, height: 300 });
  });
});

describe('crop geometry as React Native worklets', () => {
  it("starts every exported function with the 'worklet' directive", () => {
    for (const fn of [sanitizeCrop, rotatedBounds, croppedRotatedSize]) {
      expect(fn.toString()).toMatch(/^[^{]*\{\s*['"]worklet['"]/);
    }
  });

  it('gives the same sizes for a few rotations and crops', () => {
    const diagonal = rotatedBounds(400, 300, 45);
    expect(diagonal.width).toBeCloseTo(494.975);
    expect(diagonal.height).toBeCloseTo(494.975);
    expect(rotatedBounds(400, 300, -30).width).toBeCloseTo(496.41);
    const turned = croppedRotatedSize(400, 300, { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, 90);
    expect(turned.width).toBeCloseTo(150);
    expect(turned.height).toBeCloseTo(320);
    const unknown = croppedRotatedSize(0, 0, null, 180);
    expect(unknown.width).toBeCloseTo(4);
    expect(unknown.height).toBeCloseTo(3);
  });
});

describe('image transform', () => {
  it('turns a rotation into (-180, 180] and sees a crop or an angle as a transform', () => {
    expect(normalizeImageRotation(270)).toBe(-90);
    expect(normalizeImageRotation(-180)).toBe(180);
    expect(normalizeImageRotation(720)).toBe(0);
    expect(normalizeImageRotation(Number.NaN)).toBe(0);
    expect(isIdentityCrop({ ...FULL_CROP, aspect: 'free' })).toBe(true);
    expect(isIdentityCrop({ ...FULL_CROP, aspect: '1:1' })).toBe(false);
    expect(hasImageTransform({ rotation: 360 })).toBe(false);
    expect(hasImageTransform({ rotation: 0.5 })).toBe(true);
    expect(hasImageTransform({ crop: { x: 0, y: 0, w: 0.5, h: 1 } })).toBe(true);
  });
});
