// @vitest-environment happy-dom
import type { Element } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { UnsortedDrawer } from './chrome.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { count?: number }) =>
      o?.count === undefined ? key : `${key}:${o.count}`,
  }),
}));
vi.mock('./cards.tsx', () => ({ Card: () => null }));
vi.mock('./assets.ts', () => ({ useAsset: () => undefined, pickVariant: () => '' }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: string) => ({ id, type: 'note' }) as Element;

function mount() {
  const host = document.createElement('div');
  const root = createRoot(host);
  const onPlaceAll = vi.fn();
  const render = (items: Element[], open = false, dragging = false) =>
    act(() =>
      root.render(
        <UnsortedDrawer
          ref={null}
          items={items}
          open={open}
          onToggle={() => {}}
          onPlaceAll={onPlaceAll}
          selection={new Set()}
          dropping={false}
          dragging={dragging}
          draggingIds={undefined}
        />,
      ),
    );
  return { host, render, onPlaceAll };
}

it('shows Unsorted only while something waits, it is open or cards are dragged', () => {
  const { host, render } = mount();
  render([]);
  expect(host.innerHTML).toBe('');
  render([note('a')]);
  expect(host.querySelector('.unsorted__toggle')).not.toBeNull();
  render([], true);
  expect(host.textContent).toContain('board.unsorted.empty');
  render([], false, true);
  expect(host.querySelector('.unsorted__toggle')).not.toBeNull();
});

it('offers the clipper from the empty Unsorted', () => {
  const { host, render } = mount();
  render([], true);
  expect(host.querySelector('a')?.getAttribute('href')).toBe(
    'https://chromewebstore.google.com/detail/inkadra-clipper/hdajoikapihpjfbgioeagenmoalckjkh',
  );
});

it('marks a waiting tray with its latest three items and an accent count', () => {
  const { host, render } = mount();
  render(['a', 'b', 'c', 'd'].map(note));
  const toggle = host.querySelector('.unsorted__toggle');
  expect(toggle?.classList.contains('has-items')).toBe(true);
  expect(toggle?.querySelectorAll('.unsorted__thumb')).toHaveLength(3);
  expect(toggle?.querySelector('.unsorted__badge')?.textContent).toBe('4');
  // Empty while dragging: a neutral count and the place to drop cards.
  render([], false, true);
  expect(host.querySelector('.unsorted__toggle')?.classList.contains('has-items')).toBe(false);
  expect(host.querySelector('.unsorted__count')?.textContent).toBe('0');
  expect(host.querySelector('.unsorted__drop')?.textContent).toBe('board.unsorted.drop');
});

it('pulses once when something new arrives, not when items leave', () => {
  const { host, render } = mount();
  render([note('a')]);
  expect(host.querySelector('.unsorted__ring')).toBeNull();
  render([note('a'), note('b')]);
  expect(host.querySelectorAll('.unsorted__ring')).toHaveLength(1);
  const ring = host.querySelector('.unsorted__ring');
  render([note('a')]);
  expect(host.querySelector('.unsorted__ring')).toBe(ring);
});

it('puts every item on the board from the open tray', () => {
  const { host, render, onPlaceAll } = mount();
  render([note('a'), note('b')], true);
  expect(host.querySelector('.unsorted__foot')?.textContent).toContain('board.unsorted.count:2');
  expect(host.querySelector('.unsorted__close')?.getAttribute('aria-label')).toBe(
    'board.unsorted.close',
  );
  act(() => (host.querySelector('.unsorted__place') as HTMLButtonElement).click());
  expect(onPlaceAll).toHaveBeenCalledOnce();
});
