import type { TidyGap } from '@inkadra/canvas-core';

/**
 * Canvas preferences of one person on one device (#296, #320): kept in local storage, never in
 * the board document, so they do not change the board for collaborators.
 */
const SNAP_KEY = 'inkadra.canvas.snapToGrid';

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

/** Whether cards snap to the dot grid; off until the person turns the magnet on. */
export function loadSnapToGrid(userId: string): boolean {
  return read(own(SNAP_KEY, userId)) === '1';
}

export function saveSnapToGrid(userId: string, on: boolean) {
  write(own(SNAP_KEY, userId), on ? '1' : '0');
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
