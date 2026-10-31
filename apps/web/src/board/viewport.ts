import type { Viewport } from '@inkadra/canvas-core';

const key = (boardId: string) => `inkadra.viewport.${boardId}`;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Where this browser last looked at a board. */
export function loadViewport(boardId: string): Viewport | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(boardId)) ?? 'null');
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom > 0) return v;
  } catch {}
  return null;
}

/**
 * Remembers a viewport a moment after it stops moving. `stored` turns it into what is kept
 * when it is written (the view of the free part of the canvas, see Canvas.tsx), so a pan does
 * not measure the page every frame.
 */
export function saveViewport(
  boardId: string,
  v: Viewport,
  stored: (v: Viewport) => Viewport = (same) => same,
) {
  clearTimeout(timers.get(boardId));
  timers.set(
    boardId,
    setTimeout(() => {
      try {
        localStorage.setItem(key(boardId), JSON.stringify(stored(v)));
      } catch {}
    }, 300),
  );
}

/** A viewport moved by the part of the canvas the floating panels cover (#333). */
export function shiftViewport(v: Viewport, inset: { left: number; top: number }, sign: 1 | -1) {
  return { zoom: v.zoom, x: v.x + (sign * inset.left) / v.zoom, y: v.y + (sign * inset.top) / v.zoom };
}
