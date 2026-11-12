// SPDX-License-Identifier: AGPL-3.0-only

import regular from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
// Inter, the interface font (OFL-1.1). WOFF rather than WOFF2: fontkit reads it without Brotli.
import medium from '@fontsource/inter/files/inter-latin-500-normal.woff?url';
import semibold from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import bold from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import { fontCoverage, measureFrom } from '@inkadra/print/measure';
import type { ThemeFont } from '@inkadra/shared';
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

type Inter = Record<400 | 500 | 600 | 700, Uint8Array>;
const URLS: Record<400 | 500 | 600 | 700, string> = {
  400: regular,
  500: medium,
  600: semibold,
  700: bold,
};
let inter: Promise<Inter> | null = null;
const loading = new Map<ThemeFont, Promise<Fonts>>();

async function fetchFont(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font ${url} could not be loaded.`);
  return new Uint8Array(await res.arrayBuffer());
}

function loadInter(): Promise<Inter> {
  inter ??= Promise.all(
    ([400, 500, 600, 700] as const).map(async (w) => [w, await fetchFont(URLS[w])] as const),
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
        const headingChar = fontCoverage(bytes.heading);
        const headingCovers = (text: string) => [...text].every(headingChar);
        return {
          bytes,
          headingFamily: headingFamily(heading),
          measure: measureFrom(bytes),
          covers: fontCoverage(bytes[400]),
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
