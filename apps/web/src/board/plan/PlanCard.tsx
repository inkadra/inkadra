// SPDX-License-Identifier: AGPL-3.0-only
import { type PlanElement, planCardWords, planTitle } from '@inkadra/canvas-core';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext } from 'react-router';
import { useBoard } from '../context.ts';
import { PlanDrawing } from './PlanDrawing.tsx';
import { SceneBadges, usePlanNav } from './scenes.tsx';
import './plan.css';
import './outputs.css';

function LinkedScenes({ scenes }: { scenes: Parameters<typeof SceneBadges>[0]['scenes'] }) {
  return <SceneBadges scenes={scenes} onOpen={usePlanNav().openScene} />;
}

/** The title and the words of a plan's card live in canvas-core (decision 0116). */
export { planCardWords, planTitle };

/**
 * A set plan on the board (#335, decision 0111): its drawing without the grid, then its name
 * (the title, else the linked location) with the chips of its scenes, and the counts of its
 * setups, cameras and lights with the power they draw. Double click (or Enter) edits it; a guest
 * opens the read-only view.
 */
export function PlanCard({ element }: { element: PlanElement }) {
  const { t, i18n } = useTranslation();
  const { store } = useBoard();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { plan, scenes, title, chips } = planCardWords(element, snapshot.byId, t, i18n.language);
  return (
    <div className="plan plan--card">
      <div className="plan__body card__media">
        <PlanDrawing plan={plan} background />
      </div>
      <div className="plan__foot">
        <div className="plan__head">
          <span className="plan__title">{title}</span>
          {useInRouterContext() ? (
            <LinkedScenes scenes={scenes} />
          ) : (
            <SceneBadges scenes={scenes} />
          )}
        </div>
        {chips.length > 0 && (
          <div className="plan__chips">
            {chips.map((c) => (
              <span key={c} className="plan__count">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
