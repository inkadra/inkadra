// SPDX-License-Identifier: MPL-2.0
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Corner radii come from the scale in tokens.ts (#332). A raw value is allowed only for a
 * hairline (1-3 px: focus rings, thin bars), a percentage (circles) or the offset of a
 * concentric `calc(var(--ink-radius-*) - padding)`.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const scanned = ['packages/ui/src', 'apps/web/src'];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path);
    return /\.(css|tsx)$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Lengths of 4 px and more, or in other units, that do not go through a radius token. */
function rawRadius(value: string): string[] {
  if (value.includes('var(--ink-radius-')) return [];
  const lengths = value.match(/\d*\.?\d+(px|em|rem|vw|vh)\b/g) ?? [];
  return lengths.filter((l) => !l.endsWith('px') || Number.parseFloat(l) > 3);
}

describe('corner radii', () => {
  it('tells raw values from tokens and hairlines', () => {
    expect(rawRadius('var(--ink-radius-md)')).toEqual([]);
    expect(rawRadius('calc(var(--ink-radius-lg) - 6px)')).toEqual([]);
    expect(rawRadius('2px')).toEqual([]);
    expect(rawRadius('calc(2px / var(--zoom, 1))')).toEqual([]);
    expect(rawRadius('50% 50% 50% 2px')).toEqual([]);
    expect(rawRadius('6px')).toEqual(['6px']);
    expect(rawRadius('0 12px 12px 0')).toEqual(['12px', '12px']);
    expect(rawRadius('0.5rem')).toEqual(['0.5rem']);
  });

  it('use the radius tokens in the CSS and inline styles', () => {
    const found: string[] = [];
    for (const dir of scanned)
      for (const file of files(join(root, dir))) {
        const text = readFileSync(file, 'utf8');
        const pattern = file.endsWith('.css')
          ? /border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g
          : /borderRadius\s*:\s*(['"`][^'"`]*['"`]|\d+)/g;
        for (const match of text.matchAll(pattern)) {
          const value = /^\d+$/.test(match[1] as string) ? `${match[1]}px` : (match[1] as string);
          if (rawRadius(value).length > 0)
            found.push(`${file.slice(root.length)}: ${match[0].trim()}`);
        }
      }
    expect(found, 'use a --ink-radius-* token (packages/ui/src/tokens.ts)').toEqual([]);
  });
});
