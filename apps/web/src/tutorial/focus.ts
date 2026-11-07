const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * After a tour closes, the browser gives the focus back to what had it before: when the tour came
 * from the first-time pill, that is the pill's button, gone by now, and the focus falls to the
 * page. Put it on the tour's first element when it can take it, else on the main region, never
 * on `body`. A focus the browser did give back is left alone; one still inside the closing tour
 * (its button, until the dialog unmounts) is not a focus given back.
 */
export function returnFocus(firstAnchor: HTMLElement | null) {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected && !active.closest('dialog.tour'))
    return;
  const target = firstAnchor?.matches(FOCUSABLE)
    ? firstAnchor
    : document.querySelector<HTMLElement>('main');
  if (!target) return;
  if (!target.matches(FOCUSABLE)) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
