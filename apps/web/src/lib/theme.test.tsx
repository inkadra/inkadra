// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTheme } from './theme.ts';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let theme: ReturnType<typeof useTheme>;
let rail: ReturnType<typeof useTheme>;
const mq = new EventTarget() as EventTarget & { matches: boolean };
function Harness() {
  theme = useTheme();
  rail = useTheme();
  return (
    <span>
      {theme.preference}:{theme.theme}:{rail.theme}
    </span>
  );
}
beforeEach(() => {
  localStorage.clear();
  mq.matches = false;
  vi.stubGlobal('matchMedia', () => mq);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('follows live system changes and synchronizes explicit choices with the rail', async () => {
  await act(async () => root.render(<Harness />));
  expect(host.textContent).toBe('system:dark:dark');
  await act(async () => {
    mq.matches = true;
    mq.dispatchEvent(new Event('change'));
  });
  expect(host.textContent).toBe('system:light:light');
  await act(async () => theme.choose('dark'));
  expect(host.textContent).toBe('dark:dark:dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  await act(async () => {
    mq.matches = false;
    mq.dispatchEvent(new Event('change'));
  });
  await act(async () => {
    mq.matches = true;
    mq.dispatchEvent(new Event('change'));
  });
  expect(theme.theme).toBe('dark');
  await act(async () => theme.choose('system'));
  expect(host.textContent).toBe('system:light:light');
  expect(localStorage.getItem('inkadra.theme')).toBe('system');
  await act(async () => rail.toggle());
  expect(host.textContent).toBe('dark:dark:dark');
});
it('restores a previous explicit preference', async () => {
  localStorage.setItem('inkadra.theme', 'light');
  await act(async () => root.render(<Harness />));
  expect(theme.preference).toBe('light');
  expect(document.documentElement.dataset.theme).toBe('light');
});
