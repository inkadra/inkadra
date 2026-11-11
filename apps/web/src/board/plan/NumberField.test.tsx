// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NumberField } from './NumberField.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));

it('steps with the arrows, within its limits', async () => {
  const commit = vi.fn();
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <NumberField
        value={3.95}
        min={1}
        max={4}
        step={0.01}
        nudge={0.1}
        label="L"
        onCommit={commit}
      />,
    ),
  );
  const input = host.querySelector('input') as HTMLInputElement;
  const press = (key: string) =>
    act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
  await press('ArrowDown');
  expect(commit).toHaveBeenLastCalledWith(3.85);
  await press('ArrowUp');
  await press('ArrowUp');
  expect(commit).toHaveBeenLastCalledWith(4);
  await act(async () => root.unmount());
});

async function field(value: number, min: number, max: number) {
  const commit = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<NumberField value={value} min={min} max={max} label="L" onCommit={commit} />),
  );
  const input = host.querySelector('input') as HTMLInputElement;
  const type = (text: string) =>
    act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const enter = () =>
    act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
  const blur = () => act(async () => input.blur());
  const done = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { commit, input, type, enter, blur, done };
}

it('writes a typed value on Enter and on blur, the decimal comma included', async () => {
  const f = await field(40, 0, 100);
  await f.type('55');
  await f.enter();
  expect(f.commit).toHaveBeenLastCalledWith(55);
  await f.type('62,5');
  await f.blur();
  expect(f.commit).toHaveBeenLastCalledWith(62.5);
  await f.done();
});

it.each([
  ['an empty field', ''],
  ['text without digits', 'abc'],
  ['a lone minus', '-'],
  ['a value over the limit', '101'],
  ['a value under the limit', '-1'],
])('goes back to the value for %s, even where 0 is allowed', async (_, text) => {
  const f = await field(40, 0, 100);
  await f.type(text);
  await f.enter();
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.input.value).toBe('40');
  await f.type(text);
  await f.blur();
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.input.value).toBe('40');
  await f.done();
});

it('still takes a typed 0 when it is in range', async () => {
  const f = await field(40, 0, 100);
  await f.type('0');
  await f.enter();
  expect(f.commit).toHaveBeenLastCalledWith(0);
  await f.done();
});
