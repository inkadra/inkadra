// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { clipboardGrid, linkLabel } from './table.ts';

describe('table clipboard', () => {
  it('takes the TSV of a spreadsheet range', () => {
    expect(clipboardGrid('Operatore\tZona\nMatteo\tLagunc\n', '')).toEqual([
      ['Operatore', 'Zona'],
      ['Matteo', 'Lagunc'],
    ]);
  });

  it('falls back to an HTML table, and ignores plain text', () => {
    const html = '<table><tr><td>a</td><td> b </td></tr><tr><td>c</td></tr></table>';
    expect(clipboardGrid('a b c', html)).toEqual([['a', 'b'], ['c']]);
    expect(clipboardGrid('just a sentence\nand another', '<p>x</p>')).toBeNull();
  });

  it('labels links by host, and map links as maps', () => {
    expect(linkLabel('https://www.example.com/sheet')).toBe('example.com');
    expect(linkLabel('https://maps.app.goo.gl/x')).toBe('maps');
  });
});
