// SPDX-License-Identifier: AGPL-3.0-only
import type { UserPreferences } from '@inkadra/shared';
import { useCallback, useRef, useState } from 'react';
import { getPreferences, updatePreferences, usePreferences } from '../../lib/preferences.ts';

type PlanPref = 'planSnap' | 'planAttach' | 'planGhosts' | 'planHidden' | 'planShelf';

/**
 * A personal choice of the set plan editor kept in the account's preferences on the server
 * (decision 0119, Matteo's rule of 2026-11-11), so it survives a reload and is the same on every
 * device, as `shotGroupBy` is. When the server does not take it (offline, a guest) it lasts for
 * the page. The setter takes a value or a function of the current one.
 */
export function usePlanPref<K extends PlanPref>(
  key: K,
): [
  UserPreferences[K],
  (next: UserPreferences[K] | ((now: UserPreferences[K]) => UserPreferences[K])) => void,
] {
  const saved = usePreferences()[key];
  const [here, setHereState] = useState<UserPreferences[K] | null>(null);
  const hereRef = useRef<UserPreferences[K] | null>(null);
  const setHere = (v: UserPreferences[K] | null) => {
    hereRef.current = v;
    setHereState(v);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: setHere writes refs and state only.
  const choose = useCallback(
    (next: UserPreferences[K] | ((now: UserPreferences[K]) => UserPreferences[K])) => {
      const now = hereRef.current ?? getPreferences()[key];
      const value =
        typeof next === 'function'
          ? (next as (now: UserPreferences[K]) => UserPreferences[K])(now)
          : next;
      setHere(value);
      void updatePreferences({ [key]: value } as Partial<UserPreferences>).then(
        () => {
          if (hereRef.current === value) setHere(null);
        },
        () => {},
      );
    },
    [key],
  );
  return [here ?? saved, choose];
}
