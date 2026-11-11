// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { COLUMN_GAP, COLUMN_PADDING } from '@inkadra/canvas-core';
import { card } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';

// The card measures live in packages/ui (`card`), shared with the mobile app; board.css still
// writes them as numbers. This test keeps the two equal.
const css = readFileSync(new URL('./board.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start + selector.length);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('card measures', () => {
  it('cards use the padding, border and text sizes of the package', () => {
    expect(rule('.card')).toContain(`border: ${card.border}px solid`);
    expect(rule('.card')).toContain(`font-size: ${card.fontSize}px;`);
    expect(rule('.card')).toContain(`line-height: ${card.lineHeight};`);
    expect(rule('.card__pad')).toContain(`padding: ${card.padY}px ${card.padX}px;`);
    expect(rule('.card__desc')).toContain(`font-size: ${card.smallFontSize}px;`);
  });

  it('columns and scenes use the padding, gap and accent of the packages', () => {
    const body = rule('.card--column,\n.card--scene');
    expect(body).toContain(`padding: ${COLUMN_PADDING}px;`);
    expect(body).toContain(`gap: ${COLUMN_GAP}px;`);
    expect(rule('.column__body')).toContain(`gap: ${COLUMN_GAP}px;`);
    const accent = rule('.card--column[class*="card--accent-"]');
    expect(accent).toContain(`border-top: ${card.accent.bar}px solid`);
    expect(accent).toContain(
      `var(--column-accent) ${Math.round(card.accent.tint * 100)}%, transparent), transparent ${card.accent.fade}px)`,
    );
  });

  it('arrows use the width of the package', () => {
    expect(rule('.arrows__line')).toContain(`stroke-width: ${card.arrow.width};`);
  });

  it('note text uses the sizes and gaps of the package', () => {
    const blocks = rule(
      '.note-text p,\n.note-text h3,\n.note-text h4,\n.note-text ul,\n.note-text ol,\n.note-text blockquote,\n.note-text pre',
    );
    expect(blocks).toContain(`margin: 0 0 ${card.note.blockGap}px;`);
    expect(rule('.note-text h1')).toContain(`font-size: ${card.note.h1}px;`);
    expect(rule('.note-text h2')).toContain(`font-size: ${card.note.h2}px;`);
    expect(rule('.note-text h3')).toContain(`font-size: ${card.note.h3}px;`);
    expect(rule('.note-text h4')).toContain(`font-size: ${card.note.h4}px;`);
    expect(rule('.note-text ul,\n.note-text ol')).toContain(
      `padding-left: ${card.note.listIndent}px;`,
    );
    expect(rule('.note-text code,\n.note-text pre')).toContain(
      `font-size: ${card.note.codeFontSize}px;`,
    );
  });
});
