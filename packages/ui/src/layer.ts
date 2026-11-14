// SPDX-License-Identifier: MPL-2.0
import { swallowOutsidePress } from './components.tsx';

/**
 * Shows the popover `layer` of a field (the date calendar, the time list) and keeps it under
 * `box`, or above it when there is no room below; it grows away from the field. With room on
 * neither side (a low window, a high zoom) it starts at the top of the window, over the field,
 * and the panel scrolls within the window's height. A press outside both calls `onOutside`;
 * on a phone the layer is the scrim around the sheet, and its own click closes it. Returns the
 * cleanup.
 */
export function anchorLayer(layer: HTMLElement, box: HTMLElement, onOutside: () => void) {
  layer.showPopover();
  const position = () => {
    const rect = box.getBoundingClientRect();
    const width = layer.offsetWidth;
    const height = layer.offsetHeight;
    const fitsBelow = rect.bottom + 6 + height <= window.innerHeight - 8;
    const below = fitsBelow || rect.top - 6 - height < 8;
    layer.dataset.side = below ? 'below' : 'above';
    layer.style.setProperty(
      '--ink-date-left',
      `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    );
    layer.style.setProperty(
      '--ink-date-top',
      below ? `${fitsBelow ? rect.bottom + 6 : 8}px` : 'auto',
    );
    layer.style.setProperty(
      '--ink-date-bottom',
      below ? 'auto' : `${window.innerHeight - rect.top + 6}px`,
    );
  };
  position();
  const outside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (layer.contains(target) || box.contains(target)) return;
    swallowOutsidePress(event);
    onOutside();
  };
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  return () => {
    layer.hidePopover();
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
  };
}
