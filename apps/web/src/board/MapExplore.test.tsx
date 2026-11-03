// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MapSurface } from './MapExplore.tsx';

const state = vi.hoisted(() => ({ setUrl: vi.fn(), makeMap: vi.fn() }));
vi.mock('./context.ts', () => ({
  useBoard: () => ({
    mapTiles: '/api/v1/map-tiles/{z}/{x}/{y}',
    mapSatelliteAttribution: 'Satellite credit',
  }),
}));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => ({
  map: state.makeMap,
  tileLayer: () => ({
    setUrl: state.setUrl,
    addTo() {
      return this;
    },
  }),
  control: { zoom: () => ({ addTo: () => {} }) },
  circleMarker: () => ({ addTo: () => {} }),
}));
it('switches the proxied source without resetting the explored viewport', async () => {
  state.makeMap.mockReturnValue({
    setView: vi.fn(),
    getContainer: () => document.createElement('div'),
    invalidateSize: vi.fn(),
    remove: vi.fn(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MapSurface id="map" name="Milano" exploring place={{ lat: 45.46, lon: 9.19, zoom: 16 }} />,
    ),
  );
  await vi.waitFor(() => expect(state.makeMap).toHaveBeenCalledOnce());
  await act(async () => host.querySelector<HTMLButtonElement>('.mcard__layer')!.click());
  expect(state.setUrl).toHaveBeenLastCalledWith('/api/v1/map-tiles/{z}/{x}/{y}?layer=satellite');
  expect(state.makeMap).toHaveBeenCalledOnce();
  expect(host.querySelector('.mcard__satellite-credit')?.textContent).toBe('Satellite credit');
  await act(async () => host.querySelector<HTMLButtonElement>('.mcard__layer')!.click());
  expect(state.setUrl).toHaveBeenLastCalledWith('/api/v1/map-tiles/{z}/{x}/{y}');
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
