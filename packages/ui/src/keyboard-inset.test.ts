import { describe, expect, it } from 'vitest';
import { keyboardInset } from './components.tsx';

describe('keyboardInset', () => {
  it('adds the safe area Android Chrome drops under the keyboard', () => {
    expect(keyboardInset(352, 0, 24)).toBe(376);
  });
  it('trusts the viewport where the safe area stays, as on iOS', () => {
    expect(keyboardInset(300, 34, 34)).toBe(300);
  });
  it('is nothing without a keyboard', () => {
    expect(keyboardInset(0, 24, 24)).toBe(0);
  });
});
