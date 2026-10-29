// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AdminEnrollment } from './AdminEnrollment.tsx';

const state = vi.hoisted(() => ({ enrollmentRequired: false, refresh: vi.fn(async () => {}) }));
const signOut = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../lib/api.ts', () => ({ authApi: { signOut } }));
vi.mock('./projects.ts', () => ({ setCachedProjects: vi.fn() }));
vi.mock('../lib/theme.ts', () => ({ useTheme: () => ({}) }));
vi.mock('../lib/session.tsx', () => ({ useSession: () => state }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('replaces all protected content with enrollment until the administrator has verified 2FA', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    state.enrollmentRequired = true;
    await act(async () =>
      root.render(
        <AdminEnrollment setup={<form aria-label="Enroll" />}>
          <div data-workspace />
        </AdminEnrollment>,
      ),
    );
    expect(host.querySelector('[data-workspace]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'settings.twoFactor.requiredAdmin',
    );
    expect(host.querySelector('form')?.getAttribute('aria-label')).toBe('Enroll');
    const logout = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'auth.signOut',
    );
    expect(logout).toBeDefined();
    await act(async () => logout!.click());
    expect(signOut).toHaveBeenCalledOnce();
    expect(state.refresh).toHaveBeenCalledOnce();
    state.enrollmentRequired = false;
    await act(async () =>
      root.render(
        <AdminEnrollment setup={<form aria-label="Enroll" />}>
          <div data-workspace />
        </AdminEnrollment>,
      ),
    );
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[data-workspace]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
