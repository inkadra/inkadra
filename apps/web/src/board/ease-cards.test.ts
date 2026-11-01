// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { easeCards, tokenMs } from './ease-cards.ts';

function board(reduced: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce') }));
  const root = document.createElement('div');
  root.innerHTML =
    '<div class="card card--free" data-el="a"></div><div data-resize-el="a"></div>' +
    '<div class="card card--free" data-el="b"></div>';
  document.body.append(root);
  const animate = vi.fn();
  for (const el of root.querySelectorAll<HTMLElement>('*')) el.animate = animate;
  return { root, animate };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('easing cards into place', () => {
  it('reads duration tokens', () => {
    expect(tokenMs('180ms', 0)).toBe(180);
    expect(tokenMs(' 0.2s', 0)).toBe(200);
    expect(tokenMs('', 150)).toBe(150);
  });

  it('animates the transform from the old place to the new one, handles included', () => {
    const { root, animate } = board(false);
    const from = new Map([
      ['a', { x: 10, y: 20 }],
      ['b', { x: 5, y: 5 }],
    ]);
    easeCards(root, from, (id) => (id === 'a' ? { x: 110, y: 20 } : { x: 5, y: 5 }));
    // Card a and its handles move; card b did not move.
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[0]?.[0]).toEqual([
      { transform: 'translate(-100px, 0px)' },
      { transform: 'none' },
    ]);
  });

  it('is instant with reduced motion', () => {
    const { root, animate } = board(true);
    easeCards(root, new Map([['a', { x: 0, y: 0 }]]), () => ({ x: 50, y: 50 }));
    expect(animate).not.toHaveBeenCalled();
  });
});
