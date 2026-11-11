// SPDX-License-Identifier: AGPL-3.0-only
import {
  catalogueKind,
  isLight,
  layerOf,
  linkedLocation,
  type PlanElement,
  planPower,
  variantFamily,
  variantView,
} from '@inkadra/canvas-core';
import type { TFunction } from 'i18next';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext } from 'react-router';
import { useBoard } from '../context.ts';
import { PlanDrawing } from './PlanDrawing.tsx';
import { SceneBadges, scenesOfPlan, usePlanNav } from './scenes.tsx';
import './plan.css';
import './outputs.css';

function LinkedScenes({ scenes }: { scenes: Parameters<typeof SceneBadges>[0]['scenes'] }) {
  return <SceneBadges scenes={scenes} onOpen={usePlanNav().openScene} />;
}

/** "Set plan · Kitchen, day 2": the header of a plan, on the board and in the editor. */
export function planTitle(
  t: TFunction,
  plan: Pick<PlanElement, 'title' | 'variant' | 'variantOf'>,
): string {
  // A variant reads "Kitchen · Evening", as its tab does; the base's setup name stays on its tab.
  if (plan.variantOf && plan.variant) return `${plan.title || t('board.plan.name')} · ${plan.variant}`;
  return plan.title ? `${t('board.plan.name')} · ${plan.title}` : t('board.plan.name');
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
  const icons = (plan.icons ?? []).filter((i) => !plan.hiddenLayers?.includes(layerOf(i)));
  const cameras = icons.filter((i) => catalogueKind(i.kind) === 'camera').length;
  const lights = icons.filter((i) => isLight(i.kind) && !i.on).length;
  const watts = planPower(plan).watts;
  const place = linkedLocation(base ?? element, byId)?.name;
  // The title is the base's, shown by every setup (decision 0116).
  const name = base?.title || element.title || place || t('board.plan.name');
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
        <PlanDrawing plan={plan} />
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
