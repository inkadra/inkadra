// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { bubbleLayout, popoverPosition } from './comments-on-board-model.ts';

const card = (left: number, top: number, width: number) => ({
  left,
  top,
  width,
  right: left + width,
  bottom: top + 100,
});

describe('bubbleLayout', () => {
  it('sits on the top-right corner at 100% zoom', () => {
    expect(bubbleLayout(card(100, 50, 200), 200)).toEqual({ x: 300, y: 50, scale: 1 });
  });

  it('follows the zoom within limits', () => {
    expect(bubbleLayout(card(0, 0, 100), 200)?.scale).toBe(0.85);
    expect(bubbleLayout(card(0, 0, 800), 200)?.scale).toBe(1.3);
  });

  it('hides when zoomed far out and when the card is off screen', () => {
    expect(bubbleLayout(card(0, 0, 40), 200)).toBeNull();
    expect(bubbleLayout(card(900, 0, 200), 200, { w: 800, h: 600 })).toBeNull();
    expect(bubbleLayout(card(0, 0, 200), 0)).toBeNull();
  });
});

describe('popoverPosition', () => {
  const pop = { w: 300, h: 200 };
  const area = { w: 1000, h: 600 };

  it('goes beside the card, on the right when it fits', () => {
    expect(popoverPosition(card(100, 100, 200), pop, area)).toEqual({
      side: 'right',
      x: 328,
      y: 92,
    });
  });

  it('flips to the left, then stays inside the area', () => {
    expect(popoverPosition(card(600, 450, 300), pop, area)).toEqual({
      side: 'left',
      x: 272,
      y: 392,
    });
  });
});
