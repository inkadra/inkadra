import {
  readUserPreferences,
  type UpdateUserPreferences,
  type UserPreferences,
} from '@inkadra/shared';
import { API_PREFIX } from '@inkadra/shared/constants';
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
/** Whether the account's preferences have been read this session, not only the cache. */
let loaded = false;
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

export function preferencesLoaded(): boolean {
  return loaded;
}

export function usePreferences(): UserPreferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

/** Reads the signed-in person's preferences; called with the session. */
export async function loadPreferences() {
  const read = readUserPreferences(await api.get<UserPreferences>('/me/preferences'));
  loaded = true;
  set(read);
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

/**
 * Saves a change while the page goes away (`pagehide`): a request that outlives the page
 * (`keepalive`), with nothing to wait for or roll back. The cache keeps the value for this device.
 */
export function savePreferencesOnLeave(patch: UpdateUserPreferences) {
  set({ ...current, ...patch });
  try {
    void fetch(`${API_PREFIX}/me/preferences`, {
      method: 'PATCH',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {});
  } catch {
    // No fetch while the page unloads: the choice stays in this device's cache.
  }
}
