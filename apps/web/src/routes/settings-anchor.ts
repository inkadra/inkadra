import { type RefObject, useEffect } from 'react';
import { useLocation } from 'react-router';
import { ANCHOR_PARAM } from './settings-sections.ts';

/** How long a row found by the search stays highlighted. */
const FOUND_MS = 2400;
/** How long an opened row stays in view while what is above it is still loading. */
const SETTLE_MS = 1500;
const HANDS_ON = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
export const FOUND_CLASS = 'settings-found';
const FIELDS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea';
const FOCUSABLE = `${FIELDS}, button:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])`;

/**
 * Scrolls a row into view, highlights it for a moment and gives its control the focus (its
 * field first, else its first button), or the row itself when it has none. Without motion when
 * the person asked for less. Returns the undo, for when the page changes first.
 */
export function revealRow(row: HTMLElement): () => void {
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  row.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  const target = row.matches(FOCUSABLE)
    ? row
    : (row.querySelector<HTMLElement>(FIELDS) ?? row.querySelector<HTMLElement>(FOCUSABLE));
  if (target) target.focus({ preventScroll: true });
  else {
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
  }
  row.classList.add(FOUND_CLASS);
  const timer = window.setTimeout(() => row.classList.remove(FOUND_CLASS), FOUND_MS);
  return () => {
    window.clearTimeout(timer);
    row.classList.remove(FOUND_CLASS);
  };
}

/**
 * Opens a settings page on the row its address names (`?setting=<anchor>`, the row's
 * `data-setting`): pages load their rows, so it waits for the row to appear, for a while.
 * Every navigation runs it again, even to the same address.
 */
export function useRevealAnchor(root: RefObject<HTMLElement | null>) {
  const { search, key } = useLocation();
  const anchor = new URLSearchParams(search).get(ANCHOR_PARAM);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` reruns it for the same address.
  useEffect(() => {
    const scope = root.current;
    if (!anchor || !scope) return;
    let undo: (() => void) | undefined;
    let row: HTMLElement | undefined;
    const observer = new MutationObserver(() => void reveal());
    const giveUp = window.setTimeout(() => observer.disconnect(), 10000);
    // Cards above the row that load after it (Storage's limits) push it down: keep it centred
    // for a moment, until the person scrolls or acts themselves.
    const keep = new MutationObserver(() => row?.scrollIntoView?.({ block: 'center' }));
    const settle = () => {
      keep.disconnect();
      for (const type of HANDS_ON) (scope as HTMLElement).removeEventListener(type, settle);
    };
    let settled = 0;
    function reveal() {
      row = [...(scope as HTMLElement).querySelectorAll<HTMLElement>('[data-setting]')].find(
        (el) => el.dataset.setting === anchor,
      );
      if (!row) return false;
      observer.disconnect();
      window.clearTimeout(giveUp);
      undo = revealRow(row);
      keep.observe(scope as HTMLElement, { childList: true, subtree: true });
      for (const type of HANDS_ON)
        (scope as HTMLElement).addEventListener(type, settle, { passive: true });
      settled = window.setTimeout(settle, SETTLE_MS);
      return true;
    }
    if (!reveal()) observer.observe(scope, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
      window.clearTimeout(settled);
      settle();
      undo?.();
    };
  }, [anchor, key, root]);
}
