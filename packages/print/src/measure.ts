// SPDX-License-Identifier: MPL-2.0
import fontkit from '@pdf-lib/fontkit';
import type { FontWeight, Measure } from './ops.ts';

type Font = ReturnType<typeof fontkit.create>;

const drawable = (font: Font, ch: string) =>
  /\s/.test(ch) || font.hasGlyphForCodePoint(ch.codePointAt(0) ?? 32);

/**
 * True when the font of `bytes` can draw the character (white space always can). The caller
 * supplies the bytes; the package ships no font files.
 */
export function fontCoverage(bytes: Uint8Array): (ch: string) => boolean {
  const font = fontkit.create(bytes);
  return (ch) => drawable(font, ch);
}

/**
 * Width of a text from the advance of each glyph, which is how the PDF places them (no kerning);
 * the canvas backend turns kerning off to match. Heading text the heading font cannot draw is
 * measured in weight 600, as it is drawn.
 */
export function measureFrom(bytes: Record<FontWeight, Uint8Array>): Measure {
  const fonts = {
    400: fontkit.create(bytes[400]),
    500: fontkit.create(bytes[500]),
    600: fontkit.create(bytes[600]),
    700: fontkit.create(bytes[700]),
    heading: fontkit.create(bytes.heading),
  };
  const headingCovers = (text: string) => [...text].every((ch) => drawable(fonts.heading, ch));
  const advances = new Map<string, number>();
  return (text, size, asked) => {
    const weight = asked === 'heading' && !headingCovers(text) ? 600 : asked;
    const font = fonts[weight];
    let units = 0;
    for (const ch of text) {
      const key = `${weight}${ch}`;
      let advance = advances.get(key);
      if (advance === undefined) {
        advance = font.glyphForCodePoint(ch.codePointAt(0) ?? 32).advanceWidth;
        advances.set(key, advance);
      }
      units += advance;
    }
    return (units / font.unitsPerEm) * size;
  };
}
