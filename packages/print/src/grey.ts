// SPDX-License-Identifier: MPL-2.0

/** Pixels (RGBA) turned to greys in place, by their luma (Rec. 601), alpha kept. */
export function greyPixels(data: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 0; i + 3 < data.length; i += 4) {
    const y = Math.round(
      0.299 * (data[i] as number) +
        0.587 * (data[i + 1] as number) +
        0.114 * (data[i + 2] as number),
    );
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
  return data;
}
