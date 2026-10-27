// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { commentPanelPosition } from './comment-panel-position.ts';

it('prefers the right side and flips at the viewport edge', () => {
  const panel = { w: 380, h: 560 };
  const viewport = { w: 1200, h: 800 };
  expect(commentPanelPosition({ left: 100, right: 300, top: 100 }, panel, viewport)).toEqual({
    x: 312,
    y: 100,
  });
  expect(commentPanelPosition({ left: 900, right: 1100, top: 100 }, panel, viewport)).toEqual({
    x: 508,
    y: 100,
  });
});

it('keeps offscreen and oversized cards inside the usable viewport', () => {
  expect(
    commentPanelPosition(
      { left: -100, right: 1500, top: 900 },
      { w: 380, h: 560 },
      { w: 800, h: 700 },
    ),
  ).toEqual({ x: 8, y: 132 });
});
