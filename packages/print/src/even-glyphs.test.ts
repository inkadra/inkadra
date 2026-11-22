// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { evenGlyphs } from './even-glyphs.ts';

const require = createRequire(import.meta.url);
const inter = readFileSync(
  require.resolve('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
);
const lengths = (bytes: Uint8Array) => {
  // `loca` is a table fontkit decodes but does not type.
  const font = fontkit.create(Buffer.from(bytes)) as unknown as { loca: { offsets: number[] } };
  const offsets = font.loca.offsets;
  return offsets.slice(1).map((end, i) => end - (offsets[i] ?? 0));
};

describe('evenGlyphs', () => {
  it('pads every odd glyph by one byte and keeps every outline', () => {
    expect(lengths(inter).some((length) => length % 2 === 1)).toBe(true);
    const even = evenGlyphs(inter);
    expect(lengths(even)).toEqual(lengths(inter).map((length) => length + (length % 2)));
    const [before, after] = [inter, even].map((bytes) => fontkit.create(Buffer.from(bytes)));
    for (const id of [0, 1, 36, 500, 2000]) {
      expect(after?.getGlyph(id).path.toSVG()).toBe(before?.getGlyph(id).path.toSVG());
    }
    // The whole font sums to the magic number again, as its checksum adjustment promises.
    const view = new DataView(even.buffer, even.byteOffset, even.length);
    let sum = 0;
    for (let i = 0; i < even.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });

  it('returns a font with no odd glyph, or no TrueType outlines, as given', () => {
    const even = evenGlyphs(inter);
    expect(evenGlyphs(even)).toBe(even);
    const woff = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(evenGlyphs(woff)).toBe(woff);
  });
});
