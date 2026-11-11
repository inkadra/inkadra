// SPDX-License-Identifier: MPL-2.0
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The interface uses Inter 400, 500 and 600 (decision 0006). Inter 700 is loaded only for bold
 * the user writes (decision 0107): the rule below, and inline weights computed from a card's
 * own `bold`, which this scan does not read.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const scanned = ['packages/ui/src', 'apps/web/src'];
const userBold = ['apps/web/src/board/board.css: .note-text :where(b, strong)'];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path);
    return /\.(css|tsx)$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** A weight the interface may use: 400, 500, 600 or one that comes from elsewhere. */
const allowed = (value: string) =>
  /^(400|500|600|normal|inherit|var\(--[a-z-]+\))$/.test(value.trim());

/** The selector of the CSS rule a declaration at `index` sits in. */
function selectorAt(css: string, index: number): string {
  const open = css.lastIndexOf('{', index);
  const before = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('*/', open) + 1);
  return css.slice(before + 1, open).trim();
}

describe('font weights', () => {
  it('tells allowed weights from the rest', () => {
    expect(['400', '500', '600', 'inherit', 'var(--weight)'].every(allowed)).toBe(true);
    expect(['700', '650', 'bold', 'bolder', '800'].some(allowed)).toBe(false);
  });

  it('stay at 600 or lighter in the CSS and inline styles', () => {
    const found: string[] = [];
    for (const dir of scanned)
      for (const file of files(join(root, dir))) {
        const text = readFileSync(file, 'utf8');
        const name = file.slice(root.length).replaceAll('\\', '/');
        const pattern = file.endsWith('.css')
          ? /font-weight\s*:\s*([^;}]+)|\bfont\s*:\s*(\d{3}|bold(?:er)?)\b/g
          : /fontWeight\s*[:=]\s*\{?\s*(['"]?\w+['"]?)/g;
        for (const match of text.matchAll(pattern)) {
          const value = (match[1] ?? match[2] ?? '').replace(/['"]/g, '');
          if (!/^\d|^bold/.test(value) || allowed(value)) continue;
          const where = file.endsWith('.css') ? `${name}: ${selectorAt(text, match.index)}` : name;
          if (!userBold.includes(where)) found.push(`${where}: ${match[0].trim()}`);
        }
      }
    expect(found, 'use 600 (packages/ui/src/tokens.ts, type)').toEqual([]);
  });
});
