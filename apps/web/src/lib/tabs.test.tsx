// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { moveTabFocus, TabPanel, Tabs } from '@inkadra/ui';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { walkTabs } from '../test/tabs.ts';

afterEach(() => document.body.replaceChildren());

const press = (key: string, extra: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, cancelable: true, ...extra });
  Object.defineProperty(e, 'target', { value: document.activeElement });
  return [moveTabFocus(e), e.defaultPrevented];
};
const focused = () => document.activeElement?.id;

it('walks the tabs with wrap, Home and End, and leaves other keys alone', () => {
  document.body.innerHTML = `<div role="tablist">${['a', 'b', 'c']
    .map((id) => `<button type="button" role="tab" id="${id}" tabindex="-1"></button>`)
    .join('')}</div><button type="button" id="out"></button>`;
  const choose = vi.fn();
  for (const tab of document.querySelectorAll('[role="tab"]'))
    tab.addEventListener('click', choose);

  document.getElementById('a')?.focus();
  expect(press('ArrowRight')).toEqual([true, true]);
  expect(focused()).toBe('b');
  press('ArrowRight');
  press('ArrowRight');
  expect(focused()).toBe('a');
  press('ArrowLeft');
  expect(focused()).toBe('c');
  press('Home');
  expect(focused()).toBe('a');
  press('End');
  expect(focused()).toBe('c');
  // The keys only move the focus: nothing is chosen.
  expect(choose).not.toHaveBeenCalled();
  // Browser shortcuts and other keys pass through, and so does a key outside a tablist.
  expect(press('ArrowLeft', { altKey: true })).toEqual([false, false]);
  expect(press('ArrowDown')).toEqual([false, false]);
  document.getElementById('out')?.focus();
  expect(press('ArrowRight')).toEqual([false, false]);
  expect(focused()).toBe('out');
});

it('skips disabled tabs, at the ends too', () => {
  document.body.innerHTML = `<div role="tablist">
    <button type="button" role="tab" id="a" disabled></button>
    <button type="button" role="tab" id="b"></button>
    <button type="button" role="tab" id="c" aria-disabled="true"></button>
    <button type="button" role="tab" id="d"></button></div>`;
  document.getElementById('b')?.focus();
  press('ArrowRight');
  expect(focused()).toBe('d');
  press('ArrowRight');
  expect(focused()).toBe('b');
  press('ArrowLeft');
  expect(focused()).toBe('d');
  press('Home');
  expect(focused()).toBe('b');
  press('End');
  expect(focused()).toBe('d');
});

function Bar({ changes }: { changes: (value: string) => void }) {
  const [value, setValue] = useState<'day' | 'calls' | 'kit'>('day');
  return (
    <>
      <Tabs
        id="t"
        label="Day"
        value={value}
        onChange={(v) => {
          changes(v);
          setValue(v);
        }}
        items={[
          { id: 'day', label: 'Day' },
          { id: 'calls', label: 'Calls', count: 12 },
          { id: 'kit', label: 'Kit' },
        ]}
      />
      <TabPanel id="t" value={value}>
        <input aria-label="kept" />
      </TabPanel>
    </>
  );
}

it('chooses on a click only, links each tab to the panel and keeps the panel mounted', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const changes = vi.fn();
  await act(async () => root.render(<Bar changes={changes} />));
  const list = host.querySelector('[role="tablist"]');
  expect(list?.classList).toContain('ink-tabs--line');
  expect(list?.querySelector('.ink-tabs__ind')?.getAttribute('aria-hidden')).toBe('true');
  await walkTabs(list);
  expect(changes).not.toHaveBeenCalled();
  const input = host.querySelector('input') as HTMLInputElement;
  input.value = 'typed';
  const calls = document.getElementById('t-calls') as HTMLButtonElement;
  expect(calls.querySelector('.ink-tabs__count')?.textContent).toBe('12');
  await act(async () => calls.click());
  expect(changes).toHaveBeenCalledWith('calls');
  expect(calls.getAttribute('aria-selected')).toBe('true');
  expect(calls.tabIndex).toBe(0);
  const panel = document.getElementById('t-panel');
  expect(panel?.getAttribute('aria-labelledby')).toBe('t-calls');
  // The same panel, so what it holds survives the switch.
  expect((host.querySelector('input') as HTMLInputElement).value).toBe('typed');
  // Clicking the chosen tab changes nothing.
  await act(async () => calls.click());
  expect(changes).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});
