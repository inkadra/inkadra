// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { dark, light } from './tokens.ts';

function linear(hex: string) {
  return [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}
function lab(hex: string) {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function distance(a: string, b: string) {
  const x = lab(a),
    y = lab(b);
  return Math.hypot(...x.map((v, i) => v - y[i]!));
}
function luminance(hex: string) {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
it('keeps every identity stroke legible and red perceptually separate from danger, orange and pink', () => {
  for (const theme of [light, dark]) {
    for (const [name, value] of Object.entries(theme)) {
      if (!name.startsWith('tag-') || name.endsWith('-bg')) continue;
      const [lo, hi] = [luminance(value), luminance(theme['surface-1'])].sort((a, b) => a - b);
      expect((hi! + 0.05) / (lo! + 0.05), name).toBeGreaterThanOrEqual(3);
      // Compute distances for every identity colour; red has the semantic separation requirement.
      for (const [status, color] of Object.entries(theme)) {
        if (status !== 'status-danger' && !status.startsWith('danger-')) continue;
        const delta = distance(value, color);
        expect(Number.isFinite(delta)).toBe(true);
        if (name === 'tag-red') expect(delta, status).toBeGreaterThanOrEqual(0.08);
      }
    }
    for (const other of ['tag-orange', 'tag-pink'] as const)
      expect(distance(theme['tag-red'], theme[other])).toBeGreaterThanOrEqual(0.06);
  }
});
