// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ShotField, TokenField } from './fields.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const session = vi.hoisted(() => ({ admin: false }));
vi.mock('../../lib/session-context.ts', () => ({ useIsAdmin: () => session.admin }));
vi.mock('../../lib/api.ts', async () => {
  const { DEFAULT_CLASSIFICATIONS } = await import('@inkadra/shared');
  return {
    api: {
      get: vi.fn(async () => DEFAULT_CLASSIFICATIONS),
      put: vi.fn(async (_: string, body: unknown) => body),
    },
  };
});
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

it('adds a shot value typed by an administrator, and only keeps the text for a member', async () => {
  for (const admin of [true, false]) {
    session.admin = admin;
    const onCommit = vi.fn();
    const { host } = await mount(
      <ShotField
        label="Campo"
        value="Controluce"
        catalog="shotSizes"
        readOnly={false}
        onCommit={onCommit}
      />,
    );
    const input = host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      type(input, 'Totale largo');
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onCommit.mock.calls[0]).toEqual(['Totale largo']);
    if (admin) expect(onCommit.mock.calls[1]?.[0]).toMatch(/^[0-9a-f-]{36}$/);
    else expect(onCommit).toHaveBeenCalledTimes(1);
  }
  session.admin = false;
});
