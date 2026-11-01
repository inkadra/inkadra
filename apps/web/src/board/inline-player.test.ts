import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPlayingInline, playInline, stopInline, subscribeInline } from './inline-player.ts';

afterEach(() => playInline(null));

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
