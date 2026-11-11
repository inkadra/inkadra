// SPDX-License-Identifier: AGPL-3.0-only
import { Icon } from '@inkadra/ui';
import { useTranslation } from 'react-i18next';
import type { ShotSetup } from './setups.ts';
import './links.css';

/**
 * The setups of the set plans a shot belongs to, as small chips: "1 · Master" (decision 0104).
 * Nothing for a shot no camera of a plan links to.
 */
export function SetupChips({ setups }: { setups: readonly ShotSetup[] | undefined }) {
  const { t } = useTranslation();
  if (!setups?.length) return null;
  return (
    <span className="plan-links__setups">
      {setups.map((s) => (
        <span
          key={s.planId}
          className="plan-links__setup"
          title={t('film.list.inSetup', { setup: `${s.plan} · ${s.name}` })}
        >
          <Icon name="map" size={11} />
          {s.name}
        </span>
      ))}
    </span>
  );
}
