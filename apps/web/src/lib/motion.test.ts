// @vitest-environment happy-dom

import { fadeOutCopy } from '@inkadra/ui';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('leaves an inert copy without ids that removes itself', () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div><div id="card" role="dialog" aria-modal="true" aria-label="A" class="card ink-motion-card" data-el="a" data-type="note"><b data-testid="t">A</b><video src="a.mp4" autoplay></video><iframe src="a.pdf"></iframe></div></div>';
  const card = document.getElementById('card') as HTMLElement;
  card.getAnimations ??= () => [];
  fadeOutCopy(card);
  const copy = card.nextElementSibling as HTMLElement;
  expect(copy.className).toBe('card ink-motion-exit');
  expect(copy.getAttribute('aria-hidden')).toBe('true');
  expect(copy.querySelector('[data-testid]')).toBeNull();
  expect(copy.querySelector('video, iframe')).toBeNull();
  expect(
    ['id', 'data-el', 'data-type', 'role', 'aria-modal', 'aria-label'].some((name) =>
      copy.hasAttribute(name),
    ),
  ).toBe(false);
  vi.advanceTimersByTime(500);
  expect(copy.isConnected).toBe(false);
});

it('does nothing for a node already out of the document', () => {
  const lone = document.createElement('div');
  expect(() => fadeOutCopy(lone)).not.toThrow();
  expect(() => fadeOutCopy(null)).not.toThrow();
});
