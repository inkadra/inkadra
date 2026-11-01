// @vitest-environment happy-dom
import { DEFAULT_USER_PREFERENCES } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { EmailNotifications } from './Notifications.tsx';

const state = vi.hoisted(() => ({ available: false }));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ instance: { releaseNews: state.available } }),
}));
vi.mock('../lib/preferences.ts', () => ({
  usePreferences: () => DEFAULT_USER_PREFERENCES,
  updatePreferences: vi.fn(),
}));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(async () => ({ email: 'immediate' })), patch: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('hides release news without SMTP or admin permission and defaults to off', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<EmailNotifications releaseNewsAvailable={state.available} />),
    );
    expect(host.querySelector('[aria-label="settingsUi.notifications.releaseNews"]')).toBeNull();
    state.available = true;
    await act(async () =>
      root.render(<EmailNotifications releaseNewsAvailable={state.available} />),
    );
    const toggle = host.querySelector<HTMLInputElement>(
      '[aria-label="settingsUi.notifications.releaseNews"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
