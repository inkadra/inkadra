// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FilterButton, MenuButton, MenuChoices } from './filter-bar.tsx';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom has no popover API, which the panel and the menus open with.
  HTMLElement.prototype.showPopover ??= () => {};
  HTMLElement.prototype.hidePopover ??= () => {};
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('shows how many filters are on, clears them, and closes on Escape back to the button', async () => {
  const clear = vi.fn();
  await act(async () =>
    root.render(
      <FilterButton count={2} summary="2 of 48 shots" showLabel="Show 2 shots" onClear={clear}>
        <input aria-label="Scene" />
      </FilterButton>,
    ),
  );
  const button = host.querySelector<HTMLButtonElement>('.filter-bar__button');
  expect(button?.classList.contains('is-active')).toBe(true);
  expect(button?.querySelector('.filter-bar__badge')?.textContent).toBe('2');
  expect(button?.getAttribute('aria-label')).toBe('filterBar.filtersActive');
  await act(async () => button?.click());
  const panel = host.querySelector<HTMLElement>('[role="dialog"]');
  expect(button?.getAttribute('aria-expanded')).toBe('true');
  expect(panel?.textContent).toContain('2 of 48 shots');
  // The first control takes the focus.
  expect(document.activeElement).toBe(panel?.querySelector('input'));
  await act(async () => panel?.querySelector<HTMLButtonElement>('.filter-bar__clear')?.click());
  expect(clear).toHaveBeenCalledOnce();
  await act(async () =>
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button);
});

it('has no badge and a disabled Clear filters with no filter on', async () => {
  await act(async () =>
    root.render(
      <FilterButton count={0} showLabel="Show" onClear={() => {}}>
        <span />
      </FilterButton>,
    ),
  );
  const button = host.querySelector<HTMLButtonElement>('.filter-bar__button');
  expect(button?.querySelector('.filter-bar__badge')).toBeNull();
  await act(async () => button?.click());
  expect(host.querySelector<HTMLButtonElement>('.filter-bar__clear')?.disabled).toBe(true);
});

function View() {
  const [group, setGroup] = useState<'scene' | 'status'>('scene');
  return (
    <MenuButton icon="sort" menuLabel="View" label={`View: ${group}`}>
      <MenuChoices
        title="Group by"
        value={group}
        options={[
          { value: 'scene', label: 'Scene' },
          { value: 'status', label: 'Status' },
        ]}
        onChange={setGroup}
      />
    </MenuButton>
  );
}

it('checks one choice, picks another, then closes and gives the focus back', async () => {
  await act(async () => root.render(<View />));
  const button = host.querySelector<HTMLButtonElement>('.filter-bar__menu-button');
  expect(button?.getAttribute('aria-haspopup')).toBe('menu');
  await act(async () => button?.click());
  const items = [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  // The current choice has the focus.
  expect(document.activeElement).toBe(items[0]);
  await act(async () => items[1]?.click());
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(button?.textContent).toContain('View: status');
  expect(document.activeElement).toBe(button);
  await act(async () => button?.click());
  expect(
    [...host.querySelectorAll('[role="menuitemradio"]')].map((i) => i.getAttribute('aria-checked')),
  ).toEqual(['false', 'true']);
});
