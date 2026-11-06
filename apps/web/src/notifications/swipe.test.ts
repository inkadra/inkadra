import { describe, expect, it } from 'vitest';
import { EDGE_PX, settle, startsSwipe, swipeOffset } from './swipe.ts';

describe('inbox swipe', () => {
  it('leaves the left edge to the system back gesture', () => {
    expect(startsSwipe(EDGE_PX)).toBe(false);
    expect(startsSwipe(EDGE_PX + 1)).toBe(true);
  });
  it('follows the finger leftwards, up to the actions', () => {
    expect(swipeOffset(0, 30, 160)).toBe(0);
    expect(swipeOffset(0, -60, 160)).toBe(-60);
    expect(swipeOffset(-160, -60, 160)).toBe(-160);
    expect(swipeOffset(-160, 100, 160)).toBe(-60);
  });
  it('opens past half the actions, else closes', () => {
    expect(settle(-81, 160)).toBe(-160);
    expect(settle(-80, 160)).toBe(0);
    expect(settle(-50, 0)).toBe(0);
  });
});
