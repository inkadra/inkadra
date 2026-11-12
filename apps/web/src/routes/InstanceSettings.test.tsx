// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { InstanceSettings } from './InstanceSettings.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
const session = vi.hoisted(() => ({
  instance: null,
  user: { twoFactorEnabled: false },
  refresh: vi.fn(async () => {}),
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('../lib/api.ts', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('../lib/updates.ts', async (original) => ({
  ...(await original<typeof import('../lib/updates.ts')>()),
  usePendingUpdate: () => null,
}));
const host = document.createElement('div');
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});
it('shows storage loading failures as errors, never as zero usage or perpetual loading', async () => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/instance/settings') return { name: 'Inkadra', registration: 'open' };
    throw new Error('forbidden or offline');
  });
  await act(async () =>
    root.render(
      <MemoryRouter>
        <InstanceSettings section="workspace" setup={{ checks: null, error: false }} />
      </MemoryRouter>,
    ),
  );
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.textContent).not.toContain('admin.storageEmpty');
  expect(host.querySelector('table')).toBeNull();
});

it('disables policy activation with an explanation until the administrator is enrolled', async () => {
  session.user.twoFactorEnabled = false;
  vi.mocked(api.get).mockResolvedValue({
    name: 'Inkadra',
    registration: 'open',
    requireAdminTwoFactor: false,
  });
  await act(async () =>
    root.render(
      <MemoryRouter>
        <InstanceSettings section="access" setup={{ checks: null, error: false }} />
      </MemoryRouter>,
    ),
  );
  const checkbox = host.querySelector<HTMLInputElement>(
    'input[aria-label="admin.requireAdminTwoFactor"]',
  )!;
  expect(checkbox.disabled).toBe(true);
  expect(host.textContent).toContain('admin.requireAdminTwoFactorEnrollFirst');
  await act(async () => checkbox.click());
  expect(api.patch).not.toHaveBeenCalled();
});

it('refreshes the session immediately after an enrolled administrator activates the policy', async () => {
  session.user.twoFactorEnabled = true;
  vi.mocked(api.get).mockResolvedValue({
    name: 'Inkadra',
    registration: 'open',
    requireAdminTwoFactor: false,
  });
  vi.mocked(api.patch).mockResolvedValue({
    name: 'Inkadra',
    registration: 'open',
    requireAdminTwoFactor: true,
  });
  await act(async () =>
    root.render(
      <MemoryRouter>
        <InstanceSettings section="access" setup={{ checks: null, error: false }} />
      </MemoryRouter>,
    ),
  );
  const checkbox = host.querySelector<HTMLInputElement>(
    'input[aria-label="admin.requireAdminTwoFactor"]',
  )!;
  expect(checkbox.disabled).toBe(false);
  await act(async () => checkbox.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/settings', { requireAdminTwoFactor: true });
  expect(session.refresh).toHaveBeenCalledOnce();
  expect(checkbox.checked).toBe(true);
});

it('ends registration loading when the connection stalls', async () => {
  vi.useFakeTimers();
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  await act(async () =>
    root.render(
      <MemoryRouter>
        <InstanceSettings section="access" setup={{ checks: null, error: false }} />
      </MemoryRouter>,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[role="status"]')).toBeNull();
  vi.useRealTimers();
});

it('holds the rights that left Members on Access and permissions (0124)', async () => {
  vi.mocked(api.get).mockResolvedValue({
    name: 'Inkadra',
    registration: 'invite',
    membersCanCreateProjects: true,
    calendarFeedEnabled: true,
  });
  vi.mocked(api.patch).mockImplementation(async (_path, patch) => ({
    name: 'Inkadra',
    registration: 'invite',
    ...(patch as object),
  }));
  await act(async () =>
    root.render(
      <MemoryRouter>
        <InstanceSettings section="access" setup={{ checks: null, error: false }} />
      </MemoryRouter>,
    ),
  );
  expect(host.textContent).toContain('settingsUi.registration.invite');
  const create = host.querySelector<HTMLInputElement>('#members-create-projects')!;
  await act(async () => create.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/settings', {
    membersCanCreateProjects: false,
  });
  const feed = host.querySelector<HTMLInputElement>('input[aria-label="calendar.admin"]')!;
  await act(async () => feed.click());
  expect(api.patch).toHaveBeenCalledWith('/instance/settings', { calendarFeedEnabled: false });
  expect(host.textContent).toContain('settingsUi.accessPage.readOnly');
});

it('sends a failing setup check of General to the page that fixes it', async () => {
  vi.mocked(api.get).mockResolvedValue({ name: 'Inkadra', registration: 'open' });
  await act(async () =>
    root.render(
      <MemoryRouter>
        <InstanceSettings
          section="instance"
          setup={{
            checks: [
              { id: 'domain', ok: true },
              { id: 'smtp', ok: false },
            ],
            error: false,
          }}
        />
      </MemoryRouter>,
    ),
  );
  const configure = [...host.querySelectorAll('a')].filter((a) =>
    a.textContent?.includes('settingsUi.general.configure'),
  );
  expect(configure.map((a) => a.getAttribute('href'))).toEqual(['/settings?section=access']);
  expect(host.textContent).toContain('settingsUi.general.fix.smtp');
  expect(host.textContent).toContain('onboarding.ready');
  // Release news, reports, storage and the server link left General.
  expect(host.textContent).not.toContain('settingsUi.notifications.releaseNews');
  expect(host.textContent).not.toContain('feedback.settingsTitle');
});
