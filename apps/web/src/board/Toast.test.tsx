// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { TOAST_MS, Toast } from './chrome.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );

it('leaves after its time, which hover and focus pause', async () => {
  const onClose = vi.fn();
  await act(async () => root.render(<Toast text="Done" onUndo={() => {}} onClose={onClose} />));
  const toast = host.querySelector('.toast') as HTMLElement;
  await act(async () => vi.advanceTimersByTime(TOAST_MS - 1000));
  await act(async () => toast.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => toast.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
  await act(async () => button('board.undo')?.focus());
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => button('board.undo')?.blur());
  // Only the second that was left.
  await act(async () => vi.advanceTimersByTime(999));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(onClose).toHaveBeenCalledOnce();
});

it('undoes in one step, and drops Undo once the history moves on', async () => {
  const doc = new Y.Doc();
  const map = doc.getMap('m');
  const history = new Y.UndoManager(map);
  map.set('a', 1);
  history.stopCapturing();
  const onUndo = vi.fn(() => history.undo());
  const onShow = vi.fn();
  const onClose = vi.fn();
  const render = () =>
    root.render(
      <Toast text="Added" ok onShow={onShow} onUndo={onUndo} history={history} onClose={onClose} />,
    );
  await act(async () => render());
  await act(async () => button('board.show')?.click());
  expect(onShow).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => button('board.undo')?.click());
  expect(onUndo).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(map.get('a')).toBeUndefined();

  await act(async () => root.render(<div />));
  await act(async () => render());
  expect(button('board.undo')).toBeDefined();
  // Another edit: Undo would take back that one instead, so only ⌘Z is left.
  await act(async () => map.set('b', 2));
  expect(button('board.undo')).toBeUndefined();
  expect(button('board.show')).toBeDefined();
  expect(button('board.toastClose')).toBeDefined();
});
