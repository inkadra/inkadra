// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NeededItems } from './NeededItems.tsx';
import type { NeededRow } from './needed.ts';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const row = (key: string, elementId: string): NeededRow => ({
  key,
  list: 'props',
  text: key,
  count: 1,
  scenes: ['1'],
  done: false,
  assigneeId: undefined,
  items: [{ elementId, itemId: `${key}-item` }],
});

it('shows a row on a storyboard read only as such, with why, and never drops a tick (#826)', async () => {
  const onChange = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () =>
    root.render(
      <NeededItems
        rows={[row('Umbrella', 'on-summary'), row('Towel', 'on-live')]}
        people={[]}
        userId="me"
        readOnly={false}
        locked={(r) => r.items[0]?.elementId === 'on-summary'}
        phone={false}
        onChange={onChange}
      />,
    ),
  );
  const box = (label: string) =>
    document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(box('Umbrella')?.disabled).toBe(true);
  const hint = document.getElementById(box('Umbrella')?.getAttribute('aria-describedby') ?? '');
  expect(hint?.textContent).toBe('needed.locked');
  expect(box('Towel')?.disabled).toBe(false);
  // Who brings it cannot be picked on the locked row either.
  expect(document.querySelectorAll('button.needed__who')).toHaveLength(1);
  await act(async () => box('Towel')?.click());
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'Towel' }), {
    done: true,
  });
  await act(async () => root.unmount());
});
