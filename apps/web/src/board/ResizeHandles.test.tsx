// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  canvasElementId,
  cornerPath,
  HANDLE_RUN,
  handleRun,
  ResizeHandles,
} from './ResizeHandles.tsx';

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

it('shortens the handles on a small card so the curves of two corners never meet', () => {
  expect(handleRun(300, HANDLE_RUN.desktop)).toBe(15);
  expect(handleRun(300, HANDLE_RUN.phone)).toBe(19);
  expect(handleRun(44, HANDLE_RUN.desktop)).toBe(12);
  for (const side of [44, 30, 16, 6]) {
    // Two runs plus 2.5 px of cap and halo at each end still leave a gap.
    expect(2 * handleRun(side, HANDLE_RUN.desktop) + 5).toBeLessThan(side);
  }
});

it('follows the card radius at 100 % and keeps the curve around the corner at any zoom', () => {
  expect(cornerPath(12, 15)).toBe('M0 15L0 12A12 12 0 0 1 12 0L15 0');
  expect(cornerPath(0, 15)).toBe('M0 15L0 0A0 0 0 0 1 0 0L15 0');
  // Zoomed in, the radius grows past the run: an arc centred on the corner's diagonal.
  expect(cornerPath(48, 15, 12)).toBe('M6.5 23.88L6.5 23.88A48 48 0 0 1 23.88 6.5L23.88 6.5');
});
