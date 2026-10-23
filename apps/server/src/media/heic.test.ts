import { describe, expect, it } from 'vitest';
import { isHeic } from './heic.ts';

function ftyp(major: string, ...compatible: string[]) {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  const bytes = new Uint8Array(size + 8);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(
    [...`ftyp${brands}`].map((c) => c.charCodeAt(0)),
    4,
  );
  return bytes;
}

describe('isHeic', () => {
  it('recognises iPhone photos', () => {
    expect(isHeic(ftyp('heic', 'mif1', 'heic'))).toBe(true);
    expect(isHeic(ftyp('mif1', 'heic'))).toBe(true);
  });

  it('leaves AVIF and other files to sharp', () => {
    expect(isHeic(ftyp('avif', 'mif1', 'miaf'))).toBe(false);
    expect(isHeic(ftyp('mif1', 'avif'))).toBe(false);
    expect(isHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]))).toBe(false);
  });
});
