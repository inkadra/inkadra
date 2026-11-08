/** Space kept between a menu and the window edges or the phone's tab bar. */
const GAP = 8;

/** The bottom a floating menu stays above: the phone's tab bar when it shows, else the window. */
export function menuFloor(): number {
  const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
  return nav && nav.height > 0 ? Math.min(nav.top, window.innerHeight) : window.innerHeight;
}

/**
 * Where a menu `height` tall opens: down from `at` (the anchor's bottom or the pressed point),
 * else up from `above` (the anchor's top) when it fits there, else as low as it fits. Taller
 * than the room above `floor`: pinned to the top with `maxHeight`, and it scrolls.
 */
export function placeMenu(
  at: number,
  above: number,
  height: number,
  floor: number,
): { top: number; maxHeight?: number } {
  const room = floor - 2 * GAP;
  if (height >= room) return { top: GAP, maxHeight: room };
  if (at + height <= floor - GAP) return { top: Math.max(GAP, at) };
  if (above - height >= GAP) return { top: above - height };
  return { top: floor - GAP - height };
}
