// SPDX-License-Identifier: AGPL-3.0-only
import {
  gridStep,
  legendRow,
  linkedLocation,
  type PlanElement,
  planContentBox,
  planLegend,
  variantView,
} from '@inkadra/canvas-core';
import type { PlanIcon } from '@inkadra/doc-schema';
import { Button, Icon, IconButton } from '@inkadra/ui';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Toast } from '../Toast.tsx';
import { ExportCache } from '../export/cache.ts';
import type { ExportEnv } from '../export/engine.ts';
import { sheetInclude } from '../export/plan-sheet.ts';
import type { BoardStore } from '../store.ts';
import { foldIcons } from './elements.ts';
import { kitList, powerLines } from './kit.ts';
import { planTitle } from './PlanCard.tsx';
import {
  PlanDrawing,
  PlanGlyph,
  planCss,
  useLinkedPlan,
  useRoomSizeWords,
} from './PlanDrawing.tsx';
import { downloadPlanSheet, planSheetEnv, planSheetRequest } from './PlanExport.tsx';
import { setupName } from './PlanKit.tsx';
import { usePlanSurface } from './PlanSurface.tsx';
import { useModalInert } from './useModalInert.ts';
import './plan.css';
import './outputs.css';

/** The legend of the view: cameras, lights and cast, each with its glyph and a line. */
function Legend({ plan, guest }: { plan: PlanElement; guest: boolean }) {
  const { t, i18n } = useTranslation();
  const { icons, cameras, lights, cast } = planLegend(plan);
  const groups: Array<[string, PlanIcon[]]> = [
    [t('board.plan.sheet.cameras'), cameras],
    [t('board.plan.sheet.lights'), lights],
    [t('board.plan.sheet.cast'), cast],
  ];
  const kit = kitList(plan, t, i18n.language);
  const power = powerLines(plan, t, i18n.language);
  return (
    <aside className="plan-view__legend" aria-label={t('board.plan.view.legend')}>
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title} className="plan-view__group">
            <h3 className="plan-props__cap">{title}</h3>
            <ul>
              {foldIcons(list, icons).map(({ icon, count }) => {
                const { name, sub } = legendRow(icon, count, icons, t, {
                  scale: plan.scale,
                  locale: i18n.language,
                });
                return (
                  <li key={icon.id} className="plan-view__item">
                    <span style={{ color: planCss(icon.color) }}>
                      <PlanGlyph kind={icon.kind} size={24} />
                    </span>
                    <span className="plan-props__name">
                      <span>{name}</span>
                      {sub && <small>{sub}</small>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
      {kit.length > 0 && (
        <section className="plan-view__group">
          <h3 className="plan-props__cap">{t('board.plan.tabs2.kit')}</h3>
          <ul>
            {kit.map((l) => (
              <li key={l.key} className="plan-view__row">
                <span>{l.name}</span>
                <span className="plan-view__n">×{l.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {power && (
        <section className="plan-view__group plan-view__power">
          <div className="plan-view__row">
            <h3 className="plan-props__cap">{power.title}</h3>
            <span className="plan-view__n">{power.total}</span>
          </div>
          <ul>
            {power.rows.map((r) => (
              <li key={r.text} className={`plan-view__row is-${r.status}`}>
                <span>{r.text}</span>
                <span className="plan-view__n">{r.amps}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="plan-props__hint">
        {t(guest ? 'board.plan.view.guestNote' : 'board.plan.view.note')}
      </p>
    </aside>
  );
}

/**
 * A set plan for who cannot edit it, guests first (decision 0111, the mockup's Viewing): the
 * drawing with pan and zoom, the setups as tabs, the legend of cameras, lights and cast with the
 * kit and the power per circuit (guests see what the plan shows, decision 0062), and the PDF.
 */
export function PlanViewer({
  plan,
  base,
  family,
  phone,
  guest = false,
  store,
  scope,
  onSwitch,
  onClose,
}: {
  plan: PlanElement;
  base?: PlanElement | undefined;
  /** The base and its setups, for the tabs. */
  family?: readonly PlanElement[];
  phone: boolean;
  guest?: boolean;
  store?: BoardStore;
  /** The project and board, for the sheet's "Day N"; none for a guest or a preview. */
  scope?: ExportEnv['scope'];
  onSwitch?: (id: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cache] = useState(() => new ExportCache());
  const shown = useLinkedPlan(variantView(plan, base));
  // The same surface as the editor's (decision 0118): the dots, pan and zoom, Fit on the content.
  const roomSize = useRoomSizeWords();
  const content = useMemo(() => planContentBox(shown, roomSize), [shown, roomSize]);
  const surface = usePlanSurface({
    content,
    insets: { top: 8, right: 8, bottom: 56, left: 8 },
    grid: gridStep(shown),
  });
  const tabs = family?.length ? family : [plan];
  const place = store ? linkedLocation(base ?? plan, store.getSnapshot().byId)?.name : undefined;
  // The view is a modal: the app behind is inert, it takes the focus for its keys.
  const root = useRef<HTMLDivElement>(null);
  useModalInert(root);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The zoom bar sits on the stage: its buttons keep their clicks.
    if ((e.target as Element).closest('.plan-view__bar')) return;
    if (!surface.down(e)) surface.startPan(e);
  };
  const closeFailed = useCallback(() => setFailed(false), []);
  const pdf = async () => {
    if (!store) return;
    setBusy(true);
    setFailed(false);
    try {
      await downloadPlanSheet(
        planSheetRequest('pdf', [plan.id], null, sheetInclude(shown), guest),
        planSheetEnv(store, shown, t, i18n.language, cache, scope),
      );
    } catch {
      // A network, font or chunk failure: say so, as the export does (#829).
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={root}
      tabIndex={-1}
      className={`plan-editor plan-view${phone ? ' plan-view--phone' : ''}`}
      data-chrome=""
      role="dialog"
      aria-modal="true"
      aria-label={planTitle(t, shown)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else if (e.key === '+' || e.key === '=') surface.zoomBy(1);
        else if (e.key === '-') surface.zoomBy(-1);
        else if (e.key === '0' || (e.shiftKey && e.code === 'Digit1')) surface.fit();
        else if (e.key.startsWith('Arrow')) {
          const d = 40;
          surface.panBy(
            e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0,
            e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0,
          );
        }
      }}
    >
      <header className="plan-top plan-view__top">
        <div className="plan-top__start">
          <b className="plan-top__name">{t('board.plan.name')}</b>
          {!phone && <span className="plan-view__title">{place || shown.title}</span>}
          <span className="plan-view__only">
            <Icon name="eye" size={13} />
            {t('board.plan.view.only')}
          </span>
        </div>
        {tabs.length > 1 && (
          <div className="plan-setups" role="tablist" aria-label={t('board.plan.setups')}>
            {tabs.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                className="plan-setups__tab"
                aria-selected={p.id === plan.id}
                tabIndex={p.id === plan.id ? 0 : -1}
                onClick={() => p.id !== plan.id && onSwitch?.(p.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const i =
                    tabs.findIndex((f) => f.id === p.id) + (e.key === 'ArrowRight' ? 1 : -1);
                  const next = tabs[(i + tabs.length) % tabs.length];
                  if (next && next.id !== plan.id) onSwitch?.(next.id);
                }}
              >
                {setupName(p, tabs, t)}
              </button>
            ))}
          </div>
        )}
        <div className="plan-top__end">
          {store && (
            <Button icon="download" disabled={busy} onClick={pdf} data-tour="plan-view-pdf">
              PDF
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('viewer.close')}
          </Button>
        </div>
      </header>
      <div className="plan-view__body">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging pans; the keys and the bar do it too. */}
        <div
          ref={surface.surface}
          className="plan-view__stage plan-canvas__surface"
          onPointerDown={down}
          onPointerMove={(e) => surface.moveTo(e)}
          onPointerUp={(e) => surface.up(e)}
          onPointerCancel={(e) => surface.up(e)}
        >
          <div ref={surface.stage} className="plan-view__sheet">
            <PlanDrawing plan={shown} background extent />
          </div>
          <div className="plan-view__bar" role="toolbar" aria-label={t('board.plan.name')}>
            <IconButton
              icon="minus"
              label={t('board.plan.zoomOut')}
              disabled={!surface.canZoomOut}
              onClick={() => surface.zoomBy(-1)}
            />
            <button
              type="button"
              className="plan-editor__lens plan-viewer__zoom"
              // The name holds the percent it shows (WCAG 2.5.3).
              aria-label={t('board.plan.zoomFitAt', { percent: surface.percent })}
              onClick={surface.fit}
            >
              {surface.percent}%
            </button>
            <IconButton
              icon="plus"
              label={t('board.plan.zoomIn')}
              disabled={!surface.canZoomIn}
              onClick={() => surface.zoomBy(1)}
            />
            {!phone && <span className="plan-view__hint">{t('board.plan.view.hint')}</span>}
          </div>
        </div>
        <Legend plan={shown} guest={guest} />
      </div>
      {failed && <Toast text={t('export.failed')} error onClose={closeFailed} />}
    </div>,
    document.body,
  );
}
