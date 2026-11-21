// SPDX-License-Identifier: MPL-2.0

const PRESSABLE =
  'button, a[href], input, select, textarea, summary, label, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [contenteditable="true"]';

/**
 * For the capture-phase `pointerdown` listener of a menu or popover that closes on an outside
 * press: a press on empty space only closes it. Neither it nor the click that follows reaches
 * what is underneath, the board included. A press on a control goes through, so one press
 * still reaches another menu's button.
 */
export function swallowOutsidePress(event: Event) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest(PRESSABLE)) return;
  event.stopPropagation();
  // The click follows the release at once. A press that never ends in one (a touch that turns
  // into a scroll is cancelled) must not hold back a later click.
  const pressed = new AbortController();
  document.addEventListener('pointercancel', () => pressed.abort(), {
    capture: true,
    once: true,
    signal: pressed.signal,
  });
  document.addEventListener(
    'pointerup',
    () => {
      pressed.abort();
      const swallow = (e: Event) => e.stopPropagation();
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, true), 0);
    },
    { capture: true, once: true, signal: pressed.signal },
  );
}

/**
 * Shows the popover `layer` of a field (the date calendar, the time list, the Select's list) and
 * keeps it `gap` pixels under `box`, or above it when there is no room below; it grows away from
 * the field. With room on neither side (a low window, a high zoom) it starts at the top of the
 * window, over the field, and the panel scrolls within the window's height. The layer's CSS
 * places it with `--ink-layer-left`, `--ink-layer-top` and `--ink-layer-bottom`, and may size it
 * from the field's width, `--ink-layer-anchor-width`. A press outside both calls `onOutside`; on
 * a phone the layer is the scrim around the sheet, and its own click closes it. Returns the
 * cleanup.
 */
export function anchorLayer(layer: HTMLElement, box: HTMLElement, onOutside: () => void, gap = 6) {
  layer.showPopover();
  const position = () => {
    const rect = box.getBoundingClientRect();
    layer.style.setProperty('--ink-layer-anchor-width', `${rect.width}px`);
    const width = layer.offsetWidth;
    const height = layer.offsetHeight;
    const fitsBelow = rect.bottom + gap + height <= window.innerHeight - 8;
    const below = fitsBelow || rect.top - gap - height < 8;
    layer.dataset.side = below ? 'below' : 'above';
    layer.style.setProperty(
      '--ink-layer-left',
      `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    );
    layer.style.setProperty(
      '--ink-layer-top',
      below ? `${fitsBelow ? rect.bottom + gap : 8}px` : 'auto',
    );
    layer.style.setProperty(
      '--ink-layer-bottom',
      below ? 'auto' : `${window.innerHeight - rect.top + gap}px`,
    );
  };
  position();
  const outside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (layer.contains(target) || box.contains(target)) return;
    swallowOutsidePress(event);
    onOutside();
  };
  // Scrolling a list inside the layer moves nothing the layer hangs from.
  const scroll = (event: Event) => {
    if (!(event.target instanceof Node && layer.contains(event.target))) position();
  };
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', scroll, true);
  return () => {
    layer.hidePopover();
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', scroll, true);
  };
}
