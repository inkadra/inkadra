// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AdminEnrollment } from './AdminEnrollment.tsx';

const state = vi.hoisted(() => ({ enrollmentRequired: false }));
vi.mock('../lib/theme.ts', () => ({ useTheme: () => ({}) }));
vi.mock('../lib/session.tsx', () => ({ useSession: () => state }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./Settings.tsx', () => ({ TwoFactor: () => <form aria-label="Enroll" /> }));

it('replaces all protected content with enrollment until the administrator has verified 2FA', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    state.enrollmentRequired = true;
    await act(async () =>
      root.render(
        <AdminEnrollment>
          <div data-workspace />
        </AdminEnrollment>,
      ),
    );
    expect(host.querySelector('[data-workspace]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'settings.twoFactor.requiredAdmin',
    );
    expect(host.querySelector('form')?.getAttribute('aria-label')).toBe('Enroll');
    state.enrollmentRequired = false;
    await act(async () =>
      root.render(
        <AdminEnrollment>
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
