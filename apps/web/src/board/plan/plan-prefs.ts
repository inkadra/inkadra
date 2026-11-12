// SPDX-License-Identifier: AGPL-3.0-only
import type { UserPreferences } from '@inkadra/shared';
import { useCallback, useSyncExternalStore } from 'react';
import {
  getPreferences,
  preferencesLoaded,
  updatePreferences,
  usePreferences,
} from '../../lib/preferences.ts';

type PlanPref = 'planSnap' | 'planAttach' | 'planGhosts' | 'planHidden' | 'planShelf';

/** A choice made this session and not yet (or never) on the server, by key. */
const session = new Map<PlanPref, unknown>();
const listeners = new Set<() => void>();
const timers = new Map<PlanPref, ReturnType<typeof setTimeout>>();
/** Quick changes (a key held, a run of clicks) are saved once they settle, ms. */
const SAVE_AFTER = 400;

const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Saves the session's value of `key` to the account, once quick changes have settled. */
function save(key: PlanPref) {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const value = session.get(key);
      void updatePreferences({ [key]: value } as Partial<UserPreferences>).then(
        () => {
          // Saved: the account's value shows from now on, unless a newer choice is pending.
          if (session.get(key) === value && !timers.has(key)) {
            session.delete(key);
            emit();
          }
        },
        // Refused (offline, the session ended): the choice stays for this session, as the
        // app's other preferences do not retry either (lib/preferences.ts rolls back).
        () => {},
      );
    }, SAVE_AFTER),
  );
}

/**
 * A personal choice of the set plan editor (decision 0119, Matteo's rule of 2026-11-11): kept in
 * the account's preferences on the server, so it survives a reload and is the same on every
 * device, as `shotGroupBy` is. Someone without an account (a guest of a share link) keeps it for
 * the page's session only, with no request; when a save fails it also stays for the session. The
 * session's value is kept outside the editor, so closing it or changing setup keeps the choice.
 * Quick changes are saved once, after they settle. The setter takes a value or a function of the
 * current one.
 */
export function usePlanPref<K extends PlanPref>(
  key: K,
): [
  UserPreferences[K],
  (next: UserPreferences[K] | ((now: UserPreferences[K]) => UserPreferences[K])) => void,
] {
  const saved = usePreferences()[key];
  const here = useSyncExternalStore(subscribe, () => session.get(key)) as
    | UserPreferences[K]
    | undefined;
  const choose = useCallback(
    (next: UserPreferences[K] | ((now: UserPreferences[K]) => UserPreferences[K])) => {
      const now = (
        session.has(key) ? session.get(key) : getPreferences()[key]
      ) as UserPreferences[K];
      const value =
        typeof next === 'function'
          ? (next as (now: UserPreferences[K]) => UserPreferences[K])(now)
          : next;
      session.set(key, value);
      emit();
      // No account read this session (a guest, or signed out): nothing to save it to.
      if (preferencesLoaded()) save(key);
    },
    [key],
  );
  return [here === undefined ? saved : here, choose];
}

/** Forgets the session's choices; for tests. */
export function resetPlanPrefs() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  session.clear();
  emit();
}
