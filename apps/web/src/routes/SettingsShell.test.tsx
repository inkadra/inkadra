// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { SaveStatus, SettingsNav, SettingsShell } from './SettingsShell.tsx';
import { trackSave } from './settings-save.ts';

const session = vi.hoisted(() => ({ user: { role: 'admin' }, instance: { version: '1.2.3' } }));
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Where() {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}
const host = document.createElement('div');
document.body.append(host);
let root = createRoot(host);
afterEach(async () => {
  session.user.role = 'admin';
  await act(async () => root.unmount());
  root = createRoot(host);
});
const setup = { checks: [{ id: 'smtp', ok: false }], error: false };

it('groups permitted pages, marks the current one and flags incomplete setup', async () => {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings/team']}>
        <SettingsNav setup={setup} />
        <Where />
      </MemoryRouter>,
    ),
  );
  expect([...host.querySelectorAll('.settings-nav__group h2')].map((h) => h.textContent)).toEqual([
    'admin.personal',
    'admin.workspace',
    'settingsUi.groups.instance',
  ]);
  expect(host.querySelectorAll('.settings-nav a.ink-nav')).toHaveLength(9);
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('admin.members');
  expect(host.querySelector('[data-attention]')?.getAttribute('href')).toBe(
    '/settings?section=providers',
  );
  expect(host.textContent).toContain('Inkadra 1.2.3');
  await act(async () =>
    host.querySelector<HTMLAnchorElement>('a[href="/settings?section=classifications"]')?.click(),
  );
  expect(host.querySelector('output')?.textContent).toBe('/settings?section=classifications');
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('admin.classifications');
});

it('hides admin pages from members', async () => {
  session.user.role = 'member';
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsNav setup={{ checks: null, error: false }} />
      </MemoryRouter>,
    ),
  );
  expect(host.querySelectorAll('.settings-nav a.ink-nav')).toHaveLength(3);
  expect(host.querySelector('a[href="/settings?section=classifications"]')).toBeNull();
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('admin.account');
});

it('reports autosave progress and failures in the header, and resets per page', async () => {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings?section=preferences']}>
        <SaveStatus />
        <SettingsShell>
          <p />
        </SettingsShell>
      </MemoryRouter>,
    ),
  );
  const status = () => host.querySelector('.settings-save');
  expect(status()?.textContent).toBe('settingsUi.autosave.idle');
  expect(host.querySelector('h1')?.textContent).toBe('admin.preferences');
  let finish: () => void = () => {};
  let saving: Promise<unknown> = Promise.resolve();
  await act(async () => {
    saving = trackSave(new Promise<void>((resolve) => (finish = resolve)));
  });
  expect(status()?.textContent).toBe('settingsUi.autosave.saving');
  await act(async () => {
    finish();
    await saving;
  });
  expect(status()?.textContent).toBe('settingsUi.autosave.saved');
  await act(async () => {
    await trackSave(Promise.reject(new Error('offline'))).catch(() => {});
  });
  expect(status()?.getAttribute('role')).toBe('alert');
  expect(status()?.textContent).toBe('settingsUi.autosave.error');
});
