// SPDX-License-Identifier: MPL-2.0
import { listElements, PLAN_WORDS_EN, SHEET_WORDS_EN } from '@inkadra/canvas-core';
import {
  bigPlanFixture,
  type PlanSheetFixture,
  planSheetFixture,
} from '@inkadra/canvas-core/fixtures/plan-sheet';
import { wordsOf } from '@inkadra/canvas-core/fixtures/plan-words';
import { PLAN_WORDS_DE, SHEET_WORDS_DE } from '@inkadra/canvas-core/plan-words/de';
import { PLAN_WORDS_ES, SHEET_WORDS_ES } from '@inkadra/canvas-core/plan-words/es';
import { PLAN_WORDS_FR, SHEET_WORDS_FR } from '@inkadra/canvas-core/plan-words/fr';
import { PLAN_WORDS_IT, SHEET_WORDS_IT } from '@inkadra/canvas-core/plan-words/it';
import { PLAN_WORDS_PT, SHEET_WORDS_PT } from '@inkadra/canvas-core/plan-words/pt';
import { describe, expect, it } from 'vitest';
import type { Op } from './ops.ts';
import type { Palette } from './plan-ops.ts';
import { PLAN_SHEET_INCLUDE, planSheetPages } from './plan-sheet.ts';
import { planSheetInput } from './plan-sheet-input.ts';

const texts = (ops: readonly Op[]): string[] =>
  ops.flatMap((op) => (op.kind === 'text' ? [op.text] : op.kind === 'clip' ? texts(op.ops) : []));

/**
 * The text of the sheet of `fixture`'s setups with everything included, for the team and for
 * guests, in `words`: a key they lack throws.
 */
function sheets(fixture: PlanSheetFixture, words: object, locale: string): string[][] {
  const all = listElements(fixture.doc);
  return (['team', 'client'] as const).map((audience) => {
    const { input, cards } = planSheetInput({
      elements: all,
      filter: { audience, hideGuestHidden: audience === 'client' },
      planIds: fixture.planIds,
      area: null,
      include: { ...PLAN_SHEET_INCLUDE, background: true, grid: true },
      t: wordsOf(words),
      locale,
      days: fixture.days,
    });
    const colors = new Proxy({}, { get: () => '#808080' }) as Palette;
    const measure = (text: string, size: number) => [...text].length * size * 0.5;
    return planSheetPages(input, { measure, colors, language: locale, cards }).flatMap((p) =>
      texts(p.ops),
    );
  });
}

describe.each([
  ['en', PLAN_WORDS_EN, SHEET_WORDS_EN],
  ['it', PLAN_WORDS_IT, SHEET_WORDS_IT],
  ['es', PLAN_WORDS_ES, SHEET_WORDS_ES],
  ['de', PLAN_WORDS_DE, SHEET_WORDS_DE],
  ['fr', PLAN_WORDS_FR, SHEET_WORDS_FR],
  ['pt', PLAN_WORDS_PT, SHEET_WORDS_PT],
] as const)('the sheet in %s (decision 0116)', (locale, plan, sheet) => {
  // Another client prints the sheet with canvas-core's words alone: every key it asks is there.
  const words = { ...plan, ...sheet };

  it('finds every word it prints in canvas-core', () => {
    expect(() => sheets(planSheetFixture(), words, locale)).not.toThrow();
    // A legend too long for the page asks for "+N more".
    const [team] = sheets(bigPlanFixture(), words, locale);
    const [before = '', after = ''] = plan.board.plan.sheet.more_other.split('{{count}}');
    expect(team?.some((text) => text.startsWith(before) && text.endsWith(after))).toBe(true);
  });
});
