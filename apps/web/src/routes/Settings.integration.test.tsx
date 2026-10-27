// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { Settings } from './Settings.tsx';

const session = vi.hoisted(() => ({
  user: { role: 'admin', name: 'Editor', email: 'editor@example.test', locale: 'en' },
  refresh: vi.fn(),
}));
let currentLang = 'en';
const translations: Record<string, Record<string, string>> = {
  en: { 'settings.saved': 'Saved.' },
  it: { 'settings.saved': 'Salvato.' },
};
const i18nMock = {
  get language() {
    return currentLang;
  },
  changeLanguage: vi.fn(async (lng: string) => {
    currentLang = lng;
  }),
};
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('react-i18next', () => ({
  // Like react-i18next, `t` is bound to the language of the render that returned it.
  useTranslation: () => {
    const lng = currentLang;
    return { t: (key: string) => translations[lng]?.[key] ?? key, i18n: i18nMock };
  },
}));
vi.mock('../i18n/index.ts', () => ({ LOCALES: ['en', 'it'] }));
vi.mock('../lib/theme.ts', () => ({ useTheme: () => ({ preference: 'system', choose: vi.fn() }) }));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(async () => ({ items: [] })), patch: vi.fn(async () => ({})) },
  authApi: { listAccounts: vi.fn(async () => []) },
  RequestError: class extends Error {},
}));
vi.mock('./AppLayout.tsx', () => ({ useInstanceSetupState: () => ({}) }));
vi.mock('./InstanceSetup.tsx', () => ({ InstanceChecklist: () => null }));
vi.mock('../notifications/Notifications.tsx', () => ({
  EmailNotifications: () => <div data-notifications />,
}));
vi.mock('./ClassificationSettings.tsx', () => ({
  ClassificationSettings: () => <div data-classifications />,
}));

it('keeps email controls only in Notifications and gates the classifications page', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = async (section: string) => {
    await act(async () =>
      root.render(
        <MemoryRouter key={section + session.user.role} initialEntries={[`/settings${section}`]}>
          <Settings />
        </MemoryRouter>,
      ),
    );
  };
  try {
    await render('');
    expect(host.querySelector('[data-notifications]')).toBeNull();
    expect(host.textContent).toContain('settings.profile.avatarUpload');
    await render('?section=notifications');
    expect(host.querySelectorAll('[data-notifications]')).toHaveLength(1);
    await render('?section=classifications');
    expect(host.querySelector('h1')?.textContent).toBe('admin.classifications');
    expect(host.querySelector('[data-classifications]')).not.toBeNull();
    session.user.role = 'member';
    await render('?section=classifications');
    expect(host.querySelector('[data-classifications]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('admin.forbidden');
  } finally {
    session.user.role = 'admin';
    await act(async () => root.unmount());
  }
});

it('renders saved confirmation in the new language after switching language and saving', async () => {
  currentLang = 'en';
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/settings']}>
          <Settings />
        </MemoryRouter>,
      ),
    );
    const select = host.querySelector<HTMLSelectElement>('form select');
    if (!select) throw new Error('Locale select missing');
    await act(async () => {
      select.value = 'it';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const form = host.querySelector('form');
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('it');
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Salvato.');
  } finally {
    await act(async () => root.unmount());
  }
});
