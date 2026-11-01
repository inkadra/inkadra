// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useOfficePreview } from './OfficePreview.tsx';

const assets = {
  processing: { id: 'office', status: 'processing' } as Asset,
  ready: { id: 'office', status: 'ready' } as Asset,
};
function Probe({ status }: { status: 'processing' | 'ready' }) {
  const data = useOfficePreview(assets[status]);
  return <span>{data === undefined ? 'loading' : data ? 'ready' : 'unavailable'}</span>;
}

it('keeps processing documents loading and fetches derivatives only once ready', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ pageCount: 1, sheets: [] }) });
  vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Probe status="processing" />));
    expect(host.textContent).toBe('loading');
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe status="ready" />));
    expect(host.textContent).toBe('ready');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
