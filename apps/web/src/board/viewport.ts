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

export function saveViewport(boardId: string, v: Viewport) {
  clearTimeout(timers.get(boardId));
  timers.set(
    boardId,
    setTimeout(() => {
      try {
        localStorage.setItem(key(boardId), JSON.stringify(v));
      } catch {}
    }, 300),
  );
}
