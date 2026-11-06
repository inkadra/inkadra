// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';
import { moveTabFocus } from './tabs.ts';

afterEach(() => document.body.replaceChildren());

it('walks the tabs with wrap, Home and End, and leaves other keys alone', () => {
  document.body.innerHTML = `<div role="tablist">${['a', 'b', 'c']
    .map((id) => `<button type="button" role="tab" id="${id}" tabindex="-1"></button>`)
    .join('')}</div><button type="button" id="out"></button>`;
  const choose = vi.fn();
  for (const tab of document.querySelectorAll('[role="tab"]')) tab.addEventListener('click', choose);
  const press = (key: string, extra: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key, cancelable: true, ...extra });
    Object.defineProperty(e, 'target', { value: document.activeElement });
    return [moveTabFocus(e), e.defaultPrevented];
  };
  const focused = () => document.activeElement?.id;

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
