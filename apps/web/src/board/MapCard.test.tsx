// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MapCard } from './MapCard.tsx';

vi.mock('./context.ts', () => ({ useBoard: () => ({ scale: 1 }) }));
vi.mock('./assets.ts', async (original) => ({
  ...(await original<object>()),
  useAsset: () => ({ status: 'ready', mime: 'image/png', url: '/map.png', variants: [] }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('shows the original map picture when it is ready before resized variants', () => {
  const html = renderToStaticMarkup(
    <MapCard
      width={300}
      element={{
        id: 'map',
        type: 'map',
        name: 'Milano',
        lat: 45.46,
        lon: 9.19,
        imageAssetId: 'image',
        x: 0,
        y: 0,
        w: 300,
        z: 'a0',
        parent: null,
        createdBy: null,
        createdAt: 0,
      }}
    />,
  );
  expect(html).toContain('src="/map.png"');
});
