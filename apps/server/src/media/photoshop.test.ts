// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it.each([1, 2])('reads the absolute signed layer count in v%s', async (version) => {
    expect((await decode(photoshopFixture({ version, layers: -24 }).data)).layerCount).toBe(24);
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
