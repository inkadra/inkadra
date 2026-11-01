// SPDX-License-Identifier: AGPL-3.0-only
/** Small generated saved composites; resource bytes may contain a test thumbnail. */
export function photoshopFixture({
  version = 1,
  depth = 8,
  gray = false,
  rle = false,
  layers = 0,
  resources = Buffer.alloc(0),
} = {}) {
  const width = 4;
  const height = 2;
  const channels = gray ? 1 : 3;
  const header = Buffer.alloc(26);
  header.write('8BPS');
  header.writeUInt16BE(version, 4);
  header.writeUInt16BE(channels, 12);
  header.writeUInt32BE(height, 14);
  header.writeUInt32BE(width, 18);
  header.writeUInt16BE(depth, 22);
  header.writeUInt16BE(gray ? 1 : 3, 24);
  const length = (n: number, wide = false) => {
    const b = Buffer.alloc(wide ? 8 : 4);
    if (wide) b.writeBigUInt64BE(BigInt(n));
    else b.writeUInt32BE(n);
    return b;
  };
  const layerData = Buffer.alloc(2);
  layerData.writeInt16BE(layers);
  // Minimal empty layer records with no channels, normal blend mode and an empty name.
  const record = Buffer.alloc(46);
  record.write('8BIMnorm', 18);
  record[26] = 255;
  record.writeUInt32BE(12, 30);
  const info = layers
    ? Buffer.concat([layerData, ...Array.from({ length: Math.abs(layers) }, () => record)])
    : Buffer.alloc(0);
  const mask = layers
    ? Buffer.concat([length(info.length, version === 2), info, length(0)])
    : Buffer.alloc(0);
  const expected = Buffer.alloc(width * height * channels);
  const rows: Buffer[] = [];
  for (let c = 0; c < channels; c++)
    for (let y = 0; y < height; y++) {
      const row = Buffer.alloc(width * (depth / 8));
      for (let x = 0; x < width; x++) {
        const value = c * 60 + y * 20 + x * 10;
        expected[(y * width + x) * channels + c] = value;
        if (depth === 16) row.writeUInt16BE(value * 257, x * 2);
        else row[x] = value;
      }
      rows.push(rle ? Buffer.concat([Buffer.from([row.length - 1]), row]) : row);
    }
  const counts = rle
    ? Buffer.concat(
        rows.map((row) => {
          const b = Buffer.alloc(version === 2 ? 4 : 2);
          if (version === 2) b.writeUInt32BE(row.length);
          else b.writeUInt16BE(row.length);
          return b;
        }),
      )
    : Buffer.alloc(0);
  const compression = Buffer.from([0, rle ? 1 : 0]);
  const data = Buffer.concat([
    header,
    length(0),
    length(resources.length),
    resources,
    length(mask.length, version === 2),
    mask,
    compression,
    counts,
    ...rows,
  ]);
  return { data, expected, width, height, channels };
}
