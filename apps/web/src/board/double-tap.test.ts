import { describe, expect, it } from 'vitest';
import { isDoubleTap } from './double-tap.ts';

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
