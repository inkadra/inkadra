// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { planSheetFixture } from '@inkadra/canvas-core/fixtures/plan-sheet';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fileFetch, type SheetAudience, sheetOf, sheetText } from './plan-sheet-node.fixture.ts';

/**
 * The set plan's sheet in the web's own test environment, with a DOM: the same golden files as
 * `plan-sheet-node.test.ts`, which makes it in Node without one.
 */

beforeAll(() => {
  vi.stubGlobal('fetch', fileFetch);
});

describe.each([
  ['team', 'en'],
  ['team', 'it'],
  ['guest', 'en'],
  ['guest', 'it'],
] as const)('the sheet for the %s in %s', (audience: SheetAudience, lng) => {
  it('is the same golden list of drawing operations as in Node', async () => {
    expect(typeof document).toBe('object');
    const { built } = await sheetOf(planSheetFixture(), audience, lng);
    expect(built.pages).toHaveLength(3);
    await expect(sheetText(built.pages, built.missing)).toMatchFileSnapshot(
      `./golden/plan-sheet-${audience}-${lng}.txt`,
    );
  });
});
