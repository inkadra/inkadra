// @vitest-environment happy-dom
import type { Asset } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioPreview } from './FileCard.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const asset = {
  id: 'asset_1',
  kind: 'audio',
  mime: 'audio/wav',
  filename: 'voce.wav',
  url: '/api/v1/assets/asset_1/file',
  waveformUrl: null,
  durationMs: 1000,
  proxy: null,
} as unknown as Asset;

const host = document.createElement('div');
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

// R2-03: the first play of a fresh upload failed because the player asked for the file early.
it('hands the player no address until the asset is ready', () => {
  const render = (state: 'ready' | 'processing' | 'failed') =>
    act(() => root.render(<AudioPreview id="el_1" asset={asset} state={state} width={280} />));

  render('processing');
  expect(host.querySelector('audio')).toBeNull();
  expect(host.textContent).toContain('board.image.processing');

  render('ready');
  expect(host.querySelector('audio')?.getAttribute('src')).toBe(asset.url);
  expect(host.textContent).not.toContain('board.image.processing');

  render('failed');
  expect(host.querySelector('audio')).toBeNull();
  expect(host.textContent).not.toContain('board.image.processing');
});
