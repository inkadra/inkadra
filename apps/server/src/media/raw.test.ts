import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cleanMime, kindOf } from '../http/uploads.ts';
import { orientedPixels, rawTypeOf, sniffRaw } from './raw.ts';

const bytes = (...parts: Array<string | number[]>) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? Buffer.from(p, 'latin1') : p));
  return Uint8Array.from([...out, ...new Array(64).fill(0)]);
};
const TIFF_LE = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0];

describe('RAW types', () => {
  it('names the RAW type of a file whatever the case of its extension', () => {
    expect(rawTypeOf('IMG_0001.CR3')).toBe('image/x-canon-cr3');
    expect(rawTypeOf('DSC_1.nef')).toBe('image/x-nikon-nef');
    expect(rawTypeOf('photo.jpg')).toBeNull();
    expect(rawTypeOf('dng')).toBeNull();
  });

  it('keeps RAW uploads with a vague type as images of their RAW type', () => {
    expect(cleanMime('', 'A7_0001.ARW')).toBe('image/x-sony-arw');
    expect(cleanMime('application/octet-stream', 'x.raf')).toBe('image/x-fuji-raf');
    expect(kindOf('application/octet-stream', 'x.raf')).toBe('image');
    expect(kindOf('application/octet-stream', 'notes.txt')).toBe('file');
  });

  it('tells RAW formats apart from their first bytes', () => {
    expect(sniffRaw(bytes(TIFF_LE, 'CR'), 'x', '')).toBe('image/x-canon-cr2');
    expect(sniffRaw(bytes([0, 0, 0, 24], 'ftypcrx '), 'x', '')).toBe('image/x-canon-cr3');
    expect(sniffRaw(bytes('FUJIFILMCCD-RAW 0201'), 'x', '')).toBe('image/x-fuji-raf');
    expect(sniffRaw(bytes('IIRO', [8, 0]), 'x', '')).toBe('image/x-olympus-orf');
    expect(sniffRaw(bytes([0x49, 0x49, 0x55, 0x00]), 'x', '')).toBe('image/x-panasonic-rw2');
  });

  it('needs the name or the type for RAW formats that are plain TIFF, never for photos', () => {
    expect(sniffRaw(bytes(TIFF_LE), 'DSC_0001.NEF', '')).toBe('image/x-nikon-nef');
    expect(sniffRaw(bytes(TIFF_LE), 'upload', 'image/x-adobe-dng')).toBe('image/x-adobe-dng');
    expect(sniffRaw(bytes(TIFF_LE), 'scan.tiff', 'image/tiff')).toBeNull();
    // A name alone is not enough: a JPEG called .dng stays a JPEG.
    expect(sniffRaw(bytes([0xff, 0xd8, 0xff]), 'fake.dng', 'image/x-adobe-dng')).toBeNull();
  });
});

describe('orientedPixels', () => {
  // Red on the left, blue on the right, as the sensor saw it.
  const preview = () =>
    sharp({ create: { width: 40, height: 20, channels: 3, background: '#ff0000' } })
      .composite([
        {
          input: { create: { width: 20, height: 20, channels: 3, background: '#0000ff' } },
          left: 20,
          top: 0,
        },
      ])
      .jpeg()
      .toBuffer();
  const at = (p: Awaited<ReturnType<typeof orientedPixels>>, x: number, y: number) => {
    const i = (y * p.width + x) * p.channels;
    return (p.data[i] ?? 0) > 128 ? 'red' : (p.data[i + 2] ?? 0) > 128 ? 'blue' : 'other';
  };

  it('turns and mirrors the preview the way the RAW says', async () => {
    const jpeg = await preview();
    const upright = await orientedPixels(jpeg, 1);
    expect([upright.width, upright.height, at(upright, 2, 10), at(upright, 37, 10)]).toEqual([
      40,
      20,
      'red',
      'blue',
    ]);
    const six = await orientedPixels(jpeg, 6); // 90° clockwise: left goes to the top
    expect([six.width, six.height, at(six, 10, 2), at(six, 10, 37)]).toEqual([
      20,
      40,
      'red',
      'blue',
    ]);
    const eight = await orientedPixels(jpeg, 8);
    expect([at(eight, 10, 2), at(eight, 10, 37)]).toEqual(['blue', 'red']);
    const two = await orientedPixels(jpeg, 2); // mirrored
    expect([at(two, 2, 10), at(two, 37, 10)]).toEqual(['blue', 'red']);
    const five = await orientedPixels(jpeg, 5); // transposed: left goes to the top
    expect([five.width, at(five, 10, 2), at(five, 10, 37)]).toEqual([20, 'red', 'blue']);
    const seven = await orientedPixels(jpeg, 7);
    expect([seven.width, at(seven, 10, 2), at(seven, 10, 37)]).toEqual([20, 'blue', 'red']);
  });
});
