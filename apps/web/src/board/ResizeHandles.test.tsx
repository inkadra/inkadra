// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { canvasElementId, ResizeHandles } from './ResizeHandles.tsx';

it('keeps one card identity while all four resize controls resolve their owner', () => {
  const host = document.createElement('div');
  host.innerHTML = `<article class="card" data-el="card-1"><span>Note</span></article>${renderToStaticMarkup(
    <ResizeHandles id="card-1" rect={{ x: 10, y: 20, w: 300, h: 200 }} zoom={0.5} />,
  )}`;
  expect(host.querySelectorAll('[data-el]')).toHaveLength(1);
  expect(canvasElementId(host.querySelector('article span')!)).toBe('card-1');
  const handles = host.querySelectorAll<HTMLElement>('[data-handle]');
  expect([...handles].map((handle) => handle.dataset.handle)).toEqual(['nw', 'ne', 'sw', 'se']);
  for (const handle of handles) expect(canvasElementId(handle)).toBe('card-1');
  expect(canvasElementId(host)).toBeUndefined();
});
