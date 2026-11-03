// SPDX-License-Identifier: AGPL-3.0-only
/** Toolbar/menu navigation belongs to the active editor, including keyboard Tab. */
export function isContextualFocus(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('.ctxbar, .contextual-popover, .menu');
}

/** Never take focus back from Search, comments, or another field outside the removed editor. */
export function restoreEditingFocus(canvas: HTMLElement | null): void {
  requestAnimationFrame(() => {
    // Removing a focused editor returns focus to body. Any surviving control owns its focus,
    // including buttons in the same card; do not infer ownership just from the old card ID.
    if (document.activeElement === document.body) canvas?.focus({ preventScroll: true });
  });
}
