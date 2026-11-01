import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPlayingInline,
  keepsPlayingOffscreen,
  playInline,
  setKeepsPlayingOffscreen,
  stopInline,
  stopWhenOffscreen,
  subscribeInline,
} from './inline-player.ts';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
});
afterEach(() => {
  playInline(null);
  vi.unstubAllGlobals();
});

describe('inline player', () => {
  it('keeps one card playing at a time and stops only its own card', () => {
    playInline('a');
    expect(isPlayingInline('a')).toBe(true);
    playInline('b');
    expect(isPlayingInline('a')).toBe(false);
    expect(isPlayingInline('b')).toBe(true);
    stopInline('a');
    expect(isPlayingInline('b')).toBe(true);
    stopInline('b');
    expect(isPlayingInline('b')).toBe(false);
  });

  it('tells subscribers about every change but not about repeats', () => {
    const listener = vi.fn();
    const off = subscribeInline(listener);
    playInline('a');
    playInline('a');
    playInline('b');
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    playInline(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('playing off-screen', () => {
  it('stops a card that left the screen unless the person asked to keep it playing', () => {
    expect(keepsPlayingOffscreen()).toBe(false);
    playInline('a');
    stopWhenOffscreen('a');
    expect(isPlayingInline('a')).toBe(false);

    setKeepsPlayingOffscreen(true);
    playInline('a');
    stopWhenOffscreen('a');
    expect(isPlayingInline('a')).toBe(true);

    setKeepsPlayingOffscreen(false);
    stopWhenOffscreen('a');
    expect(isPlayingInline('a')).toBe(false);
  });
});
