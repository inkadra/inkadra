// @vitest-environment happy-dom
import { Menu } from '@inkadra/ui';
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let chosen: ReturnType<typeof vi.fn>;
let below: ReturnType<typeof vi.fn>;

function Harness() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const item = (label: string, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className="ink-menu__item"
      disabled={disabled}
      onClick={() => {
        chosen(label);
        setOpen(false);
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Actions
      </button>
      <p data-testid="below">Below</p>
      {open && (
        <Menu label="Actions" anchor={button} onClose={() => setOpen(false)}>
          {item('Rename')}
          {item('Archive', true)}
          {item('Duplicate')}
          <hr />
          {item('Delete')}
        </Menu>
      )}
    </>
  );
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chosen = vi.fn();
  below = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  document.addEventListener('keydown', below);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  document.removeEventListener('keydown', below);
  act(() => root.unmount());
  host.remove();
});

const trigger = () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
const menu = () => host.querySelector<HTMLElement>('[role="menu"]');
const focused = () => document.activeElement?.textContent;
async function open() {
  await act(async () => trigger().click());
}
async function key(key: string) {
  await act(async () =>
    (document.activeElement ?? menu())?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    ),
  );
}

it('opens on its first item and walks the items with the arrows, Home and End', async () => {
  await open();
  expect(menu()?.getAttribute('aria-label')).toBe('Actions');
  expect(focused()).toBe('Rename');
  // The disabled item is skipped.
  await key('ArrowDown');
  expect(focused()).toBe('Duplicate');
  await key('ArrowDown');
  expect(focused()).toBe('Delete');
  await key('ArrowDown');
  expect(focused()).toBe('Rename');
  await key('ArrowUp');
  expect(focused()).toBe('Delete');
  await key('Home');
  expect(focused()).toBe('Rename');
  await key('End');
  expect(focused()).toBe('Delete');
  await key('d');
  expect(focused()).toBe('Duplicate');
  // The keys the menu takes never reach the page underneath.
  expect(below).not.toHaveBeenCalled();
});

it('runs an item with Enter', async () => {
  await open();
  await key('ArrowDown');
  // A button's Enter is its click.
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(chosen).toHaveBeenCalledWith('Duplicate');
  expect(menu()).toBeNull();
});

it('closes on Escape and gives the focus back to its button', async () => {
  await open();
  await key('Escape');
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  expect(below).not.toHaveBeenCalled();
});

it('closes on a press outside, which goes no further', async () => {
  await open();
  const clicked = vi.fn();
  const outside = host.querySelector<HTMLElement>('[data-testid="below"]')!;
  outside.addEventListener('pointerdown', clicked);
  await act(async () =>
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })),
  );
  expect(menu()).toBeNull();
  expect(clicked).not.toHaveBeenCalled();
  expect(chosen).not.toHaveBeenCalled();
});

it('leaves a press on its own button to the button', async () => {
  await open();
  await act(async () =>
    trigger().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })),
  );
  expect(menu()).not.toBeNull();
  await act(async () => trigger().click());
  expect(menu()).toBeNull();
});
