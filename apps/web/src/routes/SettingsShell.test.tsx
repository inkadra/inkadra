// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { expect, it, vi } from 'vitest';
import { SettingsShell } from './SettingsShell.tsx';

const session = vi.hoisted(() => ({ user: { role: 'admin' } }));
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
function Page() {
  const location = useLocation();
  return (
    <SettingsShell>
      <output>{location.pathname + location.search}</output>
    </SettingsShell>
  );
}
it('makes every permitted section selectable on mobile and follows route changes', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/settings/team']}>
          <Page />
        </MemoryRouter>,
      ),
    );
    const select = host.querySelector('select');
    expect(select?.options).toHaveLength(7);
    expect(select?.value).toBe('/settings/team');
    expect(host.querySelector(`label[for="${select?.id}"]`)?.textContent).toContain('nav.settings');
    await act(async () => {
      if (select) {
        select.value = '/settings?section=providers';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(host.querySelector('output')?.textContent).toBe('/settings?section=providers');
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('admin.providers');
    session.user.role = 'member';
    await act(async () =>
      root.render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>,
      ),
    );
    expect(select?.options).toHaveLength(3);
  } finally {
    session.user.role = 'admin';
    await act(async () => root.unmount());
    host.remove();
  }
});
