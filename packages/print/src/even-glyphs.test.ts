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

  it('returns a truncated or inconsistent font as given, without throwing', () => {
    const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const table = (bytes: Uint8Array, name: string) => {
      for (let i = 0; i < view(bytes).getUint16(4); i++) {
        const record = 12 + i * 16;
        if (String.fromCharCode(...bytes.subarray(record, record + 4)) === name) return record;
      }
      throw new Error(`no ${name}`);
    };
    const broken = (change: (font: Uint8Array) => void) => {
      const font = new Uint8Array(inter);
      change(font);
      return font;
    };
    const fonts = [
      inter.subarray(0, 11),
      inter.subarray(0, 100), // the table directory itself is cut
      inter.subarray(0, inter.length / 2), // tables past the end
      // head too short to hold indexToLocFormat
      broken((f) => view(f).setUint32(table(f, 'head') + 12, 20)),
      // an indexToLocFormat that is neither short nor long
      broken((f) => view(f).setInt16(view(f).getUint32(table(f, 'head') + 8) + 50, 7)),
      // more glyphs than loca has offsets for
      broken((f) => view(f).setUint16(view(f).getUint32(table(f, 'maxp') + 8) + 4, 65535)),
      // a glyph ending before it starts
      broken((f) => view(f).setUint32(view(f).getUint32(table(f, 'loca') + 8) + 8, 0)),
      // glyphs past the end of glyf
      broken((f) => view(f).setUint32(table(f, 'glyf') + 12, 100)),
      // a table record pointing past the end of the file
      broken((f) => view(f).setUint32(table(f, 'glyf') + 8, 0xfffffff0)),
    ];
    for (const font of fonts) {
      expect(() => evenGlyphs(font)).not.toThrow();
      expect(evenGlyphs(font)).toBe(font);
    }
  });
});
