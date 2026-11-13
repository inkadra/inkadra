// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { forgetSettingsData, SettingsSearch } from './SettingsSearch.tsx';

const session = vi.hoisted(() => ({
  user: { id: 'me', role: 'admin' },
  instance: { demo: false },
}));
const people = vi.hoisted(() => ({
  members: [{ id: 'u1', name: 'Antonino', email: 'a@example.com', role: 'member' }],
}));
const get = vi.hoisted(() =>
  vi.fn(async (path: string) => {
    if (path === '/instance/members') return { items: people.members };
    if (path === '/invitations') return { items: [] };
    if (path === '/feedback/reports') return { items: [] };
    if (path === '/instance/storage')
      return {
        originalBytes: 5000,
        byProject: [],
        byType: [],
        byUser: [{ userId: 'u1', name: 'Antonino', bytes: 5000 }],
      };
    return null;
  }),
);
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('../lib/api.ts', () => ({ api: { get } }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, i18n: { languages: ['en'], language: 'en' } }) };
});

function Where() {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}
const host = document.createElement('div');
document.body.append(host);
let root = createRoot(host);
const ANTONINO = people.members;
afterEach(async () => {
  session.user.role = 'admin';
  people.members = ANTONINO;
  get.mockClear();
  forgetSettingsData();
  await act(async () => root.unmount());
  root = createRoot(host);
});

async function render() {
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings?section=account']}>
        <SettingsSearch onClose={onClose}>
          <p data-pages>pages</p>
        </SettingsSearch>
        <Where />
      </MemoryRouter>,
    ),
  );
  const input = host.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!input) throw new Error('Search field missing');
  const type = (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Past the debounce and the loading of the data.
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  const press = (key: string) =>
    act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  const options = () =>
    [...host.querySelectorAll('[role="option"]')].map(
      (o) => o.querySelector('.settings-find__label')?.textContent,
    );
  return { input, type, press, options, onClose };
}

it('is a combobox: arrows move, Enter opens the row, Escape clears then closes', async () => {
  const { input, type, press, options, onClose } = await render();
  expect(host.querySelector('[data-pages]')).not.toBeNull();
  expect(input.getAttribute('aria-expanded')).toBe('false');
  // The keys stand in for translations: "admin.theme" is the theme row.
  await type('admin.theme');
  expect(host.querySelector('[data-pages]')).toBeNull();
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(options()).toEqual(['admin.theme']);
  const listbox = host.querySelector('[role="listbox"]');
  expect(input.getAttribute('aria-controls')).toBe(listbox?.id);
  const first = host.querySelector('[role="option"]');
  expect(input.getAttribute('aria-activedescendant')).toBe(first?.id);
  expect(first?.getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('mark')?.textContent).toBe('admin.theme');
  expect(host.querySelector('.settings-find__keys')).not.toBeNull();
  await press('Enter');
  expect(host.querySelector('output')?.textContent).toBe(
    '/settings?section=preferences&setting=preferences.theme',
  );
  // Several results: the arrows move the active one, and stop at the ends.
  await type('settingsUi.preferences');
  const count = options().length;
  expect(count).toBeGreaterThan(2);
  await press('ArrowDown');
  await press('ArrowDown');
  await press('ArrowUp');
  const selected = () => host.querySelector('[aria-selected="true"]')?.id;
  expect(selected()).toBe(host.querySelectorAll('[role="option"]')[1]?.id);
  expect(input.getAttribute('aria-activedescendant')).toBe(selected());
  await press('Escape');
  expect(input.value).toBe('');
  expect(host.querySelector('[data-pages]')).not.toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  await press('Escape');
  expect(onClose).toHaveBeenCalledOnce();
  await type('nothing like this');
  expect(host.querySelector('[role="status"]')?.textContent).toBe('settingsUi.noResults');
});

it('finds people for administrators, loading the data once', async () => {
  const { type, options } = await render();
  await type('anto');
  // The person, then the space they use (#708), which opens Storage on their row.
  expect(options()).toEqual(['Antonino', 'settingsUi.find.usage']);
  expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    'settingsUi.find.people',
  );
  expect(get.mock.calls.map(([path]) => path).sort()).toEqual([
    '/feedback/reports',
    '/instance/classifications',
    '/instance/members',
    '/instance/storage',
    '/invitations',
  ]);
  await type('antonin');
  expect(get).toHaveBeenCalledTimes(5);
  // A new text never shows, nor opens with Enter, a result of the text before it: the data
  // is matched at once, only its loading waits for the typing to stop.
  const input = host.querySelector<HTMLInputElement>('input[role="combobox"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      'antonino zzz',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(options()).toEqual([]);
});

it('says how many more a capped group leaves out, as the group description (#709)', async () => {
  people.members = Array.from({ length: 11 }, (_, i) => ({
    id: `u${i}`,
    name: `Anna ${i}`,
    email: `anna${i}@example.com`,
    role: 'member',
  }));
  const { type, options } = await render();
  await type('anna');
  expect(options()).toHaveLength(8);
  const group = host.querySelector('[role="group"]');
  const more = host.querySelector('.settings-find__more');
  expect(more?.textContent).toBe('settingsUi.find.more');
  expect(group?.getAttribute('aria-describedby')).toBe(more?.id);
  // Typing more narrows it: no count when everything fits.
  await type('anna 1');
  expect(host.querySelector('.settings-find__more')).toBeNull();
});

it('never loads or shows admin-only data to members', async () => {
  session.user.role = 'member';
  const { type, options } = await render();
  await type('anto');
  expect(get).not.toHaveBeenCalled();
  expect(options()).toEqual([]);
  // Their own settings are still found; admin pages are not.
  await type('admin.theme');
  expect(options()).toEqual(['admin.theme']);
  await type('settingsUi.pages.reports');
  expect(options()).toEqual([]);
});
