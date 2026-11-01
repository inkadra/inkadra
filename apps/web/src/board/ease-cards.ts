import type { Point } from '@inkadra/canvas-core';

/** More cards than this land at once: easing them all would cost more than it shows. */
const MAX_EASED = 200;

/** A duration token such as `180ms` or `0.2s`, in milliseconds. */
export function tokenMs(value: string, fallback: number): number {
  const v = value.trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n;
}

/**
 * Eases cards from where they were drawn to where the document now puts them (#320, #296): a
 * FLIP on the card elements and their resize handles, animating only `transform` with the
 * motion tokens. The document already holds the final positions; this is the local picture
 * only, and nothing under `prefers-reduced-motion`. `from` maps card ids to their previous
 * world position, `to` gives the new one; the world layer is scaled, so world units are pixels.
 */
export function easeCards(
  root: HTMLElement | null,
  from: ReadonlyMap<string, Point>,
  to: (id: string) => Point | undefined,
): void {
  if (!root || from.size === 0 || from.size > MAX_EASED) return;
  if (typeof window.matchMedia !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const style = getComputedStyle(root);
  const duration = tokenMs(style.getPropertyValue('--ink-dur-base'), 180);
  const easing = style.getPropertyValue('--ink-ease-out').trim() || 'ease-out';
  for (const [id, old] of from) {
    const now = to(id);
    if (!now) continue;
    const dx = old.x - now.x;
    const dy = old.y - now.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    const key = CSS.escape(id);
    for (const el of root.querySelectorAll<HTMLElement>(
      `.card--free[data-el="${key}"], [data-resize-el="${key}"]`,
    )) {
      if (typeof el.animate !== 'function') continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration,
        easing,
      });
    }
  }
}
