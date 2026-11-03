// SPDX-License-Identifier: AGPL-3.0-only
/** Toolbar/menu navigation belongs to the active editor, including keyboard Tab. */
export function isContextualFocus(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('.ctxbar, .contextual-popover, .menu');
}

/** Never take focus back from Search, comments, or another field outside the removed editor. */
export function restoreEditingFocus(canvas: HTMLElement | null, previous: string): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (
      active === document.body ||
      (active instanceof HTMLElement && active.closest(`[data-el="${CSS.escape(previous)}"]`))
    )
      canvas?.focus({ preventScroll: true });
  });
}
