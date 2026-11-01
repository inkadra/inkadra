// SPDX-License-Identifier: AGPL-3.0-only
// Heading fonts of the project theme, bundled with the app (OFL-1.1, decision 0057). Only their
// URLs live here: a file is fetched the first time a presentation, export or preview uses it.
import frauncesPdf from '@fontsource/fraunces/files/fraunces-latin-600-normal.woff?url';
import fraunces from '@fontsource/fraunces/files/fraunces-latin-600-normal.woff2?url';
import plexPdf from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff?url';
import plex from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url';
import groteskPdf from '@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff?url';
import grotesk from '@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2?url';
import {
  DEFAULT_PROJECT_THEME,
  type ExportSettings,
  type ThemeColor,
  type ThemeFont,
} from '@inkadra/shared';
import { light } from '@inkadra/ui/tokens';

/** WOFF2 for the page; WOFF for the PDF, which fontkit reads without Brotli. Inter is the app's. */
const FONTS: Record<
  Exclude<ThemeFont, 'inter'>,
  { family: string; screen: string; pdf: string }
> = {
  fraunces: { family: 'Inkadra Fraunces', screen: fraunces, pdf: frauncesPdf },
  'space-grotesk': { family: 'Inkadra Space Grotesk', screen: grotesk, pdf: groteskPdf },
  'ibm-plex-mono': { family: 'Inkadra IBM Plex Mono', screen: plex, pdf: plexPdf },
};

/** The CSS font stack of a heading font, falling back to Inter for what it cannot draw. */
export function headingFamily(font: ThemeFont): string {
  return font === 'inter' ? 'Inter, sans-serif' : `"${FONTS[font].family}", Inter, sans-serif`;
}

/** The WOFF file the PDF embeds for headings; null for Inter, which the export already has. */
export function headingPdfUrl(font: ThemeFont): string | null {
  return font === 'inter' ? null : FONTS[font].pdf;
}

const loaded = new Map<ThemeFont, Promise<void>>();

/** Adds a heading font (weight 600) to the page once, when something first shows it. */
export function loadHeadingFont(font: ThemeFont): Promise<void> {
  if (font === 'inter' || typeof FontFace === 'undefined') return Promise.resolve();
  let loading = loaded.get(font);
  if (!loading) {
    const { family, screen } = FONTS[font];
    loading = new FontFace(family, `url(${screen}) format('woff2')`, { weight: '600' }).load().then(
      (face) => {
        document.fonts.add(face);
      },
      () => {
        // Headings stay in Inter; the next use tries again.
        loaded.delete(font);
      },
    );
    loaded.set(font, loading);
  }
  return loading;
}

export interface Theme {
  color: ThemeColor;
  headingFont: ThemeFont;
}

/** The theme to draw with: the chosen accent, else the project's colour. */
export function resolveTheme(
  settings: Pick<ExportSettings, 'theme' | 'projectColor'> | null | undefined,
): Theme {
  const theme = settings?.theme ?? DEFAULT_PROJECT_THEME;
  return {
    color: theme.accent ?? settings?.projectColor ?? 'neutral',
    headingFont: theme.headingFont,
  };
}

/** The accent on screen: the tag colour of the app theme, as the project icon uses it. */
export function screenAccent(color: ThemeColor): string {
  return color === 'neutral' ? 'var(--ink-text-muted)' : `var(--ink-tag-${color})`;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two #RRGGBB colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent on white paper: the light theme's darker variant of the same hue, which reads at
 * 4.5:1 like body text (theme.test.ts holds every colour to it), whatever the app shows.
 */
export function paperAccent(color: ThemeColor): string {
  return color === 'neutral' ? light['text-secondary'] : light[`tag-${color}`];
}
