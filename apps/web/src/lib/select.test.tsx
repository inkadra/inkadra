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
    <dialog open onCancel={escaped}>
      <form
        onKeyDown={(event) => {
          if (event.key === 'Escape') escaped();
        }}
      >
        <label htmlFor="choice">
          Choice
          <Select
            id="choice"
            name="choice"
            aria-label="Choice"
            value={value}
            onChange={setValue}
            options={[
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta', disabled: true },
              { value: 'c', label: 'Charlie' },
            ]}
          />
        </label>
      </form>
    </dialog>
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
  const submitted = vi.fn((event: Event) => {
    event.preventDefault();
    return new FormData(form).get('choice');
  });
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
  await act(async () =>
    host.querySelector<HTMLElement>('[role="option"][data-value="c"]')?.click(),
  );
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  expect(new FormData(host.querySelector('form')!).get('choice')).toBe('c');
});

it('titles the sheet with the field label and closes on a backdrop tap, back on the trigger', async () => {
  await act(async () => host.querySelector('button')?.click());
  const layer = host.querySelector<HTMLElement>('.ink-select__layer');
  expect(layer?.querySelector('.ink-select__title')?.textContent).toBe('Choice');
  expect(layer?.querySelector('[role="listbox"]')).not.toBeNull();
  await act(async () => layer?.click());
  expect(host.querySelector('.ink-select__layer')).toBeNull();
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(host.querySelector('button'));
  expect(new FormData(host.querySelector('form')!).get('choice')).toBe('a');
});

it('chooses by typing while closed, like a native select, without opening', async () => {
  await key('c');
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  expect(new FormData(host.querySelector('form')!).get('choice')).toBe('c');
  // A disabled option is never chosen by typing.
  await key('b');
  expect(new FormData(host.querySelector('form')!).get('choice')).toBe('c');
});

it('names the list once, lists options sharing a value, and stays still while its list scrolls', async () => {
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ top: 100, bottom: 130, left: 20, width: 120 } as DOMRect);
  try {
    await act(async () =>
      root.render(
        <Select
          aria-label="Twins"
          value="x"
          onChange={() => {}}
          options={[
            { value: 'x', label: 'One' },
            { value: 'x', label: 'Two' },
          ]}
        />,
      ),
    );
    await act(async () => host.querySelector('button')?.click());
    const list = host.querySelector('[role="listbox"]') as HTMLElement;
    expect(list.hasAttribute('aria-label')).toBe(false);
    expect(list.getAttribute('aria-labelledby')).toBe(host.querySelector('button')?.id);
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual([
      'One',
      'Two',
    ]);
    const layer = host.querySelector('.ink-select__layer') as HTMLElement;
    expect(layer.style.getPropertyValue('--ink-layer-top')).toBe('138px');
    rect.mockReturnValue({ top: 300, bottom: 330, left: 20, width: 120 } as DOMRect);
    list.dispatchEvent(new Event('scroll'));
    expect(layer.style.getPropertyValue('--ink-layer-top')).toBe('138px');
    document.dispatchEvent(new Event('scroll'));
    expect(layer.style.getPropertyValue('--ink-layer-top')).toBe('338px');
  } finally {
    rect.mockRestore();
  }
});

it('opens nothing with no options and no empty text', async () => {
  await act(async () => root.render(<Select aria-label="None" value="" onChange={() => {}} />));
  await act(async () => host.querySelector('button')?.click());
  expect(host.querySelector('.ink-select__layer')).toBeNull();
  await act(async () =>
    root.render(<Select aria-label="None" value="" onChange={() => {}} emptyText="Nothing yet" />),
  );
  await act(async () => host.querySelector('button')?.click());
  expect(host.querySelector('.ink-select__empty')?.textContent).toBe('Nothing yet');
});

it('places the list below a field in a low window while it fits, above when only that fits, else at the top', async () => {
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ top: 121, bottom: 157, left: 20, width: 120 } as DOMRect);
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(288);
  const viewport = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(457);
  const place = () => {
    const layer = host.querySelector('.ink-select__layer') as HTMLElement;
    return [
      layer.style.getPropertyValue('--ink-layer-top'),
      layer.style.getPropertyValue('--ink-layer-bottom'),
    ];
  };
  const reopen = async () => {
    await act(async () => host.querySelector('button')?.click());
    if (host.querySelector('.ink-select__layer'))
      await act(async () => host.querySelector('button')?.click());
    await act(async () => host.querySelector('button')?.click());
  };
  try {
    // 157 + 8 + 288 = 453: inside the window, though not 8px from its edge.
    await reopen();
    expect(place()).toEqual(['165px', 'auto']);
    // Room above with the margin wins over room below without it.
    rect.mockReturnValue({ top: 300, bottom: 336, left: 20, width: 120 } as DOMRect);
    await reopen();
    expect(place()).toEqual(['auto', '165px']);
    // Room on neither side: from the top of the window.
    viewport.mockReturnValue(320);
    rect.mockReturnValue({ top: 121, bottom: 157, left: 20, width: 120 } as DOMRect);
    await reopen();
    expect(place()).toEqual(['8px', 'auto']);
  } finally {
    rect.mockRestore();
    height.mockRestore();
    viewport.mockRestore();
  }
});

it('leaves a key that matches no option to the page, and ignores keys composing a character', async () => {
  const seen = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
  document.addEventListener('keydown', seen);
  try {
    await key('n');
    expect(seen).toHaveLastReturnedWith(false);
    const trigger = host.querySelector('button') as HTMLButtonElement;
    for (const k of ['c', 'Enter'])
      await act(async () =>
        trigger.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: k,
            isComposing: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(new FormData(host.querySelector('form')!).get('choice')).toBe('a');
    await key('Enter');
    await act(async () =>
      host.querySelector('[role="listbox"]')?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(new FormData(host.querySelector('form')!).get('choice')).toBe('a');
  } finally {
    document.removeEventListener('keydown', seen);
  }
});

function Kept({ text }: { text: string }) {
  const [kept] = useState(text);
  return <>{kept}</>;
}
it('keeps each option’s state with its value when the open list changes', async () => {
  const options = (values: string[]) =>
    values.map((v) => ({ value: v, label: <Kept text={v.toUpperCase()} /> }));
  await act(async () =>
    root.render(
      <Select aria-label="Letters" value="a" onChange={() => {}} options={options(['a', 'b'])} />,
    ),
  );
  await act(async () => host.querySelector('button')?.click());
  await act(async () =>
    root.render(
      <Select
        aria-label="Letters"
        value="a"
        onChange={() => {}}
        options={options(['x', 'a', 'b'])}
      />,
    ),
  );
  const text = (v: string) => host.querySelector(`[role="option"][data-value="${v}"]`)?.textContent;
  expect([text('x'), text('a'), text('b')]).toEqual(['X', 'A', 'B']);
});
