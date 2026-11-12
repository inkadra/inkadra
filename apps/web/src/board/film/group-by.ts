// SPDX-License-Identifier: AGPL-3.0-only
import type { UserPreferences } from '@inkadra/shared';
import { useCallback, useState } from 'react';
import { updatePreferences, usePreferences } from '../../lib/preferences.ts';

export type ShotGroupBy = UserPreferences['shotGroupBy'];

/**
 * How this person groups shots, one choice for the shot list and the schedule (decision 0115):
 * kept in the account's preferences on the server, so it follows them across views, boards and
 * devices. When the server does not take it (offline, no account) it lasts for the page.
 */
export function useShotGroupBy(): [ShotGroupBy, (next: ShotGroupBy) => void] {
  const saved = usePreferences().shotGroupBy;
  const [here, setHere] = useState<ShotGroupBy | null>(null);
  const choose = useCallback((next: ShotGroupBy) => {
    setHere(next);
    void updatePreferences({ shotGroupBy: next }).then(
      () => setHere(null),
      () => {},
    );
  }, []);
  return [here ?? saved, choose];
}
