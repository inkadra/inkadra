import { describe, expect, it } from 'vitest';
import type { Measure } from './pages.ts';
import { ellipsize, missingGlyphs, textBlock, wrapText } from './text.ts';

// Every character is half the font size wide.
const measure: Measure = (text, size) => [...text].length * size * 0.5;

describe('wrapText', () => {
  it('breaks at spaces and keeps line breaks', () => {
    // 10 pt text, 50 pt wide: 10 characters per line.
    expect(wrapText('il treno entra in stazione', 50, 10, 400, measure)).toEqual([
      'il treno',
      'entra in',
      'stazione',
    ]);
    expect(wrapText('uno\ndue', 50, 10, 400, measure)).toEqual(['uno', 'due']);
  });

  it('cuts a word longer than a line', () => {
    expect(wrapText('abcdefghijklmnop', 25, 10, 400, measure)).toEqual([
      'abcde',
      'fghij',
      'klmno',
      'p',
    ]);
  });

  it('ends the last kept line with an ellipsis', () => {
    const lines = wrapText('uno due tre quattro cinque sei sette', 40, 10, 400, measure, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
    expect(measure(lines[1] ?? '', 10, 400)).toBeLessThanOrEqual(40);
  });

  it('returns one empty line for empty text', () => {
    expect(wrapText('', 50, 10, 400, measure)).toEqual(['']);
  });
});

describe('ellipsize', () => {
  it('keeps text that fits and cuts text that does not', () => {
    expect(ellipsize('corto', 50, 10, 400, measure)).toBe('corto');
    expect(ellipsize('molto più lungo', 40, 10, 400, measure)).toBe('molto p…');
  });
});

describe('textBlock', () => {
  it('places baselines one leading apart and skips empty lines', () => {
    const { ops, bottom } = textBlock(['a', '', 'b'], 10, 100, {
      size: 10,
      weight: 400,
      color: '#000000',
      leading: 14,
    });
    expect(ops).toHaveLength(2);
    const [first, second] = ops;
    if (first?.kind !== 'text' || second?.kind !== 'text') throw new Error('expected text');
    expect(second.y - first.y).toBe(28);
    expect(bottom).toBe(142);
  });
});

describe('missingGlyphs', () => {
  it('finds characters the font cannot draw, inside clips too, a few at most', () => {
    const latin = (ch: string) => ch.charCodeAt(0) < 0x250;
    const text = (value: string) =>
      ({ kind: 'text', x: 0, y: 0, text: value, size: 10, weight: 400, color: '#000000' }) as const;
    const pages = [
      {
        width: 10,
        height: 10,
        ops: [
          text('Città è già'),
          { kind: 'clip', x: 0, y: 0, w: 1, h: 1, ops: [text('東京 Привет')] },
        ],
      },
    ] as const;
    expect(missingGlyphs(pages as never, latin)).toEqual(['東', '京', 'П', 'р', 'и', 'в']);
    expect(missingGlyphs([{ width: 1, height: 1, ops: [text('Ciao')] }], latin)).toEqual([]);
  });
});
