// SPDX-License-Identifier: MPL-2.0
import { type RefObject, useLayoutEffect, useRef } from 'react';

/**
 * Enter and exit motion (#332). Elements enter with a CSS animation on mount (the
 * `.ink-motion-*` classes in styles.css). To leave, an element React removes leaves behind an
 * inert copy that fades out and removes itself: no state, no re-render, nothing per frame.
 */

const EXIT_MS = 400;
/** Copies allowed per burst, so deleting a whole board does not clone every card. */
const BURST = 40;
let budget = BURST;
let burstStart = 0;

/**
 * Leaves a fading copy of `node` in its place. Call it while the node is still in the document,
 * from the cleanup of a layout effect. The copy has no ids and is hidden from assistive
 * technology and from the pointer.
 */
export function fadeOutCopy(node: Element | null): void {
  const parent = node?.parentNode;
  if (!node || !parent || !node.isConnected || typeof node.getAnimations !== 'function') return;
  const now = performance.now();
  if (now - burstStart > 100) {
    budget = BURST;
    burstStart = now;
  }
  if (budget-- <= 0) return;
  const copy = node.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll('[id], [data-el], [data-testid]')]) {
    el.removeAttribute('id');
    el.removeAttribute('data-el');
    el.removeAttribute('data-testid');
  }
  for (const name of [...copy.classList])
    if (name.startsWith('ink-motion-')) copy.classList.remove(name);
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.classList.add('ink-motion-exit');
  parent.insertBefore(copy, node.nextSibling);
  const done = () => copy.remove();
  copy.addEventListener('animationend', (event) => event.target === copy && done());
  setTimeout(done, EXIT_MS);
}

/** A ref for an element that fades out (`fadeOutCopy`) when its component unmounts. */
export function useExitFade<T extends Element>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => () => fadeOutCopy(ref.current), []);
  return ref;
}
