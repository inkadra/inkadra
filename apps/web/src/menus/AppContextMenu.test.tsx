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
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
