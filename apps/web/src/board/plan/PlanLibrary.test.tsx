// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PlanLibrary } from './PlanLibrary.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('switches categories on the rail, arms a tile and places the first search result', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onArm = vi.fn();
  const onPlace = vi.fn();
  try {
    await act(async () =>
      root.render(
        <PlanLibrary armed={null} phone={false} kit={[]} sensor="S35" onArm={onArm} onPlace={onPlace} />,
      ),
    );
    const rail = host.querySelector('nav[aria-label="board.plan.categoryTabs"]');
    const grip = rail?.querySelector<HTMLButtonElement>('[aria-label="board.plan.categories.grip"]');
    await act(async () => grip?.click());
    expect(grip?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('board.plan.groups.modifiers');
    const tile = [...host.querySelectorAll<HTMLButtonElement>('.plan-lib__tile')].find((b) =>
      b.textContent?.includes('board.plan.icons.softbox'),
    );
    await act(async () => tile?.click());
    expect(onArm).toHaveBeenCalledWith('softbox');
    const search = host.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(search, 'octa');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(onPlace).toHaveBeenCalledWith({ item: 'octa' }, null);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
