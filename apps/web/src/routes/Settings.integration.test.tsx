// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authApi, RequestError } from '../lib/api.ts';
import { chooseSelect } from '../test/select.ts';
import { Settings } from './Settings.tsx';

const session = vi.hoisted(() => ({
  user: { id: 'editor', role: 'admin', name: 'Editor', email: 'editor@example.test', locale: 'en' },
  version: '1.0.0',
  instance: { publicUrl: 'http://localhost:3000', auth: { emailPassword: true, google: false, oidc: [] } },
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
vi.mock('../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn(async () => ({ items: [] })), post: vi.fn(), patch: vi.fn(async () => ({})) },
  authApi: { signIn: vi.fn(async () => ({})), listAccounts: vi.fn(async () => []) },
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
  sessionStorage.clear();
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
  const groups = () => [...host.querySelectorAll('.settings-block h3')].map((h) => h.textContent);
  // Your space follows Sessions; tokens and the clipper moved to Connected apps (0124).
  expect(groups()).toEqual([
    'settings.profile.title',
    'settings.methods.title',
    'settings.sessions.title',
    'storageSpace.title',
    'settingsUi.dangerZone',
  ]);
  expect(
    host.querySelector('.settings-card--danger')?.closest('.settings-block')?.querySelector('h3')
      ?.textContent,
  ).toBe('settingsUi.dangerZone');
  // Every block is one bordered card.
  for (const block of host.querySelectorAll('.settings-block'))
    expect(block.querySelectorAll(':scope > .settings-card')).toHaveLength(1);
  await render('/settings?section=apps');
  expect(groups()).toEqual(['calendar.title', 'settingsUi.apps.clipper', 'settings.tokens.title']);
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
  for (const section of ['classifications', 'registration', 'providers', 'workspace', 'reports']) {
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
  const select = host.querySelector<HTMLButtonElement>('.ink-select');
  if (!select) throw new Error('Locale .ink-select missing');
  await act(async () => {
    chooseSelect(select, 'it');
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

it('points to the clipper in the store until a clipper token exists, then shows it connected', async () => {
  await render('/settings?section=apps');
  const row = () => host.querySelector('.settings-clipper');
  expect(row()?.querySelector('code')?.textContent).toBe('http://localhost:3000');
  const store = row()?.querySelector('a');
  expect(store?.getAttribute('href')).toBe(
    'https://chromewebstore.google.com/detail/inkadra-clipper/hdajoikapihpjfbgioeagenmoalckjkh',
  );
  expect(store?.getAttribute('target')).toBe('_blank');
  expect(store?.querySelector('img')?.getAttribute('alt')).toBe('settings.tokens.clipper.store');
  expect(row()?.textContent).not.toContain('settings.tokens.clipper.connected');

  vi.mocked(api.get).mockImplementation(async (path: string) => ({
    items:
      path === '/me/tokens'
        ? [{ id: 't1', name: 'Chrome', prefix: 'ink_', client: 'clipper' }]
        : [],
  }));
  await render('/settings?section=apps&again');
  expect(row()?.querySelector('a')).toBeNull();
  expect(row()?.textContent).toContain('settings.tokens.clipper.connected');
  expect(row()?.querySelector('code')).not.toBeNull();
  vi.mocked(api.get).mockImplementation(async () => ({ items: [] }));
});

it('keeps the token name and retries creation after confirming the password', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new RequestError(403, 'forbidden', '', { reason: 'reauth_required' }))
    .mockResolvedValueOnce({ name: 'My integration', token: 'demo-token' });
  await render('/settings?section=apps');
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'settingsUi.account.newToken')?.click());
  const input = host.querySelector('input[maxlength="80"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'My integration');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('form.settings-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(input.value).toBe('My integration');
  expect(host.querySelector('form.login__form')).not.toBeNull();
  vi.mocked(api.get).mockResolvedValueOnce({ id: 'editor' } as never);
  await act(async () => host.querySelector('form.login__form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(authApi.signIn).toHaveBeenCalledWith('editor@example.test', '');
  expect(api.post).toHaveBeenNthCalledWith(2, '/me/tokens', { name: 'My integration' });
  expect(host.textContent).toContain('demo-token');
});
