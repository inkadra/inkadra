import { useSyncExternalStore } from 'react';

/** Settings save on change; the header reports the latest outcome. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

let state: SaveState = 'idle';
let pending = 0;
const listeners = new Set<() => void>();

function set(next: SaveState) {
  state = next;
  for (const listener of listeners) listener();
}

export function useSaveState(): SaveState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

/** Runs one autosave and reflects it in the header; rethrows so callers can roll back. */
export async function trackSave<T>(work: Promise<T>): Promise<T> {
  pending += 1;
  set('saving');
  try {
    const result = await work;
    pending -= 1;
    if (pending === 0) set('saved');
    return result;
  } catch (err) {
    pending -= 1;
    set('error');
    throw err;
  }
}

export function resetSaveState() {
  pending = 0;
  set('idle');
}
