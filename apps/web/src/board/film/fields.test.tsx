// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AutoTime, TokenField } from './fields.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, rerender: (next: React.ReactNode) => act(async () => root.render(next)) };
}
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('adds chips on Enter and comma without duplicates, and removes them', async () => {
  const onChange = vi.fn();
  const { host } = await mount(
    <TokenField values={['Elena']} removeLabel={(v) => `remove ${v}`} onChange={onChange} />,
  );
  const input = host.querySelector('input') as HTMLInputElement;
  await act(async () => type(input, 'marco, elena,'));
  expect(onChange).toHaveBeenLastCalledWith(['Elena', 'marco']);
  await act(async () => type(input, 'Anna'));
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  expect(onChange).toHaveBeenLastCalledWith(['Elena', 'Anna']);
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })),
  );
  expect(onChange).toHaveBeenLastCalledWith([]);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="remove Elena"]')?.click(),
  );
  expect(onChange).toHaveBeenLastCalledWith([]);
});

it('shows the computed time until a time is set, then a time input', async () => {
  const onChange = vi.fn();
  const view = (value: string | null) => (
    <AutoTime id="wrap" value={value} computed="00:20 (+1)" autoLabel="auto" onChange={onChange} />
  );
  const { host, rerender } = await mount(view(null));
  const button = host.querySelector('button');
  expect(button?.textContent).toBe('00:20 (+1)auto');
  expect(host.querySelector('input')).toBeNull();
  await act(async () => button?.click());
  expect(host.querySelector('input[type=time]')).not.toBeNull();
  await rerender(view('23:30'));
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('23:30');
});
