import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dark, light } from './tokens.ts';
import { tokensCss } from './tokens-css.ts';

describe('tokens', () => {
  it('tokens.css matches tokens.ts', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    expect(css, 'run `pnpm --filter @inkadra/ui tokens`').toBe(tokensCss());
  });

  it('light theme defines every dark token', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it('white on the button blue keeps 4.5:1 contrast', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    expect(ratio(dark['on-accent'], dark['accent-button'])).toBeGreaterThan(4.5);
    expect(ratio(dark['text-muted'], dark['bg-app'])).toBeGreaterThan(4.5);
    expect(ratio(light['text-secondary'], light['bg-panel'])).toBeGreaterThan(4.5);
  });
});
