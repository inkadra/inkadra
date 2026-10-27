// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { BoardPreview } from './BoardPreview.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn() } }));
vi.mock('../board/assets.ts', () => ({
  useAsset: () => ({ url: '/image' }),
  pickVariant: () => '/image',
}));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});
it('shows actual excerpts, media and drawing instead of an empty cover', async () => {
  vi.mocked(api.get).mockResolvedValue({
    assetIds: ['a'],
    excerpts: ['Location notes <script>'],
    elementCount: 3,
    drawing: [{ path: 'M0 0 L4096 4096', color: '#FF0000', width: 20 }],
  });
  await act(async () => root.render(<BoardPreview boardId="b" />));
  expect(host.textContent).toContain('Location notes <script>');
  expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector('img')?.src).toContain('/image');
  expect(host.querySelector('path')?.getAttribute('d')).toBe('M0 0 L4096 4096');
  expect(api.get).toHaveBeenCalledWith('/boards/b/preview', expect.any(AbortSignal));
});
it('distinguishes an empty board from a failed preview', async () => {
  vi.mocked(api.get).mockResolvedValue({
    assetIds: [],
    excerpts: [],
    elementCount: 0,
    drawing: [],
  });
  await act(async () => root.render(<BoardPreview boardId="empty" />));
  expect(host.textContent).toContain('home.preview.empty');
  vi.mocked(api.get).mockRejectedValue(new Error('offline'));
  await act(async () => root.render(<BoardPreview boardId="failed" />));
  expect(host.textContent).toContain('home.preview.unavailable');
  expect(host.textContent).not.toContain('home.preview.empty');
});
