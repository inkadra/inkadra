// SPDX-License-Identifier: AGPL-3.0-only
import type { FontWeight, Measure, Op } from './pages.ts';

export interface TextStyle {
  size: number;
  weight: FontWeight;
  color: string;
  /** Distance between baselines; defaults to 1.35 × size. */
  leading?: number;
}

const ELLIPSIS = '…';

/**
 * Lines of `text` no wider than `width`: breaks at spaces, keeps the person's line breaks and
 * splits a word longer than a line. With `maxLines`, the last kept line ends with an ellipsis.
 */
export function wrapText(
  text: string,
  width: number,
  size: number,
  weight: FontWeight,
  measure: Measure,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  const fits = (s: string) => measure(s, size, weight) <= width;
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/[ \t]+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      // A word wider than the line is cut where it stops fitting.
      while (!fits(rest)) {
        let n = rest.length - 1;
        while (n > 1 && !fits(rest.slice(0, n))) n -= 1;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(0, maxLines));
  if (kept.length === 0) return kept;
  kept[kept.length - 1] = ellipsize(`${kept.at(-1)}${ELLIPSIS}`, width, size, weight, measure);
  return kept;
}

/** The text cut to `width`, ending with an ellipsis when it was cut. */
export function ellipsize(
  text: string,
  width: number,
  size: number,
  weight: FontWeight,
  measure: Measure,
): string {
  if (measure(text, size, weight) <= width) return text;
  let base = text.endsWith(ELLIPSIS) ? text.slice(0, -1) : text;
  while (base.length > 0 && measure(`${base.trimEnd()}${ELLIPSIS}`, size, weight) > width) {
    base = base.slice(0, -1);
  }
  return base ? `${base.trimEnd()}${ELLIPSIS}` : '';
}

/**
 * Text operations for a block whose first line's top sits at `top`. Returns the operations
 * and the y just below the last line.
 */
export function textBlock(
  lines: readonly string[],
  x: number,
  top: number,
  style: TextStyle,
): { ops: Op[]; bottom: number } {
  const leading = style.leading ?? style.size * 1.35;
  // Inter's ascent is about 0.97 em; the baseline of the first line sits that far below the top
  // of the line box, centred in the leading.
  const first = top + (leading - style.size) / 2 + style.size * 0.8;
  const ops: Op[] = lines.map((text, i) => ({
    kind: 'text',
    x,
    y: first + i * leading,
    text,
    size: style.size,
    weight: style.weight,
    color: style.color,
  }));
  return {
    ops: ops.filter((op) => op.kind !== 'text' || op.text !== ''),
    bottom: top + lines.length * leading,
  };
}

export function lineHeight(style: TextStyle): number {
  return style.leading ?? style.size * 1.35;
}
