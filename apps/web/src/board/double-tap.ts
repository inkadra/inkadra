/** One finger lifted off the empty board: when and where it went down, in screen pixels. */
export interface Tap {
  at: number;
  x: number;
  y: number;
}

/** As the platforms do: the second tap within 300 ms and about a fingertip from the first. */
const WINDOW_MS = 300;
const SLOP_PX = 24;

export function isDoubleTap(previous: Tap | null, tap: Tap): boolean {
  if (!previous) return false;
  const elapsed = tap.at - previous.at;
  return (
    elapsed >= 0 &&
    elapsed <= WINDOW_MS &&
    Math.hypot(tap.x - previous.x, tap.y - previous.y) <= SLOP_PX
  );
}
