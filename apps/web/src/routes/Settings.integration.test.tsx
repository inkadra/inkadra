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
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../i18n/index.ts', () => ({ LOCALES: ['en', 'it'] }));
vi.mock('../lib/theme.ts', () => ({ useTheme: () => ({ preference: 'system', choose: vi.fn() }) }));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(async () => ({ items: [] })) },
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
