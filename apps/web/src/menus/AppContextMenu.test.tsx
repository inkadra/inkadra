// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AppContextMenu } from './AppContextMenu.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('defers to nested menus, dispatches keyboard invocation locally, and restores focus', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const local = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  try {
    await act(async () =>
      root.render(
        <AppContextMenu>
          <button type="button" onContextMenu={local}>
            Local
          </button>
          <input defaultValue="Some text" />
          <dialog open aria-label="Example">
            <svg aria-hidden="true">
              <path d="M0 0h10v10z" />
            </svg>
          </dialog>
        </AppContextMenu>,
      ),
    );
    const button = host.querySelector('button');
    const input = host.querySelector('input');
    button?.focus();
    await act(async () =>
      button?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'F10',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(local).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    input?.focus();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 9999,
      clientY: 9999,
    });
    await act(async () => input?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.textContent).toContain('context.selectAll');
    expect(menu?.textContent).toContain('context.editHint');
    expect(menu?.textContent).not.toContain('context.copy');
    expect(Number.parseFloat(menu?.style.left ?? '')).toBeLessThan(window.innerWidth);
    await act(async () =>
      menu?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () =>
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }),
      ),
    );
    await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click());
    expect(input?.selectionEnd).toBe(9);
    await act(async () =>
      input?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    );
    await act(async () =>
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const iconEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    await act(async () => host.querySelector('path')?.dispatchEvent(iconEvent));
    expect(iconEvent.defaultPrevented).toBe(true);
    expect(host.querySelector('dialog [role="menu"]')).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('copies only selected non-password text and reports clipboard rejection', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AppContextMenu>
          <input defaultValue="Selected text" />
          <input type="password" defaultValue="private" />
        </AppContextMenu>,
      ),
    );
    const fields = host.querySelectorAll('input');
    const input = fields[0];
    const password = fields[1];
    input?.setSelectionRange(0, 8);
    await act(async () =>
      input?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    );
    const copy = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (b) => b.textContent === 'context.copy',
    );
    expect(copy).toBeDefined();
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith('Selected');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('context.copyFailed');
    password?.setSelectionRange(0, 7);
    await act(async () =>
      password?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    );
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].some(
        (b) => b.textContent === 'context.copy',
      ),
    ).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
