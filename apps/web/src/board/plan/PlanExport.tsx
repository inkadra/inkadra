// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanElement } from '@inkadra/canvas-core';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  type DialogHandle,
  IconButton,
  Segmented,
} from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportCache } from '../export/cache.ts';
import type { ExportEnv, ExportFormat, ExportRequest } from '../export/engine.ts';
import { type PlanSheetInclude, sheetInclude } from '../export/plan-sheet.ts';
import type { BoardStore } from '../store.ts';
import { planTitle } from './PlanCard.tsx';
import './outputs.css';

const engine = () => import('../export/engine.ts');

type Area = { x: number; y: number; w: number; h: number };

/** The part of the drawing on screen, in view units, read from the editor's layout. */
export function visibleArea(root: ParentNode, viewW: number, viewH: number): Area | null {
  const viewport = root.querySelector('.plan-main__canvas')?.getBoundingClientRect();
  const sheet = root.querySelector('.plan-main__canvas .plan__svg')?.getBoundingClientRect();
  if (!viewport || !sheet || sheet.width <= 0 || sheet.height <= 0) return null;
  // In the drawing's units, beyond its old extent too (decision 0117).
  const x0 = ((viewport.left - sheet.left) / sheet.width) * viewW;
  const y0 = ((viewport.top - sheet.top) / sheet.height) * viewH;
  const x1 = ((viewport.right - sheet.left) / sheet.width) * viewW;
  const y1 = ((viewport.bottom - sheet.top) / sheet.height) * viewH;
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** What a set plan sheet needs of the editor or of the read-only view. */
export function planSheetRequest(
  format: ExportFormat,
  planIds: readonly string[],
  area: Area | null,
  include: PlanSheetInclude,
  guest: boolean,
): ExportRequest {
  return {
    format,
    what: 'setplan',
    paper: 'a4',
    orientation: 'landscape',
    framesPerPage: 1,
    titlePage: false,
    logo: null,
    comments: false,
    audience: guest ? 'client' : 'team',
    hideGuestHidden: guest,
    approvedOnly: false,
    callSheet: false,
    setPlan: { planIds, area, include },
  };
}

export function planSheetEnv(
  store: BoardStore,
  plan: PlanElement,
  t: ExportEnv['t'],
  language: string,
  cache: ExportCache,
): ExportEnv {
  return {
    store,
    selection: new Set(),
    visible: null,
    projectName: '',
    boardTitle: planTitle(t, plan),
    boards: null,
    threads: [],
    t,
    language,
    cache,
  };
}

/** Downloads the sheet of a set plan: from the read-only view's PDF button. */
export async function downloadPlanSheet(req: ExportRequest, env: ExportEnv) {
  const { exportFile, downloadBlob } = await engine();
  const { blob, name } = await exportFile(req, env);
  downloadBlob(blob, name);
}

/**
 * "Export the set plan" (decision 0111, the mockup's Export): PDF, PNG or JPEG of this setup or
 * all of them, the whole plan or what is on screen, with the legend, kit, power, notes, scale and
 * sizes, background, date and scene and grid as chosen. A preview of the first page on the left;
 * "Add to the call sheet" links the plan to the scenes whose call sheet prints it.
 */
export function PlanExport({
  store,
  plan,
  family,
  scene,
  area,
  onCallSheet,
  onClose,
}: {
  store: BoardStore;
  plan: PlanElement;
  /** The setups of the plan, the base first. */
  family: readonly PlanElement[];
  /** The number of the plan's first scene, for "All 3 of scene 2". */
  scene: string | null;
  /** What the editor shows now, in view units. */
  area: Area | null;
  onCallSheet: (at: DOMRect) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialog = useRef<DialogHandle>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [cache] = useState(() => new ExportCache());
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [setups, setSetups] = useState<'this' | 'all'>(family.length > 1 ? 'all' : 'this');
  const [where, setWhere] = useState<'whole' | 'view'>('whole');
  // The background belongs to the base's Set: a setup prints its base's (decision 0110).
  const [include, setInclude] = useState<PlanSheetInclude>(() =>
    sheetInclude(family.find((p) => p.id === plan.variantOf) ?? plan),
  );
  const [pages, setPages] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const planIds = setups === 'all' ? family.map((p) => p.id) : [plan.id];
  const req = planSheetRequest(format, planIds, where === 'view' ? area : null, include, false);
  const env = planSheetEnv(store, plan, t, i18n.language, cache);
  const envRef = useRef(env);
  envRef.current = env;
  const key = JSON.stringify(req);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the request is keyed by its text.
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const [{ buildPages }, { drawPage }] = await Promise.all([
          engine(),
          import('../export/render-canvas.ts'),
        ]);
        await document.fonts.load('600 12px Inter');
        const built = await buildPages(req, envRef.current, {
          preview: true,
          previewCount: 1,
          signal: controller.signal,
        });
        const page = built.pages[0];
        const el = preview.current;
        if (controller.signal.aborted) return;
        if (el && page) {
          const css = el.clientWidth || 232;
          const scale = (css / page.width) * (window.devicePixelRatio || 1);
          el.width = Math.round(page.width * scale);
          el.height = Math.round(page.height * scale);
          const ctx = el.getContext('2d');
          if (ctx) drawPage(ctx, page, scale, built.images, 0, built.fonts.headingFamily);
        }
        setPages(built.pages.length);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key]);

  const run = async () => {
    setBusy(true);
    try {
      await downloadPlanSheet(req, envRef.current);
      dialog.current?.requestClose();
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };
  const box = (name: keyof PlanSheetInclude) => (
    // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is the child.
    <label key={name} className="plan-export__check">
      <Checkbox
        checked={include[name]}
        onChange={(e) => setInclude((v) => ({ ...v, [name]: e.target.checked }))}
      />
      {t(`board.plan.exportSheet.include.${name}`)}
    </label>
  );
  const formatName = format === 'pdf' ? 'PDF' : format === 'png' ? 'PNG' : 'JPEG';
  return (
    <Dialog ref={dialog} open title={t('board.plan.exportSheet.title')} onClose={onClose}>
      <span className="plan-export__close">
        <IconButton
          icon="close"
          label={t('export.close')}
          disabled={busy}
          onClick={() => dialog.current?.requestClose()}
        />
      </span>
      <div className="plan-export" data-tour="plan-export">
        <figure className="plan-export__preview">
          <div className="plan-export__paper" data-status={status}>
            <canvas ref={preview} role="img" aria-label={t('board.plan.exportSheet.preview')} />
          </div>
          <figcaption className="plan-export__note">
            {status === 'error'
              ? t('board.plan.exportSheet.failed')
              : t('board.plan.exportSheet.pages', { count: pages || 1, n: 1 })}
          </figcaption>
        </figure>
        <div className="plan-export__options">
          <Segmented
            label={t('board.plan.exportSheet.format')}
            hideLabel={false}
            value={format}
            onChange={setFormat}
            options={[
              { value: 'pdf', label: 'PDF' },
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
            ]}
          />
          {family.length > 1 && (
            <Segmented
              label={t('board.plan.exportSheet.setups')}
              hideLabel={false}
              value={setups}
              onChange={setSetups}
              options={[
                { value: 'this', label: t('board.plan.exportSheet.thisSetup') },
                {
                  value: 'all',
                  label: scene
                    ? t('board.plan.exportSheet.allOfScene', { count: family.length, scene })
                    : t('board.plan.exportSheet.allSetups', { count: family.length }),
                },
              ]}
            />
          )}
          <Segmented
            label={t('board.plan.exportSheet.area')}
            hideLabel={false}
            value={where}
            onChange={setWhere}
            options={[
              { value: 'whole', label: t('board.plan.exportSheet.whole') },
              { value: 'view', label: t('board.plan.exportSheet.view'), disabled: !area },
            ]}
          />
          <fieldset className="plan-export__include">
            <legend className="ink-radio-group__legend">
              {t('board.plan.exportSheet.includeTitle')}
            </legend>
            {(
              [
                'legend',
                'kit',
                'power',
                'notes',
                'scale',
                'background',
                'dateScene',
                'grid',
              ] as const
            ).map(box)}
          </fieldset>
        </div>
      </div>
      <DialogActions>
        <Button
          disabled={busy}
          onClick={(e) => {
            const at = e.currentTarget.getBoundingClientRect();
            dialog.current?.requestClose();
            onCallSheet(at);
          }}
        >
          {t('board.plan.addToCallSheet')}
        </Button>
        <Button variant="primary" disabled={busy || status === 'error'} onClick={run}>
          {busy
            ? t('board.plan.exportSheet.working')
            : t('board.plan.exportSheet.run', { format: formatName })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
