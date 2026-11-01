// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('steps with the arrow keys, picks a board colour and closes on Escape', async () => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const render = (hex: string) =>
    root.render(
      <ColorPicker
        id="c1"
        hex={hex}
        used={['#FF0000', '#2C3A2A']}
        onChange={onChange}
        onClose={onClose}
      />,
    );
  await act(async () => render('#FF0000'));
  const [square, hue] = [...host.querySelectorAll<HTMLElement>('[role="slider"]')];
  expect(document.activeElement).toBe(square);
  const key = (el: HTMLElement | undefined, k: string, shiftKey = false) =>
    act(async () => {
      el?.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
    });
  // Value down 10%: #FF0000 → #E60000.
  await key(square, 'ArrowDown', true);
  expect(onChange).toHaveBeenLastCalledWith('#E60000');
  await act(async () => render('#E60000'));
  // Hue +10°: towards orange, at the same saturation and value.
  await key(hue, 'ArrowRight', true);
  expect(onChange).toHaveBeenLastCalledWith('#E62600');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="board.color.red"]')?.value).toBe(
    '230',
  );
  const used = host.querySelector<HTMLButtonElement>('button[aria-label="board.color.use"]');
  expect(used?.getAttribute('aria-pressed')).toBe('false');
  await act(async () => used?.click());
  expect(onChange).toHaveBeenLastCalledWith('#FF0000');
  await key(square, 'Escape');
  expect(onClose).toHaveBeenCalledOnce();
});
