import { afterEach, expect, it, vi } from 'vitest';
import { geocode } from './map-previews.ts';

afterEach(() => vi.unstubAllGlobals());
it('rejects missing geocoder coordinates instead of putting an address at zero, zero', async () => {
  for (const [lat, lon] of [
    [null, null],
    ['', ''],
    ['  ', '  '],
    [false, false],
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ lat, lon }]))));
    expect(await geocode('https://geocoder.example/search', 'Via Roma', 'Inkadra')).toBeNull();
  }
});
it('keeps the resolved place name and coordinates and sends the exact typed address', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify([{ lat: '45.4642', lon: '9.19', display_name: 'Via Roma, Milano' }]),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  expect(
    await geocode('https://geocoder.example/search', 'Via Roma, Milano', 'Inkadra', 'it'),
  ).toEqual({ lat: 45.4642, lon: 9.19, zoom: 16, name: 'Via Roma, Milano' });
  expect((fetcher.mock.calls[0]![0] as URL).searchParams.get('q')).toBe('Via Roma, Milano');
});
