// @vitest-environment happy-dom
import type { InstanceRelease, InstanceSettings, InstanceUpdates } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { resetUpdates } from '../lib/updates.ts';
import { chooseSelect } from '../test/select.ts';
import { UpdateSettings } from './UpdateSettings.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: 'en' },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { role: 'admin' }, refresh: async () => {} }),
}));
vi.mock('../lib/api.ts', async (load) => ({
  ...(await load<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  resetUpdates();
  vi.clearAllMocks();
});

const settings: InstanceSettings = {
  name: 'Studio',
  registration: 'invite',
  requireAdminTwoFactor: false,
  releaseNews: true,
  calendarFeedEnabled: true,
  membersCanCreateProjects: true,
  updateCheck: true,
  updateChannel: 'stable',
};
const release = (version: string, patch: Partial<InstanceRelease> = {}): InstanceRelease => ({
  version,
  publishedAt: '2026-11-06T10:00:00.000Z',
  prerelease: false,
  url: `https://github.com/inkadra/inkadra/releases/tag/v${version}`,
  highlights: [`News of ${version}`],
  beforeUpdating: [],
  ...patch,
});
const updates = (patch: Partial<InstanceUpdates> = {}): InstanceUpdates => ({
  current: '0.8.0',
  checkEnabled: true,
  channel: 'stable',
  checkedAt: '2026-11-07T14:10:00.000Z',
  failed: false,
  available: null,
  earlier: [release('0.8.0'), release('0.7.0', { highlights: [] })],
  ...patch,
});

async function show(data: InstanceUpdates) {
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path === '/instance/settings' ? settings : data,
  );
  await act(async () =>
    root.render(
      <MemoryRouter>
        <UpdateSettings />
      </MemoryRouter>,
    ),
  );
}

it('says the instance is up to date, lists earlier versions and checks again on request', async () => {
  await show(updates());
  expect(host.textContent).toContain('updates.upToDate');
  expect(host.textContent).toContain('updates.inUse');
  // A release without highlights reads as a fix release.
  expect(host.textContent).toContain('updates.noSummary');
  vi.mocked(api.post).mockResolvedValue(updates({ available: release('0.9.0') }));
  const check = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'updates.checkNow',
  );
  await act(async () => check?.click());
  expect(api.post).toHaveBeenCalledWith('/instance/updates/check', {});
  expect(host.textContent).toContain('updates.available:{"version":"0.9.0"}');
});

it('shows a new version as plain text, with what to read first and how to update', async () => {
  await show(
    updates({
      available: release('0.9.0-rc.1', {
        prerelease: true,
        highlights: ['<img src=x onerror=alert(1)> Phones'],
        beforeUpdating: ['Reports', 'Email language'],
      }),
    }),
  );
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toContain('<img src=x onerror=alert(1)> Phones');
  expect(host.textContent).toContain('updates.preview');
  expect(host.textContent).toContain('updates.beforeUpdating:{"count":2}');
  expect(host.querySelector('pre')?.textContent).toBe('INKADRA_TAG=0.9.0-rc.1');
  const links = [...host.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')];
  expect(links.every((a) => a.rel === 'noopener noreferrer')).toBe(true);
});

it('saves the switch and the channel, then reads the updates again', async () => {
  await show(updates());
  vi.mocked(api.patch).mockResolvedValue({ ...settings, updateChannel: 'preview' });
  const select = host.querySelector('[data-tour="updates-alerts"] button.ink-select');
  await act(async () => chooseSelect(select, 'preview'));
  expect(api.patch).toHaveBeenCalledWith('/instance/settings', { updateChannel: 'preview' });
  expect(vi.mocked(api.get).mock.calls.filter(([p]) => p === '/instance/updates')).toHaveLength(
    2,
  );
});
