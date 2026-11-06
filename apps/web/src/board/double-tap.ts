/** One finger lifted off the empty board: when and where it went down, in screen pixels. */
export interface Tap {
  at: number;
  x: number;
  y: number;
}

/** As the platforms do: the second tap within 300 ms and about a fingertip from the first. */
const WINDOW_MS = 300;
const SLOP_PX = 24;
/** Further than this between going down and lifting, a finger panned or drew: not a tap. */
const STILL_PX = 8;

export function isDoubleTap(previous: Tap | null, tap: Tap): boolean {
  if (!previous) return false;
  const elapsed = tap.at - previous.at;
  return (
    elapsed >= 0 &&
    elapsed <= WINDOW_MS &&
    Math.hypot(tap.x - previous.x, tap.y - previous.y) <= SLOP_PX
  );
}

export function stayedStill(down: Tap, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= STILL_PX;
}
