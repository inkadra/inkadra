// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({
    user: { id: 'u', name: 'Matteo', role: 'owner', email: 'm@example.test' },
    instance: { name: 'Inkadra', setupComplete: true },
    refresh: vi.fn(),
  }),
}));
vi.mock('../lib/theme.ts', () => ({ useTheme: () => ({ theme: 'light', toggle: vi.fn() }) }));
vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(async () => ({ items: [], nextCursor: null })), post: vi.fn() },
  authApi: {},
  RequestError: class extends Error {},
}));
vi.mock('./InstanceSetup.tsx', () => ({
  useInstanceSetup: () => ({ checks: null, error: false }),
}));
vi.mock('../notifications/Notifications.tsx', () => ({
  useUnreadCount: () => [0, vi.fn()],
  useNotificationFeed: () => ({}),
  NotificationBell: ({ onOpenInbox }: { onOpenInbox: (opener: HTMLElement) => void }) => (
    <button type="button" onClick={(e) => onOpenInbox(e.currentTarget)}>
      Bell
    </button>
  ),
  NotificationList: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      Close inbox
    </button>
  ),
}));

it.each(['/projects', '/settings'])(
  'preserves the outlet layout and restores bell focus at %s',
  async (path) => {
    localStorage.clear();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="*" element={<div data-testid="outlet" style={{ height: '100%' }} />} />
              </Route>
            </Routes>
          </MemoryRouter>,
        ),
      );
      const wrapper = host.querySelector('[data-testid="outlet"]')?.parentElement;
      expect(wrapper?.style.display).toBe('contents');
      expect(wrapper?.hidden).toBe(false);
      const bell = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Bell');
      await act(async () => bell?.click());
      expect(wrapper?.style.display).toBe('none');
      const shell = host.querySelector('.ink-shell');
      expect(shell?.classList.contains('ink-shell--collapsed')).toBe(path !== '/settings');
      if (path !== '/settings')
        expect(host.querySelector('.ink-sidebar__toggle')?.getAttribute('aria-expanded')).toBe(
          'false',
        );
      await act(async () =>
        [...host.querySelectorAll('button')].find((b) => b.textContent === 'Close inbox')?.click(),
      );
      expect(wrapper?.style.display).toBe('contents');
      expect(document.activeElement).toBe(bell);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);
