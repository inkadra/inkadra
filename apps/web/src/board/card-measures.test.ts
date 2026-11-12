// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { COLUMN_GAP, COLUMN_PADDING } from '@inkadra/canvas-core';
import { card } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';

// shortcut: the card measures live in packages/ui (`card`), shared with the mobile app, and
// board.css still writes them as numbers; this test keeps the two equal. Upgrade when board.css
// is reworked: it reads them as --ink-* variables from tokens.css and this test goes.
const css = readFileSync(new URL('./board.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/**
 * Every value `property` takes in the rules whose selector list is exactly `selectors`, in any
 * order of the file and inside @media too. The property name must match exactly (`gap`, not
 * `row-gap`). At least one rule must set it.
 */
function declared(selectors: string[], property: string): string[] {
  const wanted = selectors.join(',');
  const values: string[] = [];
  for (const [, head = '', body = ''] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = head
      .split(',')
      .map((s) => s.trim())
      .join(',');
    if (list !== wanted) continue;
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon > 0 && declaration.slice(0, colon).trim() === property)
        values.push(
          declaration
            .slice(colon + 1)
            .replace(/\s+/g, ' ')
            .trim(),
        );
    }
  }
  expect(values, `${wanted} { ${property} }`).not.toEqual([]);
  return values;
}

/** Every rule of `selectors` that sets `property` sets it to `value`. */
function expectEvery(selectors: string[], property: string, value: string) {
  for (const found of declared(selectors, property))
    expect(found, `${selectors.join(',')} { ${property} }`).toBe(value);
}

describe('card measures', () => {
  it('cards use the padding, border and text sizes of the package', () => {
    for (const found of declared(['.card'], 'border'))
      expect(found.startsWith(`${card.border}px solid `)).toBe(true);
    expectEvery(['.card'], 'font-size', `${card.fontSize}px`);
    expectEvery(['.card'], 'line-height', `${card.lineHeight}`);
    expectEvery(['.card__pad'], 'padding', `${card.padY}px ${card.padX}px`);
    expectEvery(['.card__desc'], 'font-size', `${card.smallFontSize}px`);
  });

  it('columns and scenes use the padding, gap, head and accent of the packages', () => {
    expectEvery(['.card--column', '.card--scene'], 'padding', `${COLUMN_PADDING}px`);
    expectEvery(['.card--column', '.card--scene'], 'gap', `${COLUMN_GAP}px`);
    expectEvery(['.column__body'], 'gap', `${COLUMN_GAP}px`);
    expectEvery(['.column__head'], 'min-height', `${card.column.headHeight}px`);
    expectEvery(['.card--column .column__title'], 'font-size', `${card.column.title}px`);
    expectEvery(['.column__title'], 'font-size', `${card.column.sceneTitle}px`);
    expectEvery(['.column__number'], 'font-size', `${card.column.sceneNumber}px`);
    const accent = ['.card--column[class*="card--accent-"]'];
    expectEvery(accent, 'border-top', `${card.accent.bar}px solid var(--column-accent)`);
    for (const found of declared(accent, 'background'))
      expect(found).toContain(
        `var(--column-accent) ${Math.round(card.accent.tint * 100)}%, transparent), transparent ${card.accent.fade}px)`,
      );
  });

  it('arrows use the width of the package', () => {
    expectEvery(['.arrows__line'], 'stroke-width', `${card.arrow.width}`);
  });

  it('note text uses the sizes and gaps of the package', () => {
    const blocks = ['p', 'h3', 'h4', 'ul', 'ol', 'blockquote', 'pre'].map((t) => `.note-text ${t}`);
    expectEvery(blocks, 'margin', `0 0 ${card.note.blockGap}px`);
    expectEvery(['.note-text h1'], 'margin', `0 0 ${card.note.blockGap}px`);
    expectEvery(['.note-text h2'], 'margin', `0 0 ${card.note.blockGap}px`);
    expectEvery(['.note-text h1'], 'font-size', `${card.note.h1}px`);
    expectEvery(['.note-text h2'], 'font-size', `${card.note.h2}px`);
    expectEvery(['.note-text h3'], 'font-size', `${card.note.h3}px`);
    expectEvery(['.note-text h4'], 'font-size', `${card.note.h4}px`);
    expectEvery(['.note-text ul', '.note-text ol'], 'padding-left', `${card.note.listIndent}px`);
    expectEvery(['.note-text code', '.note-text pre'], 'font-size', `${card.note.codeFontSize}px`);
  });
});
