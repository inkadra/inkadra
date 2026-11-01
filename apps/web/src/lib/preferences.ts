import {
  readUserPreferences,
  type UpdateUserPreferences,
  type UserPreferences,
} from '@inkadra/shared';
import { useSyncExternalStore } from 'react';
import { api } from './api.ts';

/**
 * Personal preferences (#302), kept on the account so they follow the person across devices.
 * The last ones read are cached here so a board opens with them before the server answers.
 */
const CACHE = 'inkadra.preferences';

function cached(): UserPreferences {
  try {
    return readUserPreferences(JSON.parse(localStorage.getItem(CACHE) ?? 'null'));
  } catch {
    return readUserPreferences(null);
  }
}

let current = cached();
const listeners = new Set<() => void>();

function set(next: UserPreferences) {
  current = next;
  try {
    localStorage.setItem(CACHE, JSON.stringify(next));
  } catch {
    // Private mode: the account still has them.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function getPreferences(): UserPreferences {
  return current;
}

export function usePreferences(): UserPreferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

/** Reads the signed-in person's preferences; called with the session. */
export async function loadPreferences() {
  set(readUserPreferences(await api.get<UserPreferences>('/me/preferences')));
}

/** Applies a change at once and saves it; a failed save puts the previous value back. */
export async function updatePreferences(patch: UpdateUserPreferences) {
  const previous = current;
  set({ ...current, ...patch });
  try {
    set(readUserPreferences(await api.patch<UserPreferences>('/me/preferences', patch)));
  } catch (err) {
    set(previous);
    throw err;
  }
}
