// SPDX-License-Identifier: AGPL-3.0-only
import { linkedLocation, type PlanElement, variantFamily, variantView } from '@inkadra/canvas-core';
import type { TFunction } from 'i18next';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext } from 'react-router';
import { useBoard } from '../context.ts';
import { planCounts } from './kit.ts';
import { PlanDrawing } from './PlanDrawing.tsx';
import { SceneBadges, scenesOfPlan, usePlanNav } from './scenes.tsx';
import './plan.css';
import './outputs.css';

function LinkedScenes({ scenes }: { scenes: Parameters<typeof SceneBadges>[0]['scenes'] }) {
  return <SceneBadges scenes={scenes} onOpen={usePlanNav().openScene} />;
}

/**
 * "Set plan · Kitchen, day 2": the name of a plan in the editor, the view and the export; a setup
 * adds its own, "Set plan · Kitchen, day 2 · Evening" (its title is its base's, decision 0117).
 * The base's setup name stays on its tab.
 */
export function planTitle(
  t: TFunction,
  plan: Pick<PlanElement, 'title' | 'variant' | 'variantOf'>,
): string {
  return [t('board.plan.name'), plan.title, plan.variantOf ? plan.variant : '']
    .filter(Boolean)
    .join(' · ');
}

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
  const byId = snapshot.byId;
  // The base of a variant is another card: follow it, so a wall moved there moves here.
  const baseEl = element.variantOf ? byId.get(element.variantOf) : undefined;
  const base = baseEl?.type === 'plan' ? baseEl : undefined;
  const plan = base ? variantView(element, base) : element;
  const scenes = scenesOfPlan(element.sceneIds ? element : (base ?? element), byId);
  const family = variantFamily(byId.values(), element);
  const { cameras, lights, watts } = planCounts(plan);
  const place = linkedLocation(base ?? element, byId)?.name;
  // The title is the base's, shown by every setup (decision 0117).
  const name = (base ? base.title : element.title) || place || t('board.plan.name');
  const kw =
    watts >= 1000
      ? `${(watts / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} kW`
      : `${watts} W`;
  const chips = [
    family.length > 1 ? t('board.plan.card.setups', { count: family.length }) : '',
    cameras ? t('board.plan.card.cameras', { count: cameras }) : '',
    lights
      ? [t('board.plan.card.lights', { count: lights }), watts > 0 ? kw : '']
          .filter(Boolean)
          .join(' · ')
      : '',
  ].filter(Boolean);
  return (
    <div className="plan plan--card">
      <div className="plan__body card__media">
        <PlanDrawing plan={plan} background />
      </div>
      <div className="plan__foot">
        <div className="plan__head">
          <span className="plan__title">
            {element.variantOf && element.variant ? `${name} · ${element.variant}` : name}
          </span>
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
