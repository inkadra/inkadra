// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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

it.each(['/projects', '/'])(
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
      expect(shell?.classList.contains('ink-shell--collapsed')).toBe(true);
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

const mounts = vi.hoisted(() => ({ page: 0 }));
function Page() {
  const { pathname } = useLocation();
  useEffect(() => {
    mounts.page += 1;
  }, []);
  return <output data-page>{pathname}</output>;
}
function Where() {
  const { pathname, search } = useLocation();
  return <output data-settings>{pathname + search}</output>;
}

async function mount(path: string) {
  localStorage.clear();
  mounts.page = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    // Strict mode, as in the app: the window must survive its effects running twice.
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppLayout home={<output data-home>home</output>} />}>
              <Route index element={<output data-index />} />
              <Route path="projects" element={<Page />} />
              <Route path="settings" element={<Where />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    ),
  );
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
  return {
    host,
    button,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it('opens settings as a window over the page, which stays mounted, and closes back to it', async () => {
  const { host, button, unmount } = await mount('/projects');
  try {
    const trigger = button('nav.settings');
    trigger?.focus();
    await act(async () => trigger?.click());
    const dialog = host.querySelector<HTMLDialogElement>('dialog.settings-window');
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.querySelector('[data-settings]')?.textContent).toBe('/settings');
    // The page underneath keeps its own URL and is not remounted.
    expect(host.querySelector('[data-page]')?.textContent).toBe('/projects');
    expect(mounts.page).toBe(2);
    await act(async () => button('settingsUi.close')?.click());
    expect(host.querySelector('dialog.settings-window')).toBeNull();
    expect(host.querySelector('[data-page]')?.textContent).toBe('/projects');
    // Strict mode mounts twice up front; opening and closing settings adds nothing.
    expect(mounts.page).toBe(2);
    expect(document.activeElement).toBe(trigger);
  } finally {
    await unmount();
  }
});

it('shows Home under a settings URL loaded directly and closes with Escape', async () => {
  const { host, unmount } = await mount('/settings?section=preferences');
  try {
    const dialog = host.querySelector<HTMLDialogElement>('dialog.settings-window');
    expect(host.querySelector('[data-home]')).not.toBeNull();
    expect(dialog?.querySelector('[data-settings]')?.textContent).toBe(
      '/settings?section=preferences',
    );
    expect(dialog?.querySelector('h2')?.textContent).toBe('admin.preferences');
    await act(async () => {
      dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(host.querySelector('dialog.settings-window')).toBeNull();
    expect(host.querySelector('[data-index]')).not.toBeNull();
  } finally {
    await unmount();
  }
});
