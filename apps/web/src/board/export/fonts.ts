// SPDX-License-Identifier: AGPL-3.0-only

import regular from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
// Inter, the interface font (OFL-1.1). WOFF rather than WOFF2: fontkit reads it without Brotli.
import medium from '@fontsource/inter/files/inter-latin-500-normal.woff?url';
import semibold from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import fontkit from '@pdf-lib/fontkit';
import type { FontWeight, Measure } from './pages.ts';

export interface Fonts {
  bytes: Record<FontWeight, Uint8Array>;
  measure: Measure;
}

const URLS: Record<FontWeight, string> = { 400: regular, 500: medium, 600: semibold };
let loading: Promise<Fonts> | null = null;

/** The three weights of Inter, fetched once, and a text measure from their own metrics. */
export function loadFonts(): Promise<Fonts> {
  loading ??= (async () => {
    const entries = await Promise.all(
      ([400, 500, 600] as const).map(async (weight) => {
        const res = await fetch(URLS[weight]);
        if (!res.ok) throw new Error(`Font ${weight} could not be loaded.`);
        return [weight, new Uint8Array(await res.arrayBuffer())] as const;
      }),
    );
    const bytes = Object.fromEntries(entries) as Record<FontWeight, Uint8Array>;
    return { bytes, measure: measureFrom(bytes) };
  })().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * Width of a text from the advance of each glyph, which is how the PDF places them (no kerning);
 * the canvas backend turns kerning off to match.
 */
function measureFrom(bytes: Record<FontWeight, Uint8Array>): Measure {
  const fonts = {
    400: fontkit.create(bytes[400]),
    500: fontkit.create(bytes[500]),
    600: fontkit.create(bytes[600]),
  };
  const advances = new Map<string, number>();
  return (text, size, weight) => {
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
