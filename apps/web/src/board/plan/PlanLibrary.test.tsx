// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-only
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { walkTabs } from '../../test/tabs.ts';
import { PlanLibrary } from './PlanLibrary.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('names the category tabs and walks them by keyboard, switching only on a choice', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PlanLibrary
          armed={null}
          phone={false}
          onArm={vi.fn()}
          onDrop={vi.fn()}
          onPlaceFirst={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    const list = host.querySelector('[role="tablist"]');
    expect(list?.getAttribute('aria-label')).toBe('board.plan.categoryTabs');
    await walkTabs(list);
    const next = document.activeElement as HTMLElement;
    await act(async () => next.click());
    expect(next.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(next.id);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
