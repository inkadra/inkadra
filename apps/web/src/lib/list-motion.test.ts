// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from 'vitest';
import { easeList, type Spot } from './list-motion.ts';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const spot = (y: number): Spot => ({ x: 0, y, width: 100, height: 20 });

it('eases a moved row, pops a new one and fades a removed one', () => {
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  const root = document.createElement('ul');
  const moved = document.createElement('li');
  const added = document.createElement('li');
  const gone = document.createElement('li');
  gone.className = 'row';
  root.append(moved, added);
  document.body.append(root);
  const animate = vi.fn();
  moved.animate = animate;
  added.animate = animate;
  HTMLElement.prototype.getAnimations ??= () => [];

  easeList(
    root,
    new Map([
      [moved, spot(40)],
      [gone, spot(0)],
    ]),
    new Map([
      [moved, spot(0)],
      [added, spot(20)],
    ]),
  );

  expect(animate).toHaveBeenCalledWith(
    [{ translate: '0px 40px' }, { translate: '0px 0px' }],
    expect.anything(),
  );
  expect(animate.mock.calls.some(([frames]) => frames[0].scale === 0.96)).toBe(true);
  const copy = root.querySelector('.ink-motion-exit') as HTMLElement;
  expect(copy.className).toBe('row ink-motion-exit');
  expect(copy.style.position).toBe('fixed');
});

it('drops the copies of an earlier change when the list changes again', () => {
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  const root = document.createElement('ul');
  const kept = document.createElement('li');
  const first = document.createElement('li');
  const back = document.createElement('li');
  root.append(kept);
  document.body.append(root);
  HTMLElement.prototype.getAnimations ??= () => [];
  back.animate = vi.fn();

  easeList(
    root,
    new Map([
      [kept, spot(0)],
      [first, spot(20)],
    ]),
    new Map([[kept, spot(0)]]),
  );
  expect(root.querySelectorAll('.ink-motion-exit')).toHaveLength(1);
  root.append(back);
  easeList(
    root,
    new Map([[kept, spot(0)]]),
    new Map([
      [kept, spot(0)],
      [back, spot(20)],
    ]),
  );
  expect(root.querySelector('.ink-motion-exit')).toBeNull();
});
