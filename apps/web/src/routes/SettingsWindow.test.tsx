// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsWindow } from './SettingsWindow.tsx';

const session = vi.hoisted(() => ({
  user: { role: 'admin' },
  version: '1.2.3',
  instance: { name: 'Studio' },
}));
const phone = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/session.tsx', () => ({ useSession: () => session }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { languages: ['en'] } }),
}));
vi.mock('../lib/api.ts', () => ({
  api: {
    get: vi.fn(async () => ({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c', deactivatedAt: '2026-01-01T00:00:00Z' }],
    })),
  },
}));
vi.mock('./settings-ui.tsx', () => ({ useIsPhone: () => phone.value }));

const host = document.createElement('div');
document.body.append(host);
let root = createRoot(host);
afterEach(async () => {
  phone.value = false;
  await act(async () => root.unmount());
  root = createRoot(host);
});

const onClose = vi.fn();
const onBack = vi.fn();
async function render(path: string) {
  onClose.mockClear();
  onBack.mockClear();
  await act(async () =>
    root.render(
      <MemoryRouter key={path + phone.value} initialEntries={[path]}>
        <SettingsWindow setup={{ checks: null, error: false }} onClose={onClose} onBack={onBack}>
          <p data-content>content</p>
          <dialog data-nested open />
        </SettingsWindow>
      </MemoryRouter>,
    ),
  );
  const dialog = host.querySelector<HTMLDialogElement>('dialog.settings-window');
  if (!dialog) throw new Error('Window missing');
  return dialog;
}

it('frames a page with the navigation, its title and the save status', async () => {
  const dialog = await render('/settings?section=preferences');
  expect(dialog.open).toBe(true);
  expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
  expect(dialog.querySelector('h2')?.textContent).toBe('settingsUi.pages.appearance');
  // Focus starts on the heading, leaving the selected navigation item neutral.
  expect(document.activeElement?.textContent).toBe('settingsUi.pages.appearance');
  expect(document.activeElement).toBe(dialog.querySelector('h2'));
  expect(document.body.style.overflow).toBe('hidden');
  expect(dialog.querySelector('.settings-nav')).not.toBeNull();
  expect(dialog.querySelector('.settings-save')).not.toBeNull();
  expect(dialog.querySelector('[data-content]')).not.toBeNull();
  // Every page that saves itself says so (0124); only Classifications saves by hand.
  const storage = await render('/settings?section=workspace');
  expect(storage.querySelector('.settings-save')).not.toBeNull();
  const classifications = await render('/settings?section=classifications');
  expect(classifications.querySelector('.settings-save')).toBeNull();
});

it('keeps one size on Members and counts the active ones', async () => {
  const dialog = await render('/settings/team');
  expect(dialog.className).toBe('settings-window ink-motion-dialog');
  expect(dialog.querySelector('[aria-current="page"] .settings-nav__count')?.textContent).toBe('2');
});

it('closes on Escape, the close button and a backdrop click, never from inside', async () => {
  const dialog = await render('/settings');
  await act(async () => {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  // Escape in a dialog opened from settings closes that dialog only.
  await act(async () => {
    dialog
      .querySelector('[data-nested]')
      ?.dispatchEvent(new Event('cancel', { cancelable: true, bubbles: true }));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  const close = dialog.querySelector<HTMLButtonElement>('[aria-label="settingsUi.close"]');
  await act(async () => close?.click());
  expect(onClose).toHaveBeenCalledTimes(2);
  const press = (target: Element) =>
    act(async () => {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  await press(dialog.querySelector('[data-content]') as Element);
  expect(onClose).toHaveBeenCalledTimes(2);
  await press(dialog);
  expect(onClose).toHaveBeenCalledTimes(3);
});

it('stays open through a close and reopen, as in strict mode, but follows a forced close', async () => {
  const dialog = await render('/settings');
  await act(async () => {
    dialog.dispatchEvent(new Event('close'));
  });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    dialog.close();
    dialog.dispatchEvent(new Event('close'));
  });
  expect(onClose).toHaveBeenCalled();
});

it('on phones lists the pages first, then shows one page with a way back', async () => {
  phone.value = true;
  const list = await render('/settings');
  expect(list.classList.contains('settings-window--phone')).toBe(true);
  expect(list.querySelector('.settings-nav')).toBeNull();
  expect(list.querySelector('h2')?.textContent).toBe('settingsUi.profile');
  expect(list.querySelector('[aria-label="mobile.back"]')).toBeNull();
  const page = await render('/settings?section=account');
  expect(page.querySelector('h2')?.textContent).toBe('admin.account');
  await act(async () =>
    page.querySelector<HTMLButtonElement>('[aria-label="mobile.back"]')?.click(),
  );
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('restores the body scroll style on close', async () => {
  document.body.style.overflow = 'auto';
  await render('/settings');
  expect(document.body.style.overflow).toBe('hidden');
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});

it('opens a page on the row a search result names: scrolled to, highlighted and focused', async () => {
  const scrolled = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrolled;
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings?section=preferences&setting=preferences.theme']}>
        <SettingsWindow setup={{ checks: null, error: false }} onClose={onClose} onBack={onBack}>
          <div data-setting="preferences.language">
            <input aria-label="language" />
          </div>
          <div data-setting="preferences.theme">
            <button type="button">theme</button>
          </div>
        </SettingsWindow>
      </MemoryRouter>,
    ),
  );
  const row = host.querySelector<HTMLElement>('[data-setting="preferences.theme"]');
  expect(row?.classList.contains('settings-found')).toBe(true);
  expect(document.activeElement?.textContent).toBe('theme');
  expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  expect(host.querySelector('[data-setting="preferences.language"]')?.className).toBe('');
});

/** A row that appears once its page has loaded. */
function Later() {
  const [shown, show] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => show(true), 20);
    return () => clearTimeout(timer);
  }, []);
  return shown ? <p data-setting="member:u1">Antonino</p> : null;
}

it('waits for a row that the page loads later, like a member', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings/team?setting=member%3Au1']}>
        <SettingsWindow setup={{ checks: null, error: false }} onClose={onClose} onBack={onBack}>
          <Later />
        </SettingsWindow>
      </MemoryRouter>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  const row = host.querySelector<HTMLElement>('[data-setting="member:u1"]');
  expect(row?.classList.contains('settings-found')).toBe(true);
  // Nothing in it takes the focus: the row itself does.
  expect(document.activeElement).toBe(row);
});

/** A card above the row that loads after it, like Storage's limits. */
function Above() {
  const [shown, show] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => show(true), 20);
    return () => clearTimeout(timer);
  }, []);
  return shown ? <p>limits</p> : null;
}

it('keeps the row in view while cards above it load, until the person scrolls', async () => {
  const scrolled = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrolled;
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/settings?section=workspace&setting=workspace.byUser%3Au1']}>
        <SettingsWindow setup={{ checks: null, error: false }} onClose={onClose} onBack={onBack}>
          <Above />
          <p data-setting="workspace.byUser:u1">Antonino</p>
        </SettingsWindow>
      </MemoryRouter>,
    ),
  );
  const before = scrolled.mock.calls.length;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  // The card that came in above scrolled it back into view.
  expect(scrolled.mock.calls.length).toBeGreaterThan(before);
  expect(scrolled).toHaveBeenLastCalledWith({ block: 'center' });
  const settled = scrolled.mock.calls.length;
  host.querySelector('dialog')?.dispatchEvent(new Event('wheel', { bubbles: true }));
  await act(async () => {
    host.querySelector('[data-setting="workspace.byUser:u1"]')?.before(document.createElement('p'));
  });
  expect(scrolled.mock.calls.length).toBe(settled);
});
