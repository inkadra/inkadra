// SPDX-License-Identifier: AGPL-3.0-only
import { type PlanElement, variantView } from '@inkadra/canvas-core';
import { Icon } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext } from 'react-router';
import { useBoard } from '../context.ts';
import { PlanDrawing } from './PlanDrawing.tsx';
import { SceneBadges, scenesOfPlan, usePlanNav } from './scenes.tsx';
import './plan.css';

function LinkedScenes({ scenes }: { scenes: Parameters<typeof SceneBadges>[0]['scenes'] }) {
  return <SceneBadges scenes={scenes} onOpen={usePlanNav().openScene} />;
}

/** "Set plan · Kitchen, day 2": the header of a plan, on the board and in the editor. */
export function planTitle(t: TFunction, plan: Pick<PlanElement, 'title' | 'variant'>): string {
  // A variant reads "Kitchen · Evening", as its tab does.
  if (plan.variant) return `${plan.title || t('board.plan.name')} · ${plan.variant}`;
  return plan.title ? `${t('board.plan.name')} · ${plan.title}` : t('board.plan.name');
}

/**
 * A set plan on the board (#335): its title over the drawing, without the grid, so it reads
 * as a clean diagram next to the references. Double click (or Enter) edits it.
 */
export function PlanCard({ element }: { element: PlanElement }) {
  const { t } = useTranslation();
  const { store } = useBoard();
  const byId = store.getSnapshot().byId;
  const scenes = scenesOfPlan(element, byId);
  // The base of a variant is another card: follow it, so a wall moved there moves here.
  const base = useSyncExternalStore(store.subscribe, () =>
    element.variantOf ? store.getSnapshot().byId.get(element.variantOf) : undefined,
  );
  return (
    <div className="plan">
      <div className="plan__head">
        <Icon name="map" size={14} />
        <span className="plan__title">{planTitle(t, element)}</span>
        {useInRouterContext() ? <LinkedScenes scenes={scenes} /> : <SceneBadges scenes={scenes} />}
      </div>
      <div className="plan__body card__media">
        <PlanDrawing plan={base?.type === 'plan' ? variantView(element, base) : element} />
      </div>
    </div>
  );
}
