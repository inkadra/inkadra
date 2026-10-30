import { afterEach, expect, it, vi } from 'vitest';
import { offlineScript } from '../../pwa/pages.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([true, false])(
  'recovers after early online events (native timeout: %s)',
  async (nativeTimeout) => {
    if (!nativeTimeout) vi.stubGlobal('AbortSignal', {});
    vi.useFakeTimers();
    const reload = vi.fn();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });
    const events = new Map<string, () => void>();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { reload });
    vi.stubGlobal('window', {
      addEventListener: (event: string, fn: () => void) => events.set(event, fn),
    });
    vi.stubGlobal('document', {
      documentElement: { dataset: {} },
      getElementById: (id: string) =>
        id === 'messages' ? { dataset: { messages: '{"it":{}}' } } : { addEventListener: vi.fn() },
    });
    // Execute the exact external script emitted in the build, with fake browser globals.
    new Function(offlineScript)();
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    events.get('online')?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/health',
      expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
    );
  },
);
