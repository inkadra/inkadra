// @vitest-environment happy-dom
import { Menu } from '@inkadra/ui';
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, type Mock, vi } from 'vitest';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let chosen: Mock<(label: string) => void>;
let below: Mock<(event: Event) => void>;

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
  // The keys the menu takes never reach the page underneath; one it has no use for does.
  expect(below).not.toHaveBeenCalled();
  await key('3');
  expect(focused()).toBe('Duplicate');
  expect(below).toHaveBeenCalledOnce();
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

const tabbable = () =>
  [...(menu()?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])]
    .filter((item) => item.tabIndex === 0)
    .map((item) => item.textContent);

it('keeps only the focused item in the Tab order, and Tab leaves in one press', async () => {
  await open();
  expect(tabbable()).toEqual(['Rename']);
  await key('ArrowDown');
  expect(tabbable()).toEqual(['Duplicate']);
  await key('Tab');
  expect(menu()).toBeNull();
  // Back on the button: the Tab itself then goes on from there.
  expect(document.activeElement).toBe(trigger());
});

it('retries a letter alone after a search that found nothing', async () => {
  await open();
  await key('x');
  expect(focused()).toBe('Rename');
  // Not "xd": the d alone.
  await key('d');
  expect(focused()).toBe('Duplicate');
});

function render(node: React.ReactNode) {
  return act(async () => root.render(node));
}
const cell = (label: string) => (
  <button key={label} type="button" role="menuitemradio" aria-checked={false} aria-label={label} />
);

it('walks a row of items with Left and Right without leaving it', async () => {
  await render(
    <Menu label="Colours" onClose={() => {}}>
      <button type="button" role="menuitem">
        Rename
      </button>
      {/* biome-ignore lint/a11y/useSemanticElements: as the project menu's swatch row. */}
      <div role="group" aria-label="Colour">
        {cell('Blue')}
        {cell('Teal')}
        {cell('Green')}
      </div>
      <fieldset>
        {cell('S')}
        {cell('M')}
      </fieldset>
    </Menu>,
  );
  const label = () => document.activeElement?.getAttribute('aria-label');
  await key('ArrowDown');
  expect(label()).toBe('Blue');
  await key('ArrowLeft');
  expect(label()).toBe('Green');
  await key('ArrowRight');
  expect(label()).toBe('Blue');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('ArrowDown');
  expect(label()).toBe('S');
  await key('ArrowLeft');
  expect(label()).toBe('M');
  await key('ArrowRight');
  expect(label()).toBe('S');
});

it('puts the focus inside the menu when every item is unavailable', async () => {
  await render(
    <Menu label="Views" onClose={() => {}}>
      <button type="button" role="menuitem" aria-disabled="true">
        Board
      </button>
    </Menu>,
  );
  expect(focused()).toBe('Board');
  await render(<Menu key="empty" label="Empty" onClose={() => {}} />);
  expect(document.activeElement).toBe(menu());
});

it('moves the focus and the one tab stop on when the focused item goes away', async () => {
  const levels = (shown: string[], off: string[] = []) => (
    <Menu label="Quality" onClose={() => {}}>
      {shown.map((level) => (
        <button
          key={level}
          type="button"
          role="menuitemradio"
          aria-checked={false}
          disabled={off.includes(level)}
        >
          {level}
        </button>
      ))}
    </Menu>
  );
  const stops = () =>
    [...(menu()?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
      .filter((item) => item.tabIndex === 0)
      .map((item) => item.textContent);
  await render(levels(['Auto', '720p', '480p']));
  await key('ArrowDown');
  expect(focused()).toBe('720p');
  // Removed while it had the focus.
  await render(levels(['Auto', '480p']));
  expect(focused()).toBe('Auto');
  expect(stops()).toEqual(['Auto']);
  await key('ArrowDown');
  expect(focused()).toBe('480p');
  // Disabled while it had the focus (its copy failed).
  await render(levels(['Auto', '480p'], ['480p']));
  expect(focused()).toBe('Auto');
  expect(stops()).toEqual(['Auto']);
});
