// SPDX-License-Identifier: MPL-2.0
import { boundsOf, MAX_ZOOM, MIN_ZOOM, type Rect, type Viewport } from './geometry.ts';

/**
 * A board that stays around its content (#324): the view pans over the cards plus a margin of
 * about one viewport, and grows as cards are added or moved out. Pure viewport math; nothing
 * here touches the board document.
 */

/**
 * Where the view may go: the bounding box of the content with half a viewport (at 100 %) on
 * each side. An empty board gets a centred area of about two viewports.
 */
export function panArea(content: Rect | null, width: number, height: number): Rect {
  if (!content) return { x: -width / 2, y: -height / 2, w: width * 2, h: height * 2 };
  return {
    x: content.x - width / 2,
    y: content.y - height / 2,
    w: content.w + width,
    h: content.h + height,
  };
}

/**
 * The area of one gesture: the board's, widened to take in what is on screen now. A view left
 * outside after cards were deleted never jumps; the area shrinks as the view comes back.
 */
export function gestureArea(area: Rect, visible: Rect): Rect {
  return boundsOf([area, visible]) ?? area;
}

/** Farthest zoom out: the whole area fits on screen; never closer than 100 %. */
export function minZoomFor(area: Rect, width: number, height: number): number {
  const fit = Math.min(width / area.w, height / area.h);
  return Math.min(1, Math.max(MIN_ZOOM, fit));
}

/** Where the start of the view may be on one axis: inside the area, or holding it whole. */
function axisRange(start: number, length: number, view: number): [number, number] {
  return view <= length ? [start, start + length - view] : [start + length - view, start];
}

const clamp = (value: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, value));

/** The viewport moved and zoomed the least to stay in the area. */
export function clampViewport(v: Viewport, area: Rect, width: number, height: number): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoomFor(area, width, height), v.zoom));
  return {
    zoom,
    x: clamp(v.x, axisRange(area.x, area.w, width / zoom)),
    y: clamp(v.y, axisRange(area.y, area.h, height / zoom)),
  };
}

/** A pull past the edge gives way to at most this share of the view. */
const PULL_SHARE = 1 / 3;

/**
 * How far a pull past the edge shows, in screen pixels: it eases toward `dimension` and never
 * reaches it, the further the pull the stiffer (the rubber band of scroll views).
 */
export function rubberBand(overshoot: number, dimension: number): number {
  if (overshoot === 0 || dimension <= 0) return 0;
  const shown = (1 - 1 / ((Math.abs(overshoot) * 0.55) / dimension + 1)) * dimension;
  return Math.sign(overshoot) * shown;
}

/**
 * The view to draw for one the person asked for (`raw`): kept in the area, with a rubber band
 * past its edges when `elastic`. `overshoot` is the pull shown past each edge, in screen pixels
 * (negative: past the left or top edge), for the edge glow.
 */
export function boundViewport(
  raw: Viewport,
  area: Rect,
  width: number,
  height: number,
  elastic: boolean,
): { viewport: Viewport; overshoot: { x: number; y: number } } {
  const inside = clampViewport(raw, area, width, height);
  const zoom = inside.zoom;
  const pull = (want: number, have: number, dimension: number) =>
    elastic ? rubberBand((want - have) * zoom, dimension * PULL_SHARE) : 0;
  // A zoom held at the limit keeps the raw view's centre, so pinching out does not slide.
  const x = raw.zoom === zoom ? raw.x : raw.x + (width / raw.zoom - width / zoom) / 2;
  const y = raw.zoom === zoom ? raw.y : raw.y + (height / raw.zoom - height / zoom) / 2;
  const held = clampViewport({ x, y, zoom }, area, width, height);
  const overshoot = { x: pull(x, held.x, width), y: pull(y, held.y, height) };
  return {
    viewport: { zoom, x: held.x + overshoot.x / zoom, y: held.y + overshoot.y / zoom },
    overshoot,
  };
}
