// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { OfficeInfo, OfficeStage, useOfficePreview } from './OfficePreview.tsx';
import type { OfficePreview } from './office.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'it' } }),
}));

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

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, done: () => act(async () => root.unmount()) };
}
const sheetAsset = { id: 'a', filename: 'budget.xlsx', size: 10, url: '/f' } as Asset;
const stage = (data: OfficePreview | null, role = 'member') => {
  return (
    <OfficeStage
      admin={role === 'admin'}
      asset={sheetAsset}
      data={data}
      page={1}
      setPage={vi.fn()}
      sheet={0}
      setSheet={vi.fn()}
    />
  );
};

it('right-aligns numbers, marks left-out rows and puts the tabs below the sheet', async () => {
  const { host, done } = await mount(
    stage({
      pageCount: 0,
      sheets: [
        {
          name: 'Budget',
          rows: [
            ['Voce', 'Giorni'],
            ['Luci', '6'],
            ['Note', '12,5'],
          ],
          truncated: true,
        },
        { name: 'Troupe', rows: [['Nome']] },
      ],
    }),
  );
  expect([...host.querySelectorAll('td.n')].map((c) => c.textContent)).toEqual(['6', '12,5']);
  expect(host.querySelector('.office-sheet__more td')?.textContent).toBe('…');
  expect(host.querySelector('.office-sheet__note')?.textContent).toBe('office.truncated');
  const kids = [...(host.querySelector('.office-sheet')?.children ?? [])].map((c) => c.className);
  expect(kids.at(-1)).toBe('office-sheet__tabs');
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
  await done();
});

it('says so when a sheet is too big to read at all, and hides the tabs of a single sheet', async () => {
  const { host, done } = await mount(
    stage({ pageCount: 0, sheets: [{ name: 'Big', rows: [], truncated: true }] }),
  );
  expect(host.querySelector('.office-sheet__empty')?.textContent).toBe('office.tooBig');
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  await done();
});

it('tells admins where to turn conversion on, and everyone else only that it is off', async () => {
  const off: OfficePreview = { pageCount: 0, sheets: [] };
  for (const [role, text] of [
    ['admin', 'office.disabledAdmin'],
    ['member', 'office.disabled'],
  ] as const) {
    const { host, done } = await mount(stage(off, role));
    expect(host.querySelector('.viewer__file p')?.textContent).toBe(text);
    await done();
  }
});

it('does not offer a table for a sheet with rows left out', async () => {
  const { host, done } = await mount(
    <OfficeInfo
      asset={sheetAsset}
      data={{ pageCount: 0, sheets: [{ name: 'Budget', rows: [['a']], truncated: true }] }}
      onTable={vi.fn()}
    />,
  );
  expect(host.querySelector<HTMLButtonElement>('button.ink-btn--primary, button')?.disabled).toBe(
    true,
  );
  expect(host.textContent).toContain('office.truncatedTable');
  await done();
});
