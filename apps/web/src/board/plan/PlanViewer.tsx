// SPDX-License-Identifier: AGPL-3.0-only
import { type PlanElement, variantView } from '@inkadra/canvas-core';
import { IconButton } from '@inkadra/ui';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { planTitle } from './PlanCard.tsx';
import { PlanDrawing } from './PlanDrawing.tsx';
import './plan.css';

const ZOOMS = [50, 75, 100, 150, 200, 300];

/** A set plan for who cannot edit it, guests first: the drawing and its zoom, nothing else. */
export function PlanViewer({
  plan,
  base,
  phone,
  onClose,
}: {
  plan: PlanElement;
  base?: PlanElement | undefined;
  phone: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(100);
  const at = ZOOMS.indexOf(zoom);
  const close = (
    <button type="button" className="plan-editor__done" onClick={onClose}>
      {t('viewer.close')}
    </button>
  );
  const body = (
    <>
      <div className="plan-viewer__scroll">
        <div
          className="plan-viewer__sheet"
          style={{ width: `calc(min(100cqw, 150cqh) * ${zoom / 100})` }}
        >
          <PlanDrawing plan={variantView(plan, base)} background />
        </div>
      </div>
      <div className="plan-viewer__bar" role="toolbar" aria-label={t('board.plan.name')}>
        <IconButton
          icon="minus"
          label={t('board.plan.zoomOut')}
          disabled={at === 0}
          onClick={() => setZoom(ZOOMS[at - 1] as number)}
        />
        <button
          type="button"
          className="plan-editor__lens plan-viewer__zoom"
          onClick={() => setZoom(100)}
        >
          {zoom}%
        </button>
        <IconButton
          icon="plus"
          label={t('board.plan.zoomIn')}
          disabled={at === ZOOMS.length - 1}
          onClick={() => setZoom(ZOOMS[at + 1] as number)}
        />
        <span className="plan-editor__vr" aria-hidden="true" />
        {close}
      </div>
    </>
  );
  const dialog = {
    role: 'dialog',
    'aria-modal': true,
    'aria-label': planTitle(t, plan),
    onKeyDown: (e: { key: string }) => e.key === 'Escape' && onClose(),
  } as const;
  return createPortal(
    phone ? (
      <div className="plan-editor plan-editor--phone" data-chrome="" {...dialog}>
        {body}
      </div>
    ) : (
      <div className="plan-editor" data-chrome="">
        <div className="plan-editor__backdrop" aria-hidden="true" onPointerDown={onClose} />
        <div className="plan-editor__window ink-motion-rise" {...dialog}>
          <header className="plan-editor__head">
            <span className="plan-editor__name">{planTitle(t, plan)}</span>
          </header>
          {body}
        </div>
      </div>
    ),
    document.body,
  );
}
