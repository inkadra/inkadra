// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThumbnailSize } from '@inkadra/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { photoshopFixture } from './fixtures/photoshop.ts';
import { readPhotoshop } from './photoshop.ts';

let dir: string;
let seq = 0;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inkadra-psd-'));
});
async function decode(data: Buffer) {
  const file = join(dir, `${seq++}.psd`);
  await writeFile(file, data);
  return readPhotoshop(file);
}
const cases = [1, 2].flatMap((version) =>
  [8, 16].flatMap((depth) =>
    [false, true].flatMap((gray) => [false, true].map((rle) => ({ version, depth, gray, rle }))),
  ),
);
describe('Photoshop saved composite', () => {
  it.each(cases)('reads $version / $depth bit / gray $gray / RLE $rle', async (opts) => {
    const fixture = photoshopFixture(opts);
    const result = await decode(fixture.data);
    expect(result.pixels).toEqual({
      data: fixture.expected,
      width: 4,
      height: 2,
      channels: opts.gray ? 1 : 3,
    });
    expect(result.layerCount).toBe(0);
  });
  it('subsamples a large sparse raw composite into a bounded buffer', async () => {
    const fixture = photoshopFixture();
    const header = Buffer.from(
      fixture.data.subarray(0, fixture.data.length - fixture.expected.length),
    );
    const width = 10_000;
    const height = 9_999;
    header.writeUInt32BE(height, 14);
    header.writeUInt32BE(width, 18);
    const path = join(dir, 'large-sparse.psd');
    const file = await open(path, 'w');
    try {
      await file.truncate(header.length + width * height * 3);
      await file.write(header, 0, header.length, 0);
      for (const [channel, x, y, value] of [
        [0, 5, 5, 17],
        [0, 6, 5, 222],
        [2, 9995, 9995, 99],
        [1, 0, 0, 33],
      ] as const) {
        await file.write(
          Buffer.from([value]),
          0,
          1,
          header.length + channel * width * height + y * width + x,
        );
      }
    } finally {
      await file.close();
    }
    const { pixels } = await readPhotoshop(path);
    expect(pixels?.width).toBe(2000);
    expect(pixels?.height).toBe(2000);
    expect(pixels?.data.length).toBe(2000 * 2000 * 3);
    expect(pixels?.data.length).toBeLessThanOrEqual(
      Math.max(...ThumbnailSize.options.map(Number)) ** 2 * 3,
    );
    expect(pixels?.data[1]).toBe(33);
    expect(pixels?.data[(2000 + 1) * 3]).toBe(17);
    expect(pixels?.data[(2000 * 2000 - 1) * 3 + 2]).toBe(99);
  });

  it('still validates packed rows that are not retained in the subsampled output', async () => {
    const header = Buffer.from(photoshopFixture({ gray: true, rle: true }).data.subarray(0, 44));
    header.writeUInt32BE(2049, 18);
    const row = Buffer.concat([
      ...Array.from({ length: 16 }, () => Buffer.from([129, 7])),
      Buffer.from([0, 7]),
    ]);
    header.writeUInt16BE(row.length, 40);
    header.writeUInt16BE(row.length, 42);
    const valid = await decode(Buffer.concat([header, row, row]));
    expect(valid.pixels?.width).toBe(1025);
    expect(valid.pixels ? valid.document : null).toEqual({ width: 2049, height: 2 });
    expect(valid.pixels?.height).toBe(1);
    expect(valid.pixels?.data.every((value) => value === 7)).toBe(true);
    header.writeUInt16BE(1, 42);
    expect((await decode(Buffer.concat([header, row, Buffer.from([128])]))).pixels).toBeNull();
  });

  it.each([1, 2])('reads the absolute signed layer count in v%s', async (version) => {
    expect((await decode(photoshopFixture({ version, layers: -24 }).data)).layerCount).toBe(24);
  });
  it('does not invent a zero count when only tagged layer info may be present', async () => {
    const fixture = photoshopFixture();
    const file = Buffer.concat([
      fixture.data.subarray(0, 34),
      Buffer.from([0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]),
      fixture.data.subarray(38),
    ]);
    const result = await decode(file);
    expect(result.layerCount).toBeNull();
    expect(result.pixels?.data).toEqual(fixture.expected);
  });
  it.each([
    'huge',
    'pixel cap',
    'length',
    'truncated',
    'reserved',
    'channels',
    'RLE overflow',
    'RLE underflow',
    'RLE repeat',
    'PSB length',
  ])('rejects %s without pixels', async (attack) => {
    const { data } = photoshopFixture({
      version: attack === 'PSB length' ? 2 : 1,
      rle: attack.startsWith('RLE'),
    });
    let file = Buffer.from(data);
    if (attack === 'huge') file.writeUInt32BE(0xffffffff, 18);
    if (attack === 'pixel cap') {
      file.writeUInt32BE(30_000, 18);
      file.writeUInt32BE(30_000, 14);
    }
    if (attack === 'length') file.writeUInt32BE(0xffffffff, 26);
    if (attack === 'truncated') file = file.subarray(0, file.length - 1);
    if (attack === 'reserved') file[6] = 1;
    if (attack === 'channels') file.writeUInt16BE(0, 12);
    if (attack === 'RLE overflow') file[52] = 127;
    if (attack === 'RLE underflow') file[52] = 128;
    if (attack === 'RLE repeat') file[52] = 255;
    if (attack === 'PSB length') file.writeBigUInt64BE(2n ** 63n, 34);
    expect((await decode(file)).pixels).toBeNull();
  });
  it('decodes repeat runs and no-ops, and preserves layer metadata for unsupported encodings', async () => {
    const { data } = photoshopFixture({ gray: true, rle: true });
    const file = Buffer.concat([data.subarray(0, 44), Buffer.from([128, 253, 7, 253, 9])]);
    file.writeUInt16BE(3, 40);
    file.writeUInt16BE(2, 42);
    expect((await decode(file)).pixels?.data).toEqual(Buffer.from([7, 7, 7, 7, 9, 9, 9, 9]));
    const unsupported = photoshopFixture({ layers: -3 }).data;
    unsupported.writeUInt16BE(32, 22);
    expect(await decode(unsupported)).toEqual({ pixels: null, layerCount: 3 });
  });
});
