import type { TidyGap } from '@inkadra/canvas-core';

/**
 * Canvas choices of one person on one device (#302, #320): kept in local storage, never in the
 * board document, so they do not change the board for collaborators. The defaults that follow
 * the person across devices are in their preferences (lib/preferences.ts).
 */
const GRID_KEY = 'inkadra.canvas.dotGrid';

const own = (key: string, userId: string) => `${key}.${userId}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/**
 * Whether this person shows the dot grid on this board, chosen from the canvas menu; null
 * follows their preference (#302), which is on unless they turned it off.
 */
export function loadBoardGrid(userId: string, boardId: string): boolean | null {
  const value = read(`${own(GRID_KEY, userId)}.${boardId}`);
  return value === '1' ? true : value === '0' ? false : null;
}

export function saveBoardGrid(userId: string, boardId: string, on: boolean) {
  write(`${own(GRID_KEY, userId)}.${boardId}`, on ? '1' : '0');
}

const GAP_KEY = 'inkadra.canvas.tidyGap';

/** Gap of the Arrange menu's tidy-up commands (#320): S, M or L, M until chosen. */
export function loadTidyGap(userId: string): TidyGap {
  const value = read(own(GAP_KEY, userId));
  return value === 's' || value === 'l' ? value : 'm';
}

export function saveTidyGap(userId: string, gap: TidyGap) {
  write(own(GAP_KEY, userId), gap);
}
