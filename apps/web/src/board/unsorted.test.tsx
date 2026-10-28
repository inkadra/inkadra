import type { Element } from '@inkadra/doc-schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { UnsortedDrawer } from './chrome.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./cards.tsx', () => ({ Card: () => null }));

const note = { id: 'n1', type: 'note' } as Element;
const render = (items: Element[], open = false, dragging = false) =>
  renderToStaticMarkup(
    <UnsortedDrawer
      ref={null}
      items={items}
      open={open}
      onToggle={() => {}}
      selection={new Set()}
      dropping={false}
      dragging={dragging}
      draggingIds={undefined}
    />,
  );

it('shows Unsorted only while something waits, it is open or cards are dragged', () => {
  expect(render([])).toBe('');
  expect(render([note])).toContain('unsorted__toggle');
  expect(render([], true)).toContain('board.unsorted.empty');
  expect(render([], false, true)).toContain('unsorted__toggle');
});
