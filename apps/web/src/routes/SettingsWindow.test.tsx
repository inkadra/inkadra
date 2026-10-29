// @vitest-environment happy-dom
import { act } from 'react';
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
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
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
  expect(dialog.querySelector('h2')?.textContent).toBe('admin.preferences');
  // Focus starts on the heading, leaving the selected navigation item neutral.
  expect(document.activeElement?.textContent).toBe('admin.preferences');
  expect(document.activeElement).toBe(dialog.querySelector('h2'));
  expect(document.body.style.overflow).toBe('hidden');
  expect(dialog.querySelector('.settings-nav')).not.toBeNull();
  expect(dialog.querySelector('.settings-save')).not.toBeNull();
  expect(dialog.querySelector('[data-content]')).not.toBeNull();
  expect(dialog.classList.contains('settings-window--wide')).toBe(false);
  // Read-only pages have nothing to save.
  const storage = await render('/settings?section=workspace');
  expect(storage.querySelector('.settings-save')).toBeNull();
});

it('widens for Members and counts the active ones', async () => {
  const dialog = await render('/settings/team');
  expect(dialog.classList.contains('settings-window--wide')).toBe(true);
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
  expect(page.classList.contains('settings-window--wide')).toBe(false);
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
