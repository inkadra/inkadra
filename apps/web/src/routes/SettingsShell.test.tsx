// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { SaveStatus, SettingsNav, SettingsShell, setupAttention } from './SettingsShell.tsx';
import { trackSave } from './settings-save.ts';
import { CHECK_PAGES } from './settings-sections.ts';

const session = vi.hoisted(() => ({
  user: { role: 'admin' },
  version: '1.2.3',
  instance: { name: 'Studio' },
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { languages: ['en'] } }),
}));

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
        <SettingsNav setup={setup} members={6} />
        <Where />
      </MemoryRouter>,
    ),
  );
  expect([...host.querySelectorAll('.settings-nav__group h3')].map((h) => h.textContent)).toEqual([
    'admin.personal',
    'settingsUi.groups.workspace',
    'settingsUi.groups.server',
  ]);
  expect(host.querySelectorAll('.settings-nav__item')).toHaveLength(16);
  const iconOf = (section: string) =>
    host.querySelector(`a[href="/settings?section=${section}"] svg`)?.innerHTML;
  expect(new Set([iconOf('preferences'), iconOf('tutorials'), iconOf('instance')]).size).toBe(3);
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('admin.members6');
  // A failing check flags the page that fixes it: SMTP is on Access and permissions.
  expect(host.querySelector('[data-attention]')?.getAttribute('href')).toBe(
    '/settings?section=access',
  );
  expect(host.textContent).toContain('Inkadra 1.2.3 · Studio');
  // Diagnostics left the footer (0124): Server status shows the same checks.
  expect(host.querySelector('a[href="/diagnostics"]')).toBeNull();
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
  expect(host.querySelectorAll('.settings-nav__item')).toHaveLength(7);
  expect(host.querySelector('a[href="/settings?section=classifications"]')).toBeNull();
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('admin.account');
});

it('narrows the pages to those matching the search', async () => {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsNav setup={setup} />
      </MemoryRouter>,
    ),
  );
  const input = host.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error('Search field missing');
  const type = (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  // The keys stand in for translations here: "pages.reports" matches one title.
  await type('PAGES.REPORTS');
  expect([...host.querySelectorAll('.settings-nav__item')].map((a) => a.textContent)).toEqual([
    'settingsUi.pages.reports',
  ]);
  expect(host.querySelectorAll('.settings-nav__group h3')).toHaveLength(1);
  // A setting on a page finds the page and is named next to it (keys stand in here too).
  await type('keywords.preferences');
  expect([...host.querySelectorAll('.settings-nav__item')].map((a) => a.textContent)).toEqual([
    'settingsUi.pages.appearancesettingsUi.keywords.preferences',
  ]);
  expect(host.querySelector('.settings-nav__match')?.textContent).toBe(
    'settingsUi.keywords.preferences',
  );
  await type('nothing like this');
  expect(host.querySelectorAll('.settings-nav__item')).toHaveLength(0);
  expect(host.querySelector('.settings-nav__empty')?.textContent).toBe('settingsUi.noResults');
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
  expect(host.querySelector('.settings__lead')?.textContent).toBe('settingsUi.leads.preferences');
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

it('flags the page that fixes each failing check, the one Configure in General opens', () => {
  const failing = (id: string) => ({ checks: [{ id, ok: false }], error: false });
  const flagged = (setup: Parameters<typeof setupAttention>[0]) =>
    ['access', 'workspace', 'server', 'instance'].filter((page) => setupAttention(setup, page));
  expect(flagged(failing('smtp'))).toEqual(['access']);
  expect(flagged(failing('providers'))).toEqual(['access']);
  expect(flagged(failing('storage'))).toEqual(['workspace']);
  expect(flagged(failing('domain'))).toEqual(['server']);
  for (const id of ['smtp', 'providers', 'storage', 'domain'])
    expect(flagged(failing(id))).toEqual([CHECK_PAGES[id]]);
  // Checks that could not be read: General, which shows that error, is flagged instead.
  expect(flagged({ checks: null, error: true })).toEqual(['instance']);
  expect(flagged({ checks: [{ id: 'smtp', ok: true }], error: false })).toEqual([]);
});
