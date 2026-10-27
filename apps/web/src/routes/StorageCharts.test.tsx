// @vitest-environment happy-dom
import type { StorageUsage } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { formatStorage, StorageCharts, storagePercent } from './StorageCharts.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
});

it('formats human units and meaningful shares, including very small nonzero usage', () => {
  expect(formatStorage(0, 'en')).toBe('0 B');
  expect(formatStorage(1_500_000_000, 'en')).toBe('1.5 GB');
  expect(formatStorage(2_000_000_000_000, 'en')).toBe('2 TB');
  expect(formatStorage(1_500_000, 'it')).toBe('1,5 MB');
  expect(storagePercent(1, 100000, 'en')).toBe('<0.1%');
  expect(storagePercent(0, 0, 'en')).toBe('0%');
  expect(storagePercent(300, 400, 'en')).toBe('75%');
});
it('renders consistent chart bars with accessible labeled tables and anonymized projects', async () => {
  const usage: StorageUsage = {
    originalBytes: 4000,
    byType: [
      { type: 'images', bytes: 1000 },
      { type: 'videos', bytes: 3000 },
    ],
    byProject: [
      { projectId: 'p', name: 'Shoot', scope: 'project', bytes: 1000 },
      { projectId: null, name: null, scope: 'restricted', bytes: 3000 },
    ],
  };
  await act(async () => root.render(<StorageCharts usage={usage} />));
  expect(host.textContent).toContain('4 KB');
  expect(host.querySelectorAll('table')).toHaveLength(2);
  expect(host.querySelectorAll('caption')).toHaveLength(2);
  expect(host.querySelectorAll('th[scope="row"]')).toHaveLength(4);
  expect(host.querySelectorAll('.storage-chart__track > span')[0]?.getAttribute('style')).toContain(
    '25%',
  );
  expect(host.textContent).toContain('Shoot');
  expect(host.textContent).toContain('admin.storageCharts.restricted');
  expect(host.textContent?.match(/75%/g)).toHaveLength(2);
});
it('shows an explicit empty state without NaN shares or misleading capacity bars', async () => {
  await act(async () =>
    root.render(<StorageCharts usage={{ originalBytes: 0, byType: [], byProject: [] }} />),
  );
  expect(host.textContent).toContain('admin.storageEmpty');
  expect(host.textContent).toContain('0 B');
  expect(host.querySelector('table')).toBeNull();
  expect(host.textContent).not.toContain('NaN');
});
