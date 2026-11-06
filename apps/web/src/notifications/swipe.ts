/** No swipe starts this close to the screen's left edge: iOS keeps it for going back. */
export const EDGE_PX = 24;
/** Movement before a finger counts as a swipe or a scroll. */
export const SLOP_PX = 8;

export function startsSwipe(clientX: number): boolean {
  return clientX > EDGE_PX;
}

/** The row's offset under the finger: only leftwards, and no further than its actions. */
export function swipeOffset(base: number, dx: number, width: number): number {
  return Math.min(0, Math.max(-width, base + dx));
}

/** Let go past half the actions, the row stays open on them; otherwise it closes. */
export function settle(offset: number, width: number): number {
  return width > 0 && offset < -width / 2 ? -width : 0;
}
