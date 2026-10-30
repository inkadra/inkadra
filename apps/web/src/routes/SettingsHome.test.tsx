// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { authApi } from '../lib/api.ts';
import { SettingsHome } from './SettingsHome.tsx';

const session = vi.hoisted(() => ({
  user: { role: 'admin', name: 'Ada Lovelace', email: 'ada@example.com', locale: 'it' },
  version: '0.4.0',
  instance: {},
  refresh: vi.fn(async () => {}),
}));
const choose = vi.hoisted(() => vi.fn());
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/theme.ts', () => ({ useTheme: () => ({ preference: 'dark', choose }) }));
vi.mock('./projects.ts', () => ({ setCachedProjects: vi.fn() }));
vi.mock('../lib/api.ts', () => ({
  api: {
    get: vi.fn(async (path: string) =>
      path === '/me/notification-preferences'
        ? { email: 'daily' }
        : path === '/instance/members'
          ? {
              items: [
                { id: 'a', deactivatedAt: null },
                { id: 'b', deactivatedAt: null },
                { id: 'c', deactivatedAt: '2026-01-01T00:00:00Z' },
              ],
            }
          : path === '/instance/settings'
            ? { name: 'Inkadra', registration: 'closed' }
            : { originalBytes: 2_500_000_000, byType: [], byProject: [] },
    ),
    patch: vi.fn(),
  },
  authApi: { signOut: vi.fn(async () => {}) },
}));

const host = document.createElement('div');
let root = createRoot(host);
afterEach(async () => {
  session.user.role = 'admin';
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});
const render = () =>
  act(async () =>
    root.render(
      <MemoryRouter>
        <SettingsHome setup={{ checks: [{ id: 'smtp', ok: false }], error: false }} />
      </MemoryRouter>,
    ),
  );

it('shows grouped rows with current values, inline theme and sign out', async () => {
  await render();
  // The window header carries the title; the list starts with the person.
  expect(host.querySelector('h1')).toBeNull();
  expect(host.querySelector('.settings-home__me')?.getAttribute('href')).toBe(
    '/settings?section=account',
  );
  const row = (href: string) => host.querySelector(`a[href="${href}"]`)?.textContent ?? '';
  expect(row('/settings?section=notifications')).toContain('settingsUi.notifications.short.daily');
  expect(row('/settings/team')).toContain('2');
  expect(row('/settings?section=workspace')).toContain('2.5 GB');
  expect(row('/settings?section=registration')).toContain('admin.registrationModes.closed');
  expect(row('/settings?section=providers')).toContain('onboarding.needsSetup');
  expect(row('/settings?section=instance')).not.toContain('onboarding.needsSetup');
  await act(async () => {
    host.querySelector<HTMLInputElement>('.ink-segmented input[value="light"]')?.click();
  });
  expect(choose).toHaveBeenCalledWith('light');
  await act(async () => host.querySelector<HTMLButtonElement>('.settings-home__signout')?.click());
  expect(authApi.signOut).toHaveBeenCalled();
  expect(session.refresh).toHaveBeenCalled();
  expect(host.textContent).toContain('Inkadra 0.4.0');
});

it('shows only personal rows to members', async () => {
  session.user.role = 'member';
  await render();
  expect(host.querySelector('a[href="/settings/team"]')).toBeNull();
  expect(host.querySelector('a[href="/settings?section=providers"]')).toBeNull();
  expect(host.querySelector('a[href="/settings?section=preferences"]')).not.toBeNull();
});
