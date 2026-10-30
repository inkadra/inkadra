// @vitest-environment happy-dom
import { Select } from '@inkadra/ui';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let escaped: () => void;
function Harness() {
  const [value, setValue] = useState('a');
  return (
    <dialog open onCancel={escaped}><form
      onKeyDown={(event) => {
        if (event.key === 'Escape') escaped();
      }}
    >
      <label htmlFor="choice">Choice<Select id="choice"
        name="choice"
        aria-label="Choice"
        value={value}
        onChange={setValue}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta', disabled: true },
          { value: 'c', label: 'Charlie' },
        ]}
      /></label>
    </form></dialog>
  );
}
beforeEach(async () => {
  escaped = vi.fn();
  HTMLElement.prototype.showPopover = vi.fn();
  HTMLElement.prototype.hidePopover = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function key(key: string) {
  await act(async () =>
    (host.querySelector('[role="listbox"]') ?? host.querySelector('button'))?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    ),
  );
}
it('opens with keyboard, skips disabled options, selects and submits the controlled value', async () => {
  await key('ArrowDown');
  await key('ArrowDown');
  await key('Enter');
  const form = host.querySelector('form')!;
  const submitted = vi.fn((event: Event) => { event.preventDefault(); return new FormData(form).get('choice'); });
  form.addEventListener('submit', submitted);
  form.requestSubmit();
  expect(submitted).toHaveReturnedWith('c');
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
});
it('supports Home, End and type ahead', async () => {
  await key('Enter');
  await key('End');
  await key('Home');
  await key('c');
  await key('Enter');
  expect(host.querySelector('button')?.textContent).toContain('Charlie');
});
it('consumes Escape before the containing dialog and restores focus', async () => {
  await key(' ');
  await key('Escape');
  expect(escaped).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(host.querySelector('button'));
});

it('does not reopen after a pointer choice in a wrapping label', async () => {
  await act(async () => host.querySelector('button')?.click());
  await act(async () => host.querySelector<HTMLElement>('[role="option"][data-value="c"]')?.click());
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  expect(new FormData(host.querySelector('form')!).get('choice')).toBe('c');
});
