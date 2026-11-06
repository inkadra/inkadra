// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { whileVisible } from './schedule.ts';

describe('whileVisible', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('checks every minute and on coming back, not while hidden or after stopping', () => {
    vi.useFakeTimers();
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const refresh = vi.fn();
    const stop = whileVisible(refresh);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    state.mockReturnValue('hidden');
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
