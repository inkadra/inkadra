/** Zoom per mouse wheel notch: about 12 %, so a few notches reach the level you want. */
export const WHEEL_STEP = 1.12;
/** A single event never moves more than this many notches, however large its delta. */
const MAX_NOTCHES = 2;
/** Pixel deltas smaller than this come from a trackpad pinch, not from a wheel notch. */
const NOTCH_PIXELS = 50;

/**
 * The zoom factor a Ctrl/⌘ + wheel event asks for. A wheel notch (a line-mode delta, or a pixel
 * delta of a whole notch, ~100) is one fixed step per notch, `discrete`; a trackpad pinch sends
 * small deltas and keeps its continuous, direct factor.
 */
export function wheelZoomFactor(
  deltaY: number,
  deltaMode: number,
): { factor: number; discrete: boolean } {
  if (deltaY === 0) return { factor: 1, discrete: false };
  const lines = deltaMode === 1;
  if (lines || (Math.abs(deltaY) >= NOTCH_PIXELS && Number.isInteger(deltaY))) {
    // One notch is 3 lines, or about 100 pixels.
    const notches = Math.min(
      MAX_NOTCHES,
      Math.max(1, Math.round(Math.abs(deltaY) / (lines ? 3 : 100))),
    );
    return { factor: WHEEL_STEP ** (-Math.sign(deltaY) * notches), discrete: true };
  }
  const pinch = Math.max(-100, Math.min(100, deltaY));
  return { factor: Math.exp(-pinch * 0.01), discrete: false };
}

/** Time the animated zoom takes to cover most of the way to its target. */
export const ZOOM_EASE_MS = 120;

/** One animation frame toward `target`: exponential ease, so fast scrolling accumulates smoothly. */
export function easeZoom(current: number, target: number, elapsedMs: number): number {
  const k = 1 - Math.exp((-3 * elapsedMs) / ZOOM_EASE_MS);
  const next = current * (target / current) ** k;
  return Math.abs(Math.log(target / next)) < 0.002 ? target : next;
}
