// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { Settings } from './Settings.tsx';

const session = vi.hoisted(() => ({
  user: { role: 'admin', name: 'Editor', email: 'editor@example.test', locale: 'en' },
  version: '1.0.0',
  instance: { publicUrl: 'http://localhost:3000', auth: { google: false, oidc: [] } },
  refresh: vi.fn(),
}));
const phone = vi.hoisted(() => ({ value: false }));
const i18nMock = vi.hoisted(() => ({ language: 'en', changeLanguage: vi.fn(async () => {}) }));
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: i18nMock }),
}));
vi.mock('../i18n/index.ts', () => ({ LOCALES: ['en', 'it'] }));
vi.mock('../lib/theme.ts', () => ({ useTheme: () => ({ preference: 'system', choose: vi.fn() }) }));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(async () => ({ items: [] })), patch: vi.fn(async () => ({})) },
  authApi: { listAccounts: vi.fn(async () => []) },
  RequestError: class extends Error {},
}));
vi.mock('./AppLayout.tsx', () => ({
  useInstanceSetupState: () => ({ checks: null, error: false }),
}));
vi.mock('../notifications/Notifications.tsx', () => ({
  EmailNotifications: () => <div data-notifications />,
}));
vi.mock('./ClassificationSettings.tsx', () => ({
  ClassificationSettings: () => <div data-classifications />,
}));
vi.mock('./SettingsHome.tsx', () => ({ SettingsHome: () => <div data-home /> }));
vi.mock('./settings-ui.tsx', async (original) => ({
  ...(await original<typeof import('./settings-ui.tsx')>()),
  useIsPhone: () => phone.value,
}));

const host = document.createElement('div');
let root = createRoot(host);
afterEach(async () => {
  session.user.role = 'admin';
  phone.value = false;
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});
const render = (path: string) =>
  act(async () =>
    root.render(
      <MemoryRouter key={path + session.user.role + phone.value} initialEntries={[path]}>
        <Settings />
      </MemoryRouter>,
    ),
  );

const lead = () => host.querySelector('.settings__lead')?.textContent;

it('opens Account on desktop and the settings home on phones', async () => {
  await render('/settings');
  expect(lead()).toBe('settingsUi.leads.account');
  expect(host.querySelector('input[aria-label="settings.profile.avatarUpload"]')).not.toBeNull();
  expect(host.querySelector('[data-home]')).toBeNull();
  phone.value = true;
  await render('/settings');
  expect(host.querySelector('[data-home]')).not.toBeNull();
  await render('/settings?section=account');
  expect(lead()).toBe('settingsUi.leads.account');
});

it('lays Account out as one column of groups, ending with the danger zone', async () => {
  await render('/settings?section=account');
  expect(host.querySelector('aside')).toBeNull();
  const groups = [...host.querySelectorAll('.settings-card h3')].map((h) => h.textContent);
  expect(groups).toEqual([
    'settings.profile.title',
    'settings.methods.title',
    'settings.sessions.title',
    'settings.tokens.title',
    'settingsUi.dangerZone',
  ]);
  expect(host.querySelector('.settings-card--danger h3')?.textContent).toBe(
    'settingsUi.dangerZone',
  );
});

it('keeps email controls only in Notifications and gates admin pages', async () => {
  await render('/settings?section=account');
  expect(host.querySelector('[data-notifications]')).toBeNull();
  await render('/settings?section=notifications');
  expect(host.querySelectorAll('[data-notifications]')).toHaveLength(1);
  await render('/settings?section=classifications');
  expect(lead()).toBe('catalogs.scope');
  expect(host.querySelector('[data-classifications]')).not.toBeNull();
  session.user.role = 'member';
  for (const section of ['classifications', 'registration', 'providers', 'workspace']) {
    await render(`/settings?section=${section}`);
    expect(host.querySelector('[data-classifications]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('admin.forbidden');
  }
});

it('saves the language as soon as it changes, without a save button', async () => {
  await render('/settings?section=preferences');
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'settings.save')).toBe(
    false,
  );
  const select = host.querySelector<HTMLSelectElement>('select');
  if (!select) throw new Error('Locale select missing');
  await act(async () => {
    select.value = 'it';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(api.patch).toHaveBeenCalledWith('/me', { locale: 'it' });
  expect(i18nMock.changeLanguage).toHaveBeenCalledWith('it');
  expect(session.refresh).toHaveBeenCalled();
});

it('autosaves the profile name after typing stops, never an empty one', async () => {
  vi.useFakeTimers();
  try {
    await render('/settings?section=account');
    const input = host.querySelector<HTMLInputElement>('.settings-input');
    if (!input) throw new Error('Name input missing');
    const type = (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await type('   ');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(api.patch).not.toHaveBeenCalled();
    await type('Editor Two');
    expect(api.patch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(api.patch).toHaveBeenCalledWith('/me', { name: 'Editor Two' });
    expect(api.patch).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
