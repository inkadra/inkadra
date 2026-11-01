import { createElement } from '@inkadra/canvas-core';
import type { BoardStore } from './store.ts';
import { LOCAL } from './store.ts';

/** Red, green and blue of a `#RRGGBB` colour, 0-255. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `#RRGGBB` of red, green and blue, each rounded and kept within 0-255. */
export function rgbToHex(rgb: readonly number[]): string {
  const part = (v = 0) =>
    Math.max(0, Math.min(255, Math.round(v) || 0))
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`.toUpperCase();
}

/** Hue (0-360), saturation and value (0-1) of a `#RRGGBB` colour, for the picker's square. */
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, max === 0 ? 0 : d / max, max];
}

/** `#RRGGBB` of a hue (0-360), saturation and value (0-1). */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return rgbToHex([f(5), f(3), f(1)]);
}

/** A typed hex colour, with or without `#`, as `#RRGGBB`; null when it is not one. */
export function parseHex(text: string): string | null {
  const hex = text.trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/** Copies a colour's hex; false when the browser refuses. */
export async function copyHex(hex: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(hex);
    return true;
  } catch {
    return false;
  }
}

/** Width of the swatches "Create palette" makes. */
export const PALETTE_WIDTH = 50;

/**
 * Colour cards for a palette, in a row to the right of the image it came from (#308), as one
 * undo step. Returns their ids, to select them together.
 */
export function addPalette(
  store: BoardStore,
  image: { x: number; y: number; w: number },
  palette: readonly string[],
  userId: string,
): string[] {
  // Compact chips in a tight row, as the approved mockup shows them; still normal swatches.
  const step = PALETTE_WIDTH + 4;
  const ids: string[] = [];
  store.undo.stopCapturing();
  store.doc.transact(() => {
    palette.forEach((hex, i) => {
      const at = { x: image.x + image.w + 16 + i * step, y: image.y };
      const fields = { hex, w: PALETTE_WIDTH };
      ids.push(createElement(store.doc, 'color', at, fields, { userId, origin: LOCAL }).id);
    });
  }, LOCAL);
  store.undo.stopCapturing();
  return ids;
}
