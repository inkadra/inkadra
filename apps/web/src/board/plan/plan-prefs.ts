// SPDX-License-Identifier: AGPL-3.0-only
import type { UserPreferences } from '@inkadra/shared';
import { useCallback, useSyncExternalStore } from 'react';
import { RequestError } from '../../lib/api.ts';
import { onSignedInChange, signedInId } from '../../lib/me.ts';
import {
  getPreferences,
  preferencesLoaded,
  savePreferencesOnLeave,
  updatePreferences,
  usePreferences,
} from '../../lib/preferences.ts';

type PlanPref = 'planSnap' | 'planAttach' | 'planGhosts' | 'planHidden' | 'planShelf';

/**
 * The choices made this session and not (yet) on the server, by key, with the person they
 * belong to (decision 0119): another person signing in on the tab, or nobody, empties it and
 * cancels its saves, so one person's choice is never shown to, nor saved for, another.
 */
const session = new Map<PlanPref, unknown>();
const timers = new Map<PlanPref, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
/** Quick changes (a key held, a run of clicks) are saved once they settle, ms. */
const SAVE_AFTER = 400;

const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Forgets the session's choices and their pending saves. */
export function resetPlanPrefs() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  session.clear();
  emit();
}
onSignedInChange(resetPlanPrefs);

/** The pending changes, written now with a request that outlives the page. */
function flush() {
  if (!timers.size || !signedInId()) return;
  const patch: Record<string, unknown> = {};
  for (const [key, t] of timers) {
    clearTimeout(t);
    patch[key] = session.get(key);
  }
  timers.clear();
  savePreferencesOnLeave(patch as Partial<UserPreferences>);
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);

/** Saves the session's value of `key` for `owner`, once quick changes have settled. */
function save(key: PlanPref, owner: string) {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      // Someone else signed in meanwhile: their account never gets this person's choice.
      if (signedInId() !== owner) return;
      const value = session.get(key);
      void updatePreferences({ [key]: value } as Partial<UserPreferences>).then(
        () => {
          // Saved: the account's value shows from now on, unless a newer choice is pending.
          if (session.get(key) === value && !timers.has(key)) {
            session.delete(key);
            emit();
          }
        },
        (err) => {
          // The server answered no (an invalid value, the session gone): the choice is dropped,
          // never kept and sent again. A network failure keeps it for this session, as the
          // app's other preferences keep nothing either (lib/preferences.ts rolls back).
          if (err instanceof RequestError && session.get(key) === value && !timers.has(key)) {
            session.delete(key);
            emit();
          }
        },
      );
    }, SAVE_AFTER),
  );
}

/**
 * A personal choice of the set plan editor (decision 0119, Matteo's rule of 2026-11-11): kept in
 * the account's preferences on the server, so it survives a reload and is the same on every
 * device, as `shotGroupBy` is. Someone without an account (a guest of a share link) keeps it for
 * the page's session only, with no request. Quick changes are saved once, after they settle, and
 * at once when the page goes away. The setter takes a value or a function of the current one.
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
      const owner = signedInId();
      if (owner && preferencesLoaded()) save(key, owner);
    },
    [key],
  );
  return [here === undefined ? saved : here, choose];
}
