// SPDX-License-Identifier: AGPL-3.0-only
import type { Rect } from '@inkadra/canvas-core';
import type { Board, ExportPreset, ExportSettings } from '@inkadra/shared';
import { Button, Dialog, DialogActions, type DialogHandle, Icon, Select } from '@inkadra/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../../lib/phone.ts';
import { getReviews } from '../review-store.ts';
import type { BoardStore } from '../store.ts';
import { ExportCache } from './cache.ts';
import type {
  ExportEnv,
  ExportFormat,
  ExportProgress,
  ExportRequest,
  ExportWhat,
} from './engine.ts';
import { Check, Field, Segmented } from './fields.tsx';
import { FRAMES_PER_PAGE, type FramesPerPage, type Orientation, type PaperSize } from './layout.ts';
import {
  type ExportSource,
  fetchExportSettings,
  initialExportState,
  LogoTimeoutError,
  logoProblem,
  logoUrl,
  matchesPreset,
  PRESET_ORDER,
  preferencesPatch,
  presetChoices,
  presetNumber,
  recommendedPreset,
  saveExportSettings,
  uploadLogo,
} from './settings.ts';
import './export.css';

export interface ExportDialogProps {
  source: ExportSource;
  /** First choice of content, e.g. the selection when opened from its menu. */
  initialWhat?: ExportWhat | undefined;
  store: BoardStore;
  projectId: string;
  /** The open board: a new logo is uploaded through it, like any file. */
  boardId: string;
  projectName: string;
  boardTitle: string;
  boards: readonly Board[] | null;
  selection: ReadonlySet<string>;
  visible: Rect | null;
  onClose: () => void;
}

// The engine (pdf-lib, fontkit, Inter) loads only when the dialog opens.
const engine = () => import('./engine.ts');

export function ExportDialog(props: ExportDialogProps) {
  const { source, store, projectId, boardId, onClose } = props;
  const { t, i18n } = useTranslation();
  const isPhone = useIsPhone();
  const film = source !== 'canvas';
  const recommended = recommendedPreset(source);
  const [basePreset, setBasePreset] = useState<ExportPreset | null>(recommended);
  const [customOpen, setCustomOpen] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [req, setReq] = useState<ExportRequest>(() => ({
    ...presetChoices(recommended, source, props.initialWhat, i18n.language),
    logo: null,
  }));
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // The options were changed by hand: closing would lose them.
  const [changed, setChanged] = useState(false);
  const dialog = useRef<DialogHandle>(null);
  const initialWhat = props.initialWhat;
  useEffect(() => {
    let live = true;
    fetchExportSettings(projectId).then(
      (loaded) => {
        if (!live) return;
        const init = initialExportState(loaded, source, initialWhat, i18n.language);
        setSettings(loaded);
        setBasePreset(init.basePreset);
        setCustomOpen(init.customOpen);
        setReq(init.req);
        setSettingsLoaded(true);
      },
      () => {
        if (live) setSettingsLoaded(true);
      },
    );
    return () => {
      live = false;
    };
  }, [projectId, source, initialWhat, i18n.language]);
  const canEdit = settings?.canEdit ?? false;
  const active =
    basePreset && matchesPreset(req, basePreset, source, i18n.language, settings?.paper)
      ? basePreset
      : null;
  const [logoState, setLogoState] = useState<
    'idle' | 'busy' | 'type' | 'size' | 'failed' | 'timeout'
  >('idle');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  // Pictures of the preview live as long as the dialog; an export in flight stops with it.
  const [cache] = useState(() => new ExportCache());
  const running = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      running.current?.abort();
      cache.close();
    },
    [cache],
  );
  const choosePreset = (next: ExportPreset) => {
    setChanged(true);
    setBasePreset(next);
    setReq((r) => ({
      ...presetChoices(next, source, r.what, i18n.language),
      logo: r.logo,
      theme: r.theme,
    }));
  };
  const updateReq = (updater: (prev: ExportRequest) => ExportRequest) => {
    setChanged(true);
    setReq(updater);
  };
  const set = <K extends keyof ExportRequest>(key: K, value: ExportRequest[K]) => {
    updateReq((r) => ({ ...r, [key]: value }));
  };

  const env: ExportEnv = {
    store,
    selection: props.selection,
    visible: props.visible,
    projectName: props.projectName,
    boardTitle: props.boardTitle,
    boards: props.boards,
    threads: getReviews().threads,
    t,
    language: i18n.language,
    cache,
  };
  const envRef = useRef(env);
  envRef.current = env;

  const board = req.what === 'board' || req.what === 'selection' || req.what === 'visible';
  const pngBoard = req.format === 'png' && board;
  const client = req.audience === 'client';

  async function submit() {
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setFailed(false);
    setProgress(null);
    try {
      const { exportFile, downloadBlob } = await engine();
      const { blob, name } = await exportFile(req, envRef.current, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) return;
      downloadBlob(blob, name);
      // Editors keep their last choices for the whole project; a failure costs only that.
      if (settings?.canEdit) {
        const { what: _what, logo: _logo, theme: _theme, ...chosen } = req;
        const patch = preferencesPatch(settings, { ...chosen, preset: active }, i18n.language);
        if (Object.keys(patch).length) await saveExportSettings(projectId, patch).catch(() => {});
      }
      onClose();
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (running.current === controller) running.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  function closed() {
    running.current?.abort();
    onClose();
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) {
      setLogoState(problem);
      return;
    }
    setLogoState('busy');
    try {
      const assetId = await uploadLogo(file, projectId, boardId);
      const saved = await saveExportSettings(projectId, { logoAssetId: assetId });
      setSettings(saved);
      setReq((r) => ({ ...r, logo: saved.logo }));
      setLogoState('idle');
    } catch (err) {
      setLogoState(err instanceof LogoTimeoutError ? 'timeout' : 'failed');
    }
  }

  async function dropLogo() {
    setLogoState('busy');
    try {
      const saved = await saveExportSettings(projectId, { logoAssetId: null });
      setSettings(saved);
      setReq((r) => ({ ...r, logo: null }));
      setLogoState('idle');
    } catch {
      setLogoState('failed');
    }
  }

  const whatOptions: ExportWhat[] = film
    ? ['storyboard', 'shotlist']
    : ['board', 'selection', 'visible'];
  const fileInput = useRef<HTMLInputElement>(null);
  const presetGroupName = useId();
  const customPanelId = useId();

  const paperLabel = req.paper === 'letter' ? t('export.paperLetter') : t('export.paperA4');
  const orientLabel = req.orientation === 'portrait' ? t('export.portrait') : t('export.landscape');
  const formatLabel = req.format === 'png' ? t('export.formatPng') : t('export.formatPdf');
  const audienceLabel = client ? t('export.audienceClient') : t('export.audienceTeam');
  const summaryNote =
    basePreset && (!active || customOpen)
      ? t('export.editingPreset', { n: presetNumber(basePreset) })
      : pngBoard
        ? `${formatLabel}, ${audienceLabel.toLocaleLowerCase()}`
        : `${paperLabel} ${orientLabel.toLocaleLowerCase()}, ${formatLabel}, ${audienceLabel.toLocaleLowerCase()}`;
  const dialogTitle =
    !isPhone && props.projectName
      ? t('export.titleProject', { name: props.projectName })
      : t('export.title');

  return (
    <div className="phone-sheet">
      <Dialog ref={dialog} open dirty={changed && !busy} title={dialogTitle} onClose={closed}>
        <div className="export__sheet-handle" aria-hidden="true" />
        <button
          type="button"
          className="export__close"
          aria-label={t('export.close')}
          disabled={busy}
          onClick={() => dialog.current?.requestClose()}
        >
          <Icon name="close" size={16} />
        </button>
        <div className="export">
          <div className="export__controls">
            {!settingsLoaded ? (
              <p className="export__hint" role="status">
                {t('export.previewLoading')}
              </p>
            ) : (
              <>
                <fieldset className="export__presets">
                  <legend className="ink-sr-only">{t('export.presetsLabel')}</legend>
                  {PRESET_ORDER.map((id) => {
                    const n = presetNumber(id);
                    const isSelected = active === id;
                    const titleId = `${presetGroupName}-${id}-title`;
                    const descId = `${presetGroupName}-${id}-desc`;
                    return (
                      <label key={id} className={`export__preset${isSelected ? ' is-active' : ''}`}>
                        <input
                          type="radio"
                          name={presetGroupName}
                          value={id}
                          checked={isSelected}
                          aria-labelledby={titleId}
                          aria-describedby={descId}
                          className="export__preset-input"
                          onChange={() => choosePreset(id)}
                        />
                        <span className="export__preset-num" aria-hidden="true">
                          {n}
                        </span>
                        <span className="export__preset-body">
                          <span id={titleId} className="export__preset-head">
                            <strong className="export__preset-title">
                              {t(`export.presets.${id}.title`)}
                            </strong>
                            {recommended === id && (
                              <span className="export__preset-badge">
                                {t('export.recommended')}
                              </span>
                            )}
                          </span>
                          <span id={descId} className="export__preset-desc">
                            {t(`export.presets.${id}.description`)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>

                <div className="export__custom">
                  <button
                    type="button"
                    className="export__disclosure"
                    aria-expanded={customOpen}
                    aria-controls={customPanelId}
                    onClick={() => setCustomOpen((o) => !o)}
                  >
                    <Icon
                      name="chevronRight"
                      size={14}
                      className={`export__disclosure-icon${customOpen ? ' is-open' : ''}`}
                    />
                    <span>{t('export.customize')}</span>
                    <small className="export__disclosure-note">· {summaryNote}</small>
                  </button>
                  <div
                    id={customPanelId}
                    className="export__custom-body"
                    hidden={!customOpen}
                    inert={!customOpen}
                  >
                    <Segmented
                      label={t('export.format')}
                      value={req.format}
                      options={[
                        ['pdf', t('export.formatPdf')],
                        ['png', t('export.formatPng')],
                      ]}
                      onChange={(v) => set('format', v as ExportFormat)}
                    />
                    <Field label={t('export.what')}>
                      {(id) => (
                        <Select
                          id={id}
                          className="ink-input"
                          value={req.what}
                          onChange={(e) => set('what', e as ExportWhat)}
                        >
                          {whatOptions.map((w) => (
                            <option
                              key={w}
                              value={w}
                              disabled={
                                (w === 'selection' && props.selection.size === 0) ||
                                (w === 'visible' && !props.visible)
                              }
                            >
                              {w === 'selection'
                                ? t('export.whatSelection', { count: props.selection.size })
                                : t(`export.what${w[0]?.toUpperCase()}${w.slice(1)}`)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    {req.what === 'storyboard' && (
                      <Segmented
                        label={t('export.framesPerPage')}
                        value={String(req.framesPerPage)}
                        options={FRAMES_PER_PAGE.map((n) => [String(n), String(n)])}
                        onChange={(v) => set('framesPerPage', Number(v) as FramesPerPage)}
                      />
                    )}
                    {!pngBoard && (
                      <div className="export__row">
                        <Field label={t('export.page')}>
                          {(id) => (
                            <Select
                              id={id}
                              className="ink-input"
                              value={req.paper}
                              onChange={(e) => set('paper', e as PaperSize)}
                            >
                              <option value="a4">{t('export.paperA4')}</option>
                              <option value="letter">{t('export.paperLetter')}</option>
                            </Select>
                          )}
                        </Field>
                        <Segmented
                          label={t('export.page')}
                          hideLabel
                          value={req.orientation}
                          options={[
                            ['portrait', t('export.portrait')],
                            ['landscape', t('export.landscape')],
                          ]}
                          onChange={(v) => set('orientation', v as Orientation)}
                        />
                      </div>
                    )}
                    <Segmented
                      label={t('export.audience')}
                      value={req.audience}
                      options={[
                        ['client', t('export.audienceClient')],
                        ['team', t('export.audienceTeam')],
                      ]}
                      onChange={(v) =>
                        updateReq((r) => ({
                          ...r,
                          audience: v as ExportRequest['audience'],
                          hideGuestHidden: v === 'client' ? true : r.hideGuestHidden,
                        }))
                      }
                      hint={client ? t('export.audienceHintClient') : t('export.audienceHintTeam')}
                    />
                    <fieldset className="export__options">
                      <legend className="export__label">{t('export.options')}</legend>
                      {req.format === 'pdf' && (
                        <Check checked={req.titlePage} onChange={(v) => set('titlePage', v)}>
                          {t('export.titlePage')}
                        </Check>
                      )}
                      <Check
                        checked={req.hideGuestHidden || client}
                        disabled={client}
                        onChange={(v) => set('hideGuestHidden', v)}
                      >
                        {t('export.hideHidden')}
                      </Check>
                      {req.format === 'pdf' && (
                        <Check
                          checked={req.comments}
                          onChange={(v) => set('comments', v)}
                          hint={client ? t('export.commentsHintClient') : undefined}
                        >
                          {t('export.comments')}
                        </Check>
                      )}
                      <div className="export__logo">
                        <span className="export__logo-label">{t('export.logo')}</span>
                        {req.logo && (
                          <img className="export__logo-img" src={logoUrl(req.logo)} alt="" />
                        )}
                        {canEdit && (
                          <>
                            <input
                              ref={fileInput}
                              type="file"
                              accept="image/png,image/jpeg"
                              className="ink-sr-only"
                              tabIndex={-1}
                              aria-hidden="true"
                              onChange={(e) => {
                                void pickLogo(e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                            <Button
                              size="md"
                              disabled={logoState === 'busy'}
                              onClick={() => fileInput.current?.click()}
                            >
                              {req.logo ? t('export.logoReplace') : t('export.logoAdd')}
                            </Button>
                            {req.logo && (
                              <Button
                                variant="ghost"
                                disabled={logoState === 'busy'}
                                onClick={() => void dropLogo()}
                              >
                                {t('export.logoRemove')}
                              </Button>
                            )}
                          </>
                        )}
                        <p
                          className={`export__hint${['type', 'size', 'failed', 'timeout'].includes(logoState) ? ' export__hint--error' : ''}`}
                          role={
                            ['type', 'size', 'failed', 'timeout'].includes(logoState)
                              ? 'alert'
                              : 'status'
                          }
                        >
                          {logoState === 'busy'
                            ? t('export.logoUploading')
                            : logoState === 'type' || logoState === 'size'
                              ? t('export.logoInvalid')
                              : logoState === 'failed'
                                ? t('export.logoFailed')
                                : logoState === 'timeout'
                                  ? t('export.logoTimeout')
                                  : canEdit
                                    ? t('export.logoHint')
                                    : req.logo
                                      ? t('export.logoReadOnly')
                                      : t('export.logoNone')}
                        </p>
                      </div>
                      {canEdit && <p className="export__hint">{t('export.sharedHint')}</p>}
                    </fieldset>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="export__main">
            <Preview
              req={req}
              ready={settingsLoaded}
              env={envRef}
              onMissing={setMissing}
              onPages={setPageCount}
            />
            {missing.length > 0 && (
              <p className="export__notice" role="note">
                {t('export.missingGlyphs', { chars: missing.join(' ') })}
              </p>
            )}
            {busy && (
              <div className="export__progress-row" role="status">
                <div
                  className="export__progress"
                  role="progressbar"
                  aria-label={t('export.busy')}
                  aria-valuemin={0}
                  aria-valuemax={progress?.total ?? 0}
                  aria-valuenow={progress?.done ?? 0}
                >
                  <span
                    style={{
                      width: progress?.total ? `${(progress.done / progress.total) * 100}%` : '0%',
                    }}
                  />
                </div>
                <span className="export__hint">
                  {progress
                    ? t(
                        progress.phase === 'pictures'
                          ? 'export.progressPictures'
                          : 'export.progressPages',
                        {
                          done: progress.done,
                          total: progress.total,
                        },
                      )
                    : t('export.busy')}
                </span>
              </div>
            )}
            {failed && (
              <p className="export__hint export__hint--error" role="alert">
                {t('export.failed')}
              </p>
            )}
            <DialogActions>
              {canEdit && <span className="export__remembered">{t('export.remembered')}</span>}
              <Button className="export__cancel" onClick={() => dialog.current?.requestClose()}>
                {t('export.cancel')}
              </Button>
              <Button
                variant="primary"
                icon="download"
                className="export__submit"
                disabled={busy || !settingsLoaded}
                aria-busy={busy || undefined}
                onClick={() => void submit()}
              >
                {busy
                  ? t('export.busy')
                  : isPhone && pageCount > 0
                    ? t('export.submitPages', { count: pageCount })
                    : t('export.submit')}
              </Button>
            </DialogActions>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** The first page, redrawn shortly after the options change. */
function Preview({
  req,
  ready,
  env,
  onMissing,
  onPages,
}: {
  req: ExportRequest;
  ready: boolean;
  env: { current: ExportEnv };
  onMissing: (chars: string[]) => void;
  onPages: (pages: number) => void;
}) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    pages: number;
  }>({
    status: 'loading',
    pages: 0,
  });
  useEffect(() => {
    if (!ready) return;
    // A newer preview stops the older one; pictures already decoded stay in the dialog's cache.
    const controller = new AbortController();
    const cancelled = () => controller.signal.aborted;
    setState((s) => ({ ...s, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const [{ buildPages }, { drawPage }] = await Promise.all([
          engine(),
          import('./render-canvas.ts'),
        ]);
        await document.fonts.load('600 12px Inter');
        const built = await buildPages(req, env.current, {
          preview: true,
          signal: controller.signal,
        });
        // The title page says little about the layout: show the first page of content.
        const withTitle = req.titlePage && req.format === 'pdf' && built.pages.length > 1;
        const page = built.pages[withTitle ? 1 : 0];
        const el = canvas.current;
        if (cancelled()) return;
        if (page && el) {
          const cssWidth = el.parentElement?.clientWidth || 320;
          const scale = (cssWidth / page.width) * (window.devicePixelRatio || 1);
          el.width = Math.round(page.width * scale);
          el.height = Math.round(page.height * scale);
          const ctx = el.getContext('2d');
          if (ctx) drawPage(ctx, page, scale, built.images, 0, built.fonts.headingFamily);
        }
        setState({ status: 'ready', pages: built.pages.length });
        onPages(built.pages.length);
        onMissing(built.missing);
      } catch {
        if (!cancelled()) setState((s) => ({ ...s, status: 'error' }));
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [req, ready, env, onMissing, onPages]);
  return (
    <figure className="export__preview">
      <div className="export__paper" data-status={state.status}>
        <canvas
          ref={canvas}
          className="export__canvas"
          role="img"
          aria-label={t('export.preview')}
        />
        <span className="export__preview-note" role="status">
          {state.status === 'loading' ? t('export.previewLoading') : ''}
        </span>
        {state.status === 'error' && (
          <span className="export__preview-note" role="alert">
            {t('export.previewFailed')}
          </span>
        )}
      </div>
      <figcaption className="export__hint">
        {state.pages > 0 && `${t('export.preview')} · ${t('export.pages', { count: state.pages })}`}
        {req.format === 'png' && state.pages > 1 && ` · ${t('export.pngPages')}`}
      </figcaption>
    </figure>
  );
}
