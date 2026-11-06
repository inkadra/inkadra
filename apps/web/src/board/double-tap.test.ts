import { describe, expect, it } from 'vitest';
import { isDoubleTap, stayedStill } from './double-tap.ts';

describe('double tap', () => {
  const first = { at: 1000, x: 100, y: 200 };
  it('needs a second tap soon after and close to the first', () => {
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: 1250, x: 110, y: 210 })).toBe(true);
    expect(isDoubleTap(first, { at: 1400, x: 100, y: 200 })).toBe(false);
    expect(isDoubleTap(first, { at: 1100, x: 160, y: 200 })).toBe(false);
    expect(isDoubleTap(first, { at: 900, x: 100, y: 200 })).toBe(false);
  });
});

it('counts a finger as a tap only if it lifted where it went down', () => {
  const down = { at: 1000, x: 100, y: 200 };
  expect(stayedStill(down, { x: 104, y: 203 })).toBe(true);
  expect(stayedStill(down, { x: 130, y: 200 })).toBe(false);
});
