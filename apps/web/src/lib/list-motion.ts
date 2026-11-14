import { fadeOutCopy } from '@inkadra/ui';
import { type RefObject, useLayoutEffect, useRef } from 'react';
import { tokenMs } from '../board/ease-cards.ts';

/** Longer lists are not measured on every render. */
const MAX_ITEMS = 300;
/** More rows than this come or go at once (a filter, a tab): that is a new list, not an edit. */
const MAX_CHANGES = 12;

/** Where an item sat, relative to the list's scroll origin, and its size. */
export type Spot = { x: number; y: number; width: number; height: number };

function measure(root: HTMLElement, selector: string): Map<HTMLElement, Spot> | null {
  const items = root.querySelectorAll<HTMLElement>(selector);
  if (items.length > MAX_ITEMS) return null;
  const box = root.getBoundingClientRect();
  // A hidden list has no places to ease from.
  if (box.width === 0) return null;
  const spots = new Map<HTMLElement, Spot>();
  for (const item of items) {
    // A fading copy of a removed row is not a row.
    if (item.classList.contains('ink-motion-exit')) continue;
    const r = item.getBoundingClientRect();
    spots.set(item, {
      x: r.left - box.left + root.scrollLeft,
      y: r.top - box.top + root.scrollTop,
      width: r.width,
      height: r.height,
    });
  }
  return spots;
}

/** A fading copy of a row React already removed, drawn where the row was. */
function leave(root: HTMLElement, node: HTMLElement, spot: Spot): void {
  // shortcut: a lone table row loses its table layout, so shot rows just go; upgrade if rows
  // stop being <tr>.
  if (node.tagName === 'TR') return;
  const box = root.getBoundingClientRect();
  const left = box.left + spot.x - root.scrollLeft;
  const top = box.top + spot.y - root.scrollTop;
  const ghost = node.cloneNode(true) as HTMLElement;
  ghost.dataset.listGhost = '';
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${spot.width}px`,
    height: `${spot.height}px`,
    margin: '0',
    boxSizing: 'border-box',
  });
  root.append(ghost);
  // A transformed ancestor moves a fixed box: put it back where the row was.
  const at = ghost.getBoundingClientRect();
  if (Math.abs(at.left - left) > 0.5 || Math.abs(at.top - top) > 0.5)
    ghost.style.translate = `${left - at.left}px ${top - at.top}px`;
  fadeOutCopy(ghost);
  ghost.remove();
}

/**
 * Motion for a list that changes under the person's hand (#768): a row that moved eases from
 * its old place (FLIP, `translate` only), a new row pops in and a removed one fades out where
 * it was. Only transform and opacity move; with reduced motion new rows fade in and moved or
 * removed ones change at once.
 */
export function easeList(
  root: HTMLElement,
  before: ReadonlyMap<HTMLElement, Spot>,
  now: ReadonlyMap<HTMLElement, Spot>,
): void {
  if (typeof window.matchMedia !== 'function') return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const added = [...now.keys()].filter((item) => !before.has(item));
  const removed = [...before].filter(([item]) => !now.has(item) && !item.isConnected);
  const few = added.length + removed.length <= MAX_CHANGES;
  // The list changed again: rows that were still fading go now, so a copy never sits beside the
  // row it was (a resolved thread shown again) or over a new list.
  if (added.length + removed.length > 0)
    for (const ghost of root.querySelectorAll(':scope > [data-list-ghost]')) ghost.remove();
  if (still && !few) return;
  const style = getComputedStyle(root);
  const duration = tokenMs(style.getPropertyValue('--ink-dur-base'), 180);
  const easeOut = style.getPropertyValue('--ink-ease-out').trim() || 'ease-out';
  const easePop = style.getPropertyValue('--ink-ease-pop').trim() || easeOut;
  for (const [item, spot] of now) {
    if (typeof item.animate !== 'function') continue;
    const old = before.get(item);
    if (!old) {
      if (few)
        item.animate(
          still
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { opacity: 0, scale: 0.96 },
                { opacity: 1, scale: 1 },
              ],
          { duration, easing: easePop },
        );
      continue;
    }
    const dx = old.x - spot.x;
    const dy = old.y - spot.y;
    if (still || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) continue;
    item.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], {
      duration,
      easing: easeOut,
    });
  }
  // With reduced motion a removed row goes at once: no copy lingers in its place.
  if (few && !still) for (const [item, spot] of removed) leave(root, item, spot);
}

/** Runs `easeList` on the items matching `selector` inside `root` after every render. */
export function useListMotion(root: RefObject<HTMLElement | null>, selector: string): void {
  const last = useRef<Map<HTMLElement, Spot> | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    const before = last.current;
    const now = el ? measure(el, selector) : null;
    last.current = now;
    if (el && before && now) easeList(el, before, now);
  });
}
