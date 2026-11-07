import { useSyncExternalStore } from 'react';
import { getPreferences, updatePreferences } from '../lib/preferences.ts';

/**
 * What the tutorials remember (#502). A signed-in person's seen tours and hints switch are
 * preferences, so they follow the account; a guest of a link has only this browser.
 */

/** Marks a tour finished or skipped, at once and on the account. */
export function markSeen(id: string) {
  const seen = getPreferences().tutorialsSeen;
  if (seen.includes(id)) return;
  // The contract keeps 100 ids: the oldest go first.
  void updatePreferences({ tutorialsSeen: [...seen, id].slice(-100) }).catch(() => {});
}

/** Every tour to see again. */
export function resetSeen() {
  void updatePreferences({ tutorialsSeen: [] }).catch(() => {});
}

const GUEST_KEY = 'inkadra.tutorial.guest';
// shortcut: a guest's seen state lives in this browser only (no account); a guest who switches
// browser sees the pill once more. Upgrade if links ever get a guest profile on the server.
export function guestSeen(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === 'seen';
  } catch {
    return false;
  }
}
export function markGuestSeen() {
  try {
    localStorage.setItem(GUEST_KEY, 'seen');
  } catch {
    // Private mode: the pill comes back next time, nothing else is lost.
  }
}

/**
 * Whether tutorials offer themselves (welcome, pills). Browsers driven by tests
 * (`navigator.webdriver`) get none unless the page asks with `inkadra.tutorials = on`, so the
 * end-to-end suites keep their screens; replays from Settings always work.
 */
export function autoOffers(): boolean {
  try {
    if (localStorage.getItem('inkadra.tutorials') === 'on') return true;
  } catch {
    // No storage: decide on the browser alone.
  }
  return !navigator.webdriver;
}

/** A tour asked for from elsewhere (Settings), played by the host on the app's page. */
let requested: string | null = null;
const listeners = new Set<() => void>();

export function requestTour(id: string | null) {
  requested = id;
  for (const listener of listeners) listener();
}

export function useRequestedTour(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => requested,
    () => requested,
  );
}
