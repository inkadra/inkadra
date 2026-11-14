// @vitest-environment happy-dom
import type { StorageUsage } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { formatStorage, projectSwatch, StorageCharts, storagePercent } from './StorageCharts.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
});
/** The one usage card switches between breakdowns (decision 0124). */
const show = (view: 'project' | 'user' | 'type') =>
  act(async () =>
    host.querySelector<HTMLInputElement>(`.ink-segmented input[value="${view}"]`)?.click(),
  );

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
  await act(async () =>
    root.render(
      <MemoryRouter>
        <StorageCharts usage={usage} />
      </MemoryRouter>,
    ),
  );
  expect(host.textContent).toContain('4 KB');
  // One breakdown at a time, per project first; no per-person choice without that data.
  expect(host.querySelectorAll('table')).toHaveLength(1);
  expect(host.querySelectorAll('caption')).toHaveLength(1);
  expect(host.querySelector('.ink-segmented input[value="user"]')).toBeNull();
  expect(host.querySelectorAll('th[scope="row"]')).toHaveLength(2);
  const widths = () =>
    [...host.querySelectorAll('.storage-chart__track > span')].map((bar) =>
      bar.getAttribute('style'),
    );
  // Largest first.
  expect(widths()).toEqual(['width: 75%;', 'width: 25%;']);
  expect(host.textContent).toContain('Shoot');
  expect(host.textContent).toContain('admin.storageCharts.restricted');
  expect(host.textContent?.match(/75%/g)).toHaveLength(1);
  await show('type');
  expect(host.querySelector('caption')?.textContent).toContain('admin.storageCharts.byType');
  expect(widths()).toEqual(['width: 75%;', 'width: 25%;']);
  expect(host.textContent).toContain('admin.storageCharts.types.videos');
});
it('shows an explicit empty state without NaN shares or misleading capacity bars', async () => {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <StorageCharts usage={{ originalBytes: 0, byType: [], byProject: [] }} />
      </MemoryRouter>,
    ),
  );
  expect(host.textContent).toContain('admin.storageEmpty');
  expect(host.textContent).toContain('0 B');
  expect(host.querySelector('table')).toBeNull();
  expect(host.textContent).not.toContain('NaN');
});

it('lists the storage of each user, and files with no account under one label', async () => {
  const usage: StorageUsage = {
    originalBytes: 4000,
    byType: [{ type: 'images', bytes: 4000 }],
    byProject: [{ projectId: 'p', name: 'Shoot', scope: 'project', bytes: 4000 }],
    byUser: [
      { userId: 'u', name: 'Paola Rossi', bytes: 3000 },
      { userId: null, name: null, bytes: 1000 },
    ],
  };
  await act(async () =>
    root.render(
      <MemoryRouter>
        <StorageCharts usage={usage} />
      </MemoryRouter>,
    ),
  );
  await show('user');
  expect(host.querySelectorAll('table')).toHaveLength(1);
  expect(host.textContent).toContain('admin.storageCharts.byUser');
  expect(host.querySelector('a[href="/settings/team"]')?.textContent).toBe(
    'storageLimits.openMembers',
  );
  expect(host.textContent).toContain('Paola Rossi');
  expect(host.textContent).toContain('admin.storageCharts.noUser');
});

it('counts previews in the space used and in the usage of each project and user', async () => {
  const usage: StorageUsage = {
    originalBytes: 3000,
    derivedBytes: 1000,
    byType: [{ type: 'images', bytes: 3000 }],
    byProject: [
      { projectId: 'p', name: 'Shoot', scope: 'project', bytes: 3000, derivedBytes: 1000 },
    ],
    byUser: [
      { userId: 'u', name: 'Paola Rossi', bytes: 3000, derivedBytes: 1000 },
      { userId: 'idle', name: 'Luca Neri', bytes: 0, derivedBytes: 0 },
    ],
  };
  await act(async () =>
    root.render(
      <MemoryRouter>
        <StorageCharts usage={usage} />
      </MemoryRouter>,
    ),
  );
  expect(host.querySelector('.storage-tiles dd')?.textContent).toBe('4 KB');
  expect(host.textContent).toContain('admin.storageCharts.usedDetail');
  await show('project');
  const shoot = [...host.querySelectorAll('tr')].find((row) => row.textContent?.includes('Shoot'));
  expect(shoot?.textContent).toContain('4 KB');
  await show('user');
  expect(host.textContent).toContain('Luca Neri');
  const paola = [...host.querySelectorAll('tr')].find((row) => row.textContent?.includes('Paola'));
  expect(paola?.textContent).toContain('4 KB');
  expect(paola?.textContent).toContain('100%');
});

it('colours each project with its icon colour, and the rest neutral', () => {
  const row = { projectId: 'p', name: 'Shoot', bytes: 1 } as const;
  expect(projectSwatch({ ...row, scope: 'project', color: 'teal' })).toBe('var(--ink-tag-teal)');
  // Older servers send no colour.
  expect(projectSwatch({ ...row, scope: 'project' })).toBe('var(--ink-text-muted)');
  expect(
    projectSwatch({ projectId: null, name: null, scope: 'restricted', bytes: 1, color: 'red' }),
  ).toBe('var(--ink-text-muted)');
  expect(projectSwatch({ projectId: null, name: null, scope: 'unassigned', bytes: 1 })).toBe(
    'var(--ink-text-muted)',
  );
});

it('shows each person as an avatar ringed in their colour, and files with no account neutral', async () => {
  const usage: StorageUsage = {
    originalBytes: 4000,
    byType: [{ type: 'images', bytes: 4000 }],
    byProject: [{ projectId: 'p', name: 'Shoot', scope: 'project', bytes: 4000 }],
    byUser: [
      { userId: 'u', name: 'Paola Rossi', image: 'https://example.com/paola.webp', bytes: 2000 },
      { userId: 'v', name: 'Luca Neri', bytes: 1500 },
      { userId: null, name: null, bytes: 500 },
    ],
  };
  await act(async () =>
    root.render(
      <MemoryRouter>
        <StorageCharts usage={usage} />
      </MemoryRouter>,
    ),
  );
  await show('user');
  const rows = [...host.querySelectorAll('tbody tr')];
  const ring = (row: Element) =>
    row.querySelector<HTMLElement>('.storage-chart__ring')?.style.color;
  const track = (row: Element) =>
    row.querySelector<HTMLElement>('.storage-chart__track > span')?.style.background;
  const [paola, luca, none] = rows as [Element, Element, Element];
  expect(paola.querySelector('img')?.getAttribute('src')).toBe('https://example.com/paola.webp');
  expect(ring(paola)).toBe('var(--ink-accent-primary)');
  expect(track(paola)).toBe('var(--ink-accent-primary)');
  // No photo, or an older server: initials, in the next colour.
  expect(luca.querySelector('img')).toBeNull();
  expect(luca.querySelector('.ink-avatar')?.textContent).toBe('LN');
  expect(ring(luca)).toBe('var(--ink-tag-blue)');
  expect(track(luca)).toBe('var(--ink-tag-blue)');
  expect(none.querySelector('.ink-avatar svg')).not.toBeNull();
  expect(ring(none)).toBe('var(--ink-border-strong)');
  expect(track(none)).toBe('var(--ink-border-strong)');
  const stack = [...host.querySelectorAll<HTMLElement>('.storage-chart__stack > span')];
  expect(stack.map((s) => s.style.background)).toEqual([
    'var(--ink-accent-primary)',
    'var(--ink-tag-blue)',
    'var(--ink-border-strong)',
  ]);
});

it('opens on the per-person breakdown when the search names a person’s row (#708)', async () => {
  const usage: StorageUsage = {
    originalBytes: 4000,
    byType: [{ type: 'images', bytes: 4000 }],
    byProject: [{ projectId: 'p', name: 'Shoot', scope: 'project', bytes: 4000 }],
    byUser: [{ userId: 'u', name: 'Paola Rossi', bytes: 4000 }],
  };
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings?section=workspace&setting=workspace.byUser%3Au']}>
        <StorageCharts usage={usage} />
      </MemoryRouter>,
    ),
  );
  expect(host.querySelector('caption')?.textContent).toContain('admin.storageCharts.byUser');
  expect(host.querySelector('tr[data-setting="workspace.byUser:u"]')?.textContent).toContain(
    'Paola Rossi',
  );
});
