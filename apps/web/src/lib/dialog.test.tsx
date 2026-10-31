// @vitest-environment happy-dom
import { Dialog, DialogActions, type DialogHandle, swallowOutsidePress } from '@inkadra/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const disposals: Array<() => void> = [];
beforeEach(() => {
  // happy-dom has neither the native modal API nor layout: the dialog is 100 x 100 at (50, 50).
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 50,
    top: 50,
    right: 150,
    bottom: 150,
    width: 100,
    height: 100,
    x: 50,
    y: 50,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});

async function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const press = (el: Element, x: number, y: number) =>
  act(() => {
    el.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }),
    );
  });
const click = (el: Element, x: number, y: number) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  });

async function dialogWith(
  onClose: () => void,
  onCancel?: (e: React.SyntheticEvent) => void,
  {
    actions,
    ...extra
  }: {
    dirty?: boolean;
    ref?: React.RefObject<DialogHandle | null>;
    actions?: boolean;
  } = {},
) {
  const host = await mount(
    <Dialog open title="Title" onClose={onClose} onCancel={onCancel} {...extra}>
      <button type="button">Inside</button>
      {actions && (
        <DialogActions>
          <button type="button">Import</button>
        </DialogActions>
      )}
    </Dialog>,
  );
  return host.querySelector('dialog') as HTMLDialogElement;
}

const confirm = (dialog: HTMLDialogElement) =>
  dialog.querySelector<HTMLElement>('.ink-dialog__confirm');
const answer = (dialog: HTMLDialogElement, label: string) =>
  [...dialog.querySelectorAll('.ink-dialog__confirm button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
const pressEscape = (el: Element) =>
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });

it('closes on a click on the backdrop, like Escape', async () => {
  const onClose = vi.fn();
  const dialog = await dialogWith(onClose);
  await press(dialog, 10, 10);
  await click(dialog, 10, 10);
  expect(dialog.open).toBe(false);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('stays open when onCancel keeps it open', async () => {
  const onClose = vi.fn();
  const onCancel = vi.fn((e: React.SyntheticEvent) => e.preventDefault());
  const dialog = await dialogWith(onClose, onCancel);
  await press(dialog, 10, 10);
  await click(dialog, 10, 10);
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(dialog.open).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

it('ignores clicks on its own content, padding and keyboard clicks', async () => {
  const onClose = vi.fn();
  const dialog = await dialogWith(onClose);
  const inside = dialog.querySelector('button') as HTMLButtonElement;
  await press(inside, 100, 100);
  await click(inside, 100, 100);
  // The padding is the dialog itself, inside its box.
  await press(dialog, 100, 100);
  await click(dialog, 100, 100);
  // A press that started on the content and ended on the backdrop (selecting text).
  await press(inside, 100, 100);
  await click(dialog, 10, 10);
  // A click with no press, as the keyboard makes.
  await click(dialog, 0, 0);
  expect(dialog.open).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

it('lets an outside press on empty space close a menu without reaching what is below', async () => {
  const board = document.createElement('div');
  const control = document.createElement('button');
  document.body.append(board, control);
  const seen = vi.fn();
  const menuClosed = vi.fn();
  board.addEventListener('pointerdown', seen);
  board.addEventListener('click', seen);
  control.addEventListener('pointerdown', seen);
  const away = (e: Event) => {
    swallowOutsidePress(e);
    menuClosed();
  };
  document.addEventListener('pointerdown', away, true);
  disposals.push(() => {
    document.removeEventListener('pointerdown', away, true);
    board.remove();
    control.remove();
  });

  board.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  board.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  board.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(menuClosed).toHaveBeenCalledTimes(1);
  expect(seen).not.toHaveBeenCalled();

  // The click is only held back once: the next one is the board's again.
  board.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(seen).toHaveBeenCalledTimes(1);

  // A press on a control still goes through.
  control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  expect(menuClosed).toHaveBeenCalledTimes(2);
  expect(seen).toHaveBeenCalledTimes(2);
});

it('asks before closing a dirty dialog from the backdrop, and Keep editing stays', async () => {
  const onClose = vi.fn();
  const dialog = await dialogWith(onClose, undefined, { dirty: true });
  await press(dialog, 10, 10);
  await click(dialog, 10, 10);
  expect(confirm(dialog)?.textContent).toContain('Discard changes?');
  expect(dialog.open).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(answer(dialog, 'Keep editing'));
  await act(async () => answer(dialog, 'Keep editing').click());
  expect(confirm(dialog)).toBeNull();
  expect(dialog.open).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

it('closes a dirty dialog once Discard is chosen', async () => {
  const onClose = vi.fn();
  const dialog = await dialogWith(onClose, undefined, { dirty: true });
  await press(dialog, 10, 10);
  await click(dialog, 10, 10);
  await act(async () => answer(dialog, 'Discard').click());
  expect(dialog.open).toBe(false);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('asks on Escape and on requestClose, and Escape on the question keeps editing', async () => {
  const onClose = vi.fn();
  const handle = { current: null } as React.RefObject<DialogHandle | null>;
  const dialog = await dialogWith(onClose, undefined, { dirty: true, ref: handle });
  await pressEscape(dialog.querySelector('button') as Element);
  expect(confirm(dialog)).not.toBeNull();
  await pressEscape(answer(dialog, 'Keep editing'));
  expect(confirm(dialog)).toBeNull();
  expect(dialog.open).toBe(true);
  // The Cancel and close buttons of the dialog's own content go through the handle.
  await act(async () => handle.current?.requestClose());
  expect(confirm(dialog)).not.toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

it('closes at once when nothing is dirty, and does not ask when onCancel holds it', async () => {
  const onClose = vi.fn();
  const handle = { current: null } as React.RefObject<DialogHandle | null>;
  const clean = await dialogWith(onClose, undefined, { ref: handle });
  await act(async () => handle.current?.requestClose());
  expect(confirm(clean)).toBeNull();
  expect(clean.open).toBe(false);
  expect(onClose).toHaveBeenCalledTimes(1);

  const held = await dialogWith(vi.fn(), (e) => e.preventDefault(), { dirty: true });
  await press(held, 10, 10);
  await click(held, 10, 10);
  expect(confirm(held)).toBeNull();
  expect(held.open).toBe(true);
});

it('puts the question in the place of the action row, and brings the row back', async () => {
  const dialog = await dialogWith(vi.fn(), undefined, { dirty: true, actions: true });
  await press(dialog, 10, 10);
  await click(dialog, 10, 10);
  const row = dialog.querySelector('.ink-dialog__actions') as HTMLElement;
  // One question, inside the row (no bar of its own), over the row's own buttons.
  expect(dialog.querySelectorAll('.ink-dialog__confirm')).toHaveLength(1);
  expect(confirm(dialog)?.parentElement).toBe(row);
  expect(row.classList.contains('is-confirming')).toBe(true);
  expect(row.textContent).toContain('Import');
  await act(async () => answer(dialog, 'Keep editing').click());
  expect(confirm(dialog)).toBeNull();
  expect(row.classList.contains('is-confirming')).toBe(false);
});
