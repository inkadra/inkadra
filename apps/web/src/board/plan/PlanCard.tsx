// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanElement } from '@inkadra/canvas-core';
import { Icon } from '@inkadra/ui';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { PlanDrawing } from './PlanDrawing.tsx';
import './plan.css';

/** "Set plan · Kitchen, day 2": the header of a plan, on the board and in the editor. */
export function planTitle(t: TFunction, plan: Pick<PlanElement, 'title'>): string {
  return plan.title ? `${t('board.plan.name')} · ${plan.title}` : t('board.plan.name');
}

/**
 * A set plan on the board (#335): its title over the drawing, without the grid, so it reads
 * as a clean diagram next to the references. Double click (or Enter) edits it.
 */
export function PlanCard({ element }: { element: PlanElement }) {
  const { t } = useTranslation();
  return (
    <div className="plan">
      <div className="plan__head">
        <Icon name="map" size={14} />
        <span className="plan__title">{planTitle(t, element)}</span>
      </div>
      <div className="plan__body card__media">
        <PlanDrawing plan={element} />
      </div>
    </div>
  );
}
