// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { distance, luminance } from './oklab.ts';
import { dark, light } from './tokens.ts';

it('keeps every identity stroke legible and red, orange and pink perceptually separate from danger', () => {
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
        // Red, and the warm hues next to it (orange marks retakes, pink reviews), never read as an error.
        if (name === 'tag-red' || name === 'tag-orange' || name === 'tag-pink')
          expect(delta, `${name} / ${status}`).toBeGreaterThanOrEqual(0.08);
      }
    }
    for (const other of ['tag-orange', 'tag-pink'] as const)
      expect(distance(theme['tag-red'], theme[other])).toBeGreaterThanOrEqual(0.06);
  }
});
