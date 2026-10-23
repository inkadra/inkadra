import { useCallback, useEffect, useRef } from 'react';
import type { BoardStore } from './store.ts';

/**
 * One ResizeObserver for every card: reports rendered heights to the store, which uses them
 * for hit testing, culling, snapping and the minimap. Sizes are in world units because cards
 * are laid out inside the scaled world layer and offsetHeight ignores transforms.
 */
const targets = new WeakMap<Element, { id: string; store: BoardStore }>();
let observer: ResizeObserver | null = null;

function getObserver(): ResizeObserver {
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const t = targets.get(entry.target);
      if (t) t.store.setHeight(t.id, (entry.target as HTMLElement).offsetHeight);
    }
  });
  return observer;
}

export function useMeasure(store: BoardStore, id: string, enabled = true) {
  const node = useRef<HTMLElement | null>(null);
  const ref = useCallback(
    (el: HTMLElement | null) => {
      const obs = getObserver();
      if (node.current) obs.unobserve(node.current);
      node.current = el;
      if (el && enabled) {
        targets.set(el, { id, store });
        obs.observe(el);
      }
    },
    [store, id, enabled],
  );
  useEffect(
    () => () => {
      if (node.current) getObserver().unobserve(node.current);
    },
    [],
  );
  return ref;
}
