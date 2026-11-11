// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dark, light } from './tokens.ts';

/** The logo files outside the app draw the tile and frames with the logo tokens of each theme. */
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const fills = (svg: string) => [...svg.matchAll(/fill(?:=")?:?(#[0-9A-F]{6})/gi)].map((m) => m[1]);

describe('logo assets', () => {
  it('docs logos: tile and frames from logo-tile and logo-ink, name in text-primary', () => {
    for (const [file, theme] of [
      ['docs/assets/logo-light.svg', light],
      ['docs/assets/logo-dark.svg', dark],
    ] as const)
      expect(fills(read(file)), file).toEqual([
        theme['logo-tile'],
        theme['logo-ink'],
        theme['logo-ink'],
        theme['text-primary'],
      ]);
  });

  it('favicon follows the browser scheme, light first', () => {
    expect(fills(read('apps/web/public/favicon.svg'))).toEqual([
      light['logo-tile'],
      light['logo-ink'],
      dark['logo-tile'],
      dark['logo-ink'],
    ]);
  });

  it("clipper icons use the dark theme's logo colours, like the app icons", () => {
    const script = read('apps/clipper/scripts/package.mjs');
    const rgb = (name: string) =>
      `#${(script.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))?.[1] ?? '')
        .split(',')
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
    expect([rgb('TILE'), rgb('INK')]).toEqual([dark['logo-tile'], dark['logo-ink']]);
  });
});
