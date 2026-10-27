// @vitest-environment happy-dom
import type { Project } from '@inkadra/shared';
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
it('shows one cover image and never overlays board text or drawings', async () => {
  vi.mocked(api.get).mockResolvedValue({
    assetIds: ['a', 'b'],
    excerpts: ['Location notes'],
    elementCount: 3,
    drawing: [{ path: 'M0 0 L4096 4096', color: '#FF0000', width: 20 }],
  });
  await act(async () => root.render(<BoardPreview boardId="b" />));
  expect(host.querySelectorAll('img')).toHaveLength(1);
  expect(host.querySelector('img')?.src).toContain('/image');
  expect(host.textContent).not.toContain('Location notes');
  expect(host.querySelector('path')).toBeNull();
  expect(host.textContent).toContain('home.preview.cards');
  expect(api.get).toHaveBeenCalledWith('/boards/b/preview', expect.any(AbortSignal));
});
it('falls back to the project tint when the cover fails to load', async () => {
  vi.mocked(api.get).mockResolvedValue({
    assetIds: ['a'],
    excerpts: [],
    elementCount: 1,
    drawing: [],
  });
  const project = { icon: { shape: 'circle', color: 'orange', emoji: null } } as Project;
  await act(async () => root.render(<BoardPreview boardId="b" project={project} />));
  await act(async () => host.querySelector('img')?.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('.home__preview')?.getAttribute('data-tint')).toBe('orange');
  expect(host.querySelector('.home__preview-glyph svg')).not.toBeNull();
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

it('preserves customized project emoji in the persisted-preview fallback', async () => {
  vi.mocked(api.get).mockResolvedValue({
    assetIds: [],
    excerpts: [],
    elementCount: 0,
    drawing: [],
  });
  const project = { icon: { shape: 'diamond', color: 'blue', emoji: '🎬' } } as Project;
  await act(async () => root.render(<BoardPreview boardId="project" project={project} />));
  expect(host.querySelector('.home__preview-glyph')?.textContent).toBe('🎬');
  expect(host.textContent).toContain('home.preview.empty');
});
