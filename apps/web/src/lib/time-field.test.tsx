// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { TimeField, TimeFieldTextsContext } from '@inkadra/ui';
import { act, type ComponentProps, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  HTMLElement.prototype.showPopover = vi.fn();
  HTMLElement.prototype.hidePopover = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const texts = {
  hours: 'Hours',
  minutes: 'Minutes',
  period: 'AM/PM',
  choose: 'Choose a time',
  clear: 'Clear',
  now: 'Now',
  required: 'Enter a time',
  hour12: false,
};

type FieldProps = Partial<ComponentProps<typeof TimeField>> & { start?: string | null };

function Field({ onChange, start, ...props }: FieldProps & { onChange: (v: string) => void }) {
  const [value, setValue] = useState<string | null>(start ?? '');
  return (
    <TimeField
      label="Call time"
      {...props}
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
    />
  );
}

function mount(props: FieldProps, hour12 = false) {
  const onChange = vi.fn();
  act(() =>
    root.render(
      <TimeFieldTextsContext.Provider value={{ ...texts, hour12 }}>
        <Field {...props} onChange={onChange} />
        <button type="button">elsewhere</button>
      </TimeFieldTextsContext.Provider>,
    ),
  );
  return onChange;
}
const seg = (k: 'h' | 'm' | 'p') =>
  host.querySelector<HTMLInputElement>(`[data-seg="${k}"]`) as HTMLInputElement;
const shown = () =>
  [...host.querySelectorAll<HTMLInputElement>('.ink-time__seg')].map((s) => s.value).join(' ');
const key = (target: Element, k: string, extra: KeyboardEventInit = {}) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }),
    );
  });
const elsewhere = () =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === 'elsewhere') as HTMLElement;
const type = (text: string) => {
  for (const ch of text) key(document.activeElement as Element, ch);
};

it('types hours and minutes into the segments and stores HH:MM', () => {
  const onChange = mount({});
  expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Call time');
  act(() => seg('h').focus());
  type('7');
  // 7 cannot start a two-digit hour: the focus moves on at once.
  expect(document.activeElement).toBe(seg('m'));
  expect(onChange).not.toHaveBeenCalled();
  type('30');
  expect(onChange).toHaveBeenLastCalledWith('07:30');
  expect(shown()).toBe('07 30');
  expect(seg('h').getAttribute('aria-valuenow')).toBe('7');
  // The arrows step and wrap; Shift steps the minutes by a quarter.
  key(seg('m'), 'ArrowUp', { shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith('07:45');
  key(seg('h'), 'ArrowDown');
  expect(onChange).toHaveBeenLastCalledWith('06:45');
});

it('fills the minutes when only an hour is given, and flags a required time left empty', () => {
  const onChange = mount({ required: true });
  act(() => seg('h').focus());
  type('19');
  act(() => elsewhere().focus());
  expect(onChange).toHaveBeenLastCalledWith('19:00');
  // Emptied and left: the field says a time is needed.
  act(() => seg('h').focus());
  key(seg('h'), 'Backspace');
  key(seg('h'), 'Backspace');
  act(() => seg('m').focus());
  key(seg('m'), 'Backspace');
  act(() => elsewhere().focus());
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(host.querySelector('.ink-field__error')?.textContent).toBe('Enter a time');
  expect(host.querySelector('[role="group"]')?.getAttribute('aria-invalid')).toBe('true');
});

it('shows the worked-out time until one is typed, and the × brings it back', () => {
  const onChange = mount({ auto: '19:00', autoLabel: 'auto', clearLabel: 'Clear wrap' });
  expect(shown()).toBe('19 00');
  expect(host.querySelector('.ink-time__auto')?.textContent).toBe('auto');
  expect(host.querySelector('[aria-label="Clear wrap"]')).toBeNull();
  act(() => seg('h').focus());
  type('2015');
  expect(onChange).toHaveBeenLastCalledWith('20:15');
  expect(host.querySelector('.ink-time__auto')).toBeNull();
  act(() => (host.querySelector('[aria-label="Clear wrap"]') as HTMLButtonElement).click());
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(shown()).toBe('19 00');
});

it('shows 12 h with AM/PM and still stores 24 h', () => {
  const onChange = mount({ start: '19:30' }, true);
  expect(shown()).toBe('7 30 PM');
  key(seg('p'), 'a');
  expect(onChange).toHaveBeenLastCalledWith('07:30');
  act(() => seg('h').focus());
  type('12');
  expect(onChange).toHaveBeenLastCalledWith('00:30');
});

it('understands a pasted time', () => {
  const onChange = mount({});
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '7:45 pm' } });
  act(() => {
    seg('h').dispatchEvent(paste);
  });
  expect(onChange).toHaveBeenLastCalledWith('19:45');
});

it('picks from the list: an hour keeps it open, the minutes close it', () => {
  const onChange = mount({ start: '07:30' });
  act(() => seg('h').focus());
  key(seg('h'), 'Enter');
  const lists = [...host.querySelectorAll('[role="listbox"]')];
  expect(lists.map((l) => l.getAttribute('aria-label'))).toEqual(['Hours', 'Minutes']);
  // Minutes in steps of five.
  expect(lists[1]?.querySelectorAll('[role="option"]')).toHaveLength(12);
  expect(document.activeElement?.textContent).toBe('07');
  const option = (list: number, text: string) =>
    [...(lists[list]?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
      (o) => o.textContent === text,
    ) as HTMLElement;
  act(() => option(0, '09').click());
  expect(onChange).toHaveBeenLastCalledWith('09:30');
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => option(1, '15').click());
  expect(onChange).toHaveBeenLastCalledWith('09:15');
  expect(host.querySelector('.ink-time__layer')?.classList).toContain('is-closing');
});
