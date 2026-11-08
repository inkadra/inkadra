// @vitest-environment happy-dom
import { DEFAULT_USER_PREFERENCES, type InstanceUpdates } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { resetUpdates } from '../lib/updates.ts';
import { UpdatePopup } from './UpdatePopup.tsx';

const prefs = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('../lib/session.tsx', () => ({ useSession: () => ({ user: { role: 'admin' } }) }));
vi.mock('../lib/api.ts', async (load) => ({
  ...(await load<typeof import('../lib/api.ts')>()),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
vi.mock('../lib/preferences.ts', () => ({
  usePreferences: () => prefs.value,
  getPreferences: () => prefs.value,
  preferencesLoaded: () => true,
  updatePreferences: vi.fn(async (patch: Record<string, unknown>) => {
    prefs.value = { ...prefs.value, ...patch };
  }),
}));

const updates: InstanceUpdates = {
  current: '0.8.0',
  edge: false,
  checkEnabled: true,
  channel: 'preview',
  checkedAt: '2026-11-07T14:10:00.000Z',
  failed: false,
  available: {
    version: '0.9.0-rc.1',
    publishedAt: '2026-11-06T10:00:00.000Z',
    prerelease: true,
    url: 'https://github.com/inkadra/inkadra/releases/tag/v0.9.0-rc.1',
    highlights: ['One', 'Two', 'Three', 'Four', 'Five'],
    beforeUpdating: ['Read me'],
  },
  earlier: [],
};

const host = document.createElement('div');
let root = createRoot(host);
beforeEach(() => {
  // As a page asking for it under automation (happy-dom says it is driven by a test).
  localStorage.setItem('inkadra.updates', 'on');
  prefs.value = { ...DEFAULT_USER_PREFERENCES };
  vi.mocked(api.get).mockResolvedValue(updates);
});
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  resetUpdates();
  vi.clearAllMocks();
});

const render = (path = '/') =>
  act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <UpdatePopup />
      </MemoryRouter>,
    ),
  );

it('tells an administrator about a new version once, and skipping it remembers the version', async () => {
  await render();
  const dialog = host.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain('updates.popupTitle:{"version":"0.9.0-rc.1"}');
  expect(dialog?.querySelectorAll('li')).toHaveLength(4);
  expect(dialog?.textContent).toContain('updates.toRead:{"count":1}');
  const skip = [...host.querySelectorAll('button')].find((b) => b.textContent === 'updates.skip');
  await act(async () => skip?.click());
  expect(prefs.value).toMatchObject({ updateSeen: '0.9.0-rc.1', updateSkipped: '0.9.0-rc.1' });
  await render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('stays away from a version already seen and from the Updates page itself', async () => {
  prefs.value = { ...prefs.value, updateSeen: '0.9.0-rc.1' };
  await render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  prefs.value = { ...DEFAULT_USER_PREFERENCES };
  // A new router: MemoryRouter reads its first address once.
  act(() => root.unmount());
  root = createRoot(host);
  await render('/settings?section=updates');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('closes on Escape with focus anywhere, unless a menu or a field takes that Escape', async () => {
  await render();
  const escape = (target: EventTarget = document.body) =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
  const menu = document.body.appendChild(document.createElement('div'));
  menu.setAttribute('role', 'menu');
  await escape();
  menu.remove();
  const field = document.body.appendChild(document.createElement('input'));
  await escape(field);
  field.remove();
  expect(prefs.value.updateSeen).not.toBe('0.9.0-rc.1');
  await escape();
  expect(prefs.value).toMatchObject({ updateSeen: '0.9.0-rc.1' });
});
