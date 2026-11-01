// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReviews, openPopover, readOnBoard, resetReviews, setOnBoard } from './review-store.ts';

describe('comments on the board', () => {
  const kept = new Map<string, string>();
  beforeEach(() => {
    kept.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    });
    resetReviews({ boardId: 'b' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is on until a person turns it off, and the choice is theirs', () => {
    expect(readOnBoard('ada')).toBe(true);
    setOnBoard(false, 'ada');
    expect(readOnBoard('ada')).toBe(false);
    expect(readOnBoard('bob')).toBe(true);
    expect(getReviews().onBoard).toBe(false);
  });

  it('closes the popover when it is turned off', () => {
    openPopover('card');
    expect(getReviews().popover).toBe('card');
    setOnBoard(false, 'ada');
    expect(getReviews().popover).toBeNull();
  });
});
