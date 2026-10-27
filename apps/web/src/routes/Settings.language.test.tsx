// @vitest-environment happy-dom
import i18next from 'i18next';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../i18n/en.json';
import itLocale from '../i18n/it.json';
import { api } from '../lib/api.ts';
import { Settings } from './Settings.tsx';

const session = vi.hoisted(() => ({
  user: { role: 'member', name: 'Editor', email: 'editor@example.test', locale: 'en' },
  refresh: vi.fn(async () => {}),
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('../lib/theme.ts', () => ({ useTheme: () => ({ preference: 'system', choose: vi.fn() }) }));
vi.mock('../lib/api.ts', () => ({
  api: {
    get: vi.fn(async () => ({ items: [] })),
    patch: vi.fn(async () => ({})),
  },
  authApi: { listAccounts: vi.fn(async () => []) },
  RequestError: class extends Error {},
}));
vi.mock('./AppLayout.tsx', () => ({ useInstanceSetupState: () => ({}) }));
vi.mock('./InstanceSetup.tsx', () => ({ InstanceChecklist: () => null }));
vi.mock('../notifications/Notifications.tsx', () => ({ EmailNotifications: () => null }));
vi.mock('./ClassificationSettings.tsx', () => ({ ClassificationSettings: () => null }));

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['en', 'it'],
  ['it', 'en'],
])('confirms a profile save in the new language when switching from %s to %s', async (from, to) => {
  const resources = { en: { translation: en }, it: { translation: itLocale } };
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({ lng: from, resources });
  session.user.locale = from;
  vi.clearAllMocks();
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/settings']}>
            <Settings />
          </MemoryRouter>
        </I18nextProvider>,
      ),
    );
    const form = host.querySelector('form');
    const select = form?.querySelector('select');
    expect(form).not.toBeNull();
    expect(select).not.toBeNull();
    if (!form || !select) throw new Error('Missing profile form');
    await act(async () => {
      select.value = to;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(api.patch).toHaveBeenCalledWith('/me', { name: 'Editor', locale: to });
    expect(session.refresh).toHaveBeenCalledOnce();
    expect(i18n.language).toBe(to);
    expect(form.querySelector('[role="status"]')?.textContent).toBe(
      i18n.t('settings.saved', { lng: to }),
    );
  } finally {
    await act(async () => root.unmount());
    session.user.locale = 'en';
  }
});
