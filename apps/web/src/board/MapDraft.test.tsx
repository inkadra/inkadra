// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { MapDraft } from './MapDraft.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/api.ts', () => ({ api: { post: vi.fn() } }));

it('tells an address with no results from a search that failed, also after Enter', async () => {
  vi.useFakeTimers();
  vi.mocked(api.post).mockResolvedValue({ items: [] });
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MapDraft
        at={{ x: 0, y: 0 }}
        projectId="p"
        boardId="b"
        geocoding
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    ),
  );
  const input = host.querySelector('input') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(input, 'Nowhere');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(700));
  const status = () => host.querySelector('p')?.textContent;
  expect(status()).toBe('board.map.noResults');
  await act(async () =>
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(status()).toBe('board.map.noResults');
  await act(async () => root.unmount());
  vi.useRealTimers();
});
