// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { croppedRotatedSize, FULL_CROP, rotatedBounds, sanitizeCrop } from './image-crop.ts';

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
