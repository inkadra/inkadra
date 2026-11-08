import { describe, expect, it } from 'vitest';
import { placeMenu } from './place-menu.ts';

// A 390×844 phone whose tab bar starts at 780.
const floor = 780;

describe('placeMenu', () => {
  it('opens below the anchor when it fits', () => {
    expect(placeMenu(300, 260, 340, floor)).toEqual({ top: 300 });
  });

  it('flips above the anchor instead of covering the tab bar', () => {
    // The ⋯ of a card near the bottom: 680–720, menu 340 tall.
    const { top } = placeMenu(720, 680, 340, floor);
    expect(top).toBe(340);
    expect(top + 340).toBeLessThanOrEqual(floor);
  });

  it('stays above the tab bar when it fits neither below nor above', () => {
    const { top } = placeMenu(500, 300, 400, floor);
    expect(top).toBe(372);
    expect(top + 400).toBeLessThanOrEqual(floor - 8);
  });

  it('scrolls when taller than the room', () => {
    expect(placeMenu(400, 360, 900, floor)).toEqual({ top: 8, maxHeight: 764 });
  });
});
