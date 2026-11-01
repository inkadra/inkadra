// SPDX-License-Identifier: AGPL-3.0-only

import regular from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
// Inter, the interface font (OFL-1.1). WOFF rather than WOFF2: fontkit reads it without Brotli.
import medium from '@fontsource/inter/files/inter-latin-500-normal.woff?url';
import semibold from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import type { ThemeFont } from '@inkadra/shared';
import fontkit from '@pdf-lib/fontkit';
import { headingFamily, headingPdfUrl, loadHeadingFont } from '../theme.ts';
import type { FontWeight, Measure, Op } from './pages.ts';

export interface Fonts {
  bytes: Record<FontWeight, Uint8Array>;
  /** CSS font stack of the heading font, for the canvas backend. */
  headingFamily: string;
  measure: Measure;
  /** True when the embedded font can draw the character (white space always can). */
  covers(ch: string): boolean;
  /** True when the heading font can draw the whole text; otherwise Inter draws it. */
  headingCovers(text: string): boolean;
}

type Inter = Record<400 | 500 | 600, Uint8Array>;
const URLS: Record<400 | 500 | 600, string> = { 400: regular, 500: medium, 600: semibold };
let inter: Promise<Inter> | null = null;
const loading = new Map<ThemeFont, Promise<Fonts>>();

async function fetchFont(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font ${url} could not be loaded.`);
  return new Uint8Array(await res.arrayBuffer());
}

function loadInter(): Promise<Inter> {
  inter ??= Promise.all(
    ([400, 500, 600] as const).map(async (w) => [w, await fetchFont(URLS[w])] as const),
  )
    .then((entries) => Object.fromEntries(entries) as Inter)
    .catch((err: unknown) => {
      inter = null;
      throw err;
    });
  return inter;
}

/**
 * The three weights of Inter and the theme's heading font (Inter 600 by default), fetched once,
 * and a text measure from their own metrics.
 */
export function loadFonts(heading: ThemeFont = 'inter'): Promise<Fonts> {
  let fonts = loading.get(heading);
  if (!fonts) {
    const url = headingPdfUrl(heading);
    fonts = Promise.all([
      loadInter(),
      url ? fetchFont(url) : null,
      // The canvas backend draws headings with the page's own copy of the font.
      loadHeadingFont(heading),
    ])
      .then(([base, extra]) => {
        const bytes = { ...base, heading: extra ?? base[600] };
        const regular = fontkit.create(bytes[400]);
        const head = fontkit.create(bytes.heading);
        const covers = (ch: string) =>
          /\s/.test(ch) || regular.hasGlyphForCodePoint(ch.codePointAt(0) ?? 32);
        const headingCovers = (text: string) =>
          [...text].every(
            (ch) => /\s/.test(ch) || head.hasGlyphForCodePoint(ch.codePointAt(0) ?? 32),
          );
        return {
          bytes,
          headingFamily: headingFamily(heading),
          measure: measureFrom(bytes, headingCovers),
          covers,
          headingCovers,
        };
      })
      .catch((err: unknown) => {
        loading.delete(heading);
        throw err;
      });
    loading.set(heading, fonts);
  }
  return fonts;
}

/** Heading text the heading font cannot draw falls back to Inter 600, as the measure did. */
export function fallbackHeadings(ops: Op[], headingCovers: (text: string) => boolean) {
  for (const op of ops) {
    if (op.kind === 'text' && op.weight === 'heading' && !headingCovers(op.text)) op.weight = 600;
    if (op.kind === 'clip') fallbackHeadings(op.ops, headingCovers);
  }
}

/**
 * Width of a text from the advance of each glyph, which is how the PDF places them (no kerning);
 * the canvas backend turns kerning off to match.
 */
function measureFrom(
  bytes: Record<FontWeight, Uint8Array>,
  headingCovers: (text: string) => boolean,
): Measure {
  const fonts = {
    400: fontkit.create(bytes[400]),
    500: fontkit.create(bytes[500]),
    600: fontkit.create(bytes[600]),
    heading: fontkit.create(bytes.heading),
  };
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
