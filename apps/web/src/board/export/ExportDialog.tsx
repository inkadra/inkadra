// SPDX-License-Identifier: AGPL-3.0-only
import type { Rect } from '@inkadra/canvas-core';
import { type Board, DEFAULT_EXPORT_PREFERENCES, type ExportSettings } from '@inkadra/shared';
import { Button, Dialog, DialogActions, type DialogHandle, Select } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getReviews } from '../review-store.ts';
import type { BoardStore } from '../store.ts';
import { resolveTheme } from '../theme.ts';
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
  fetchExportSettings,
  LogoTimeoutError,
  localePaper,
  logoProblem,
  logoUrl,
  preferencesPatch,
  saveExportSettings,
  uploadLogo,
} from './settings.ts';
import './export.css';

/** Where the dialog was opened from: the canvas offers board scopes, film views their own. */
export type ExportSource = 'canvas' | 'storyboard' | 'shotlist';

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
  const film = source !== 'canvas';
  // Until the project's settings arrive, the safe defaults; then the shared choices.
  const [req, setReq] = useState<ExportRequest>(() => ({
    ...DEFAULT_EXPORT_PREFERENCES,
    what: props.initialWhat ?? (film ? source : 'board'),
    paper: localePaper(),
    logo: null,
  }));
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  const touched = useRef(false);
  // The options were changed by hand: closing would lose them.
  const [changed, setChanged] = useState(false);
  const dialog = useRef<DialogHandle>(null);
  useEffect(() => {
    let live = true;
    fetchExportSettings(projectId).then(
      (loaded) => {
        if (!live) return;
        setSettings(loaded);
        const {
          logo,
          logoAssetId: _id,
          canEdit: _edit,
          updatedAt: _at,
          theme: _theme,
          projectColor: _color,
          ...prefs
        } = loaded;
        const theme = resolveTheme(loaded);
        setReq((r) =>
          touched.current
            ? { ...r, logo, theme }
            : { ...r, ...prefs, paper: prefs.paper ?? localePaper(), logo, theme },
        );
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  const canEdit = settings?.canEdit ?? false;
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
  const set = <K extends keyof ExportRequest>(key: K, value: ExportRequest[K]) => {
    touched.current = true;
    setChanged(true);
    setReq((r) => ({ ...r, [key]: value }));
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
        const { what: _what, logo: _logo, ...chosen } = req;
        const patch = preferencesPatch(settings, chosen);
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

  return (
    <div className="phone-sheet">
      <Dialog ref={dialog} open dirty={changed && !busy} title={t('export.title')} onClose={closed}>
        <div className="export">
          <div className="export__controls">
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
                setReq((r) => ({
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
                {req.logo && <img className="export__logo-img" src={logoUrl(req.logo)} alt="" />}
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
                    ['type', 'size', 'failed', 'timeout'].includes(logoState) ? 'alert' : 'status'
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
          <Preview req={req} env={envRef} onMissing={setMissing} />
        </div>
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
          <Button onClick={() => dialog.current?.requestClose()}>{t('export.cancel')}</Button>
          <Button
            variant="primary"
            icon="download"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void submit()}
          >
            {busy ? t('export.busy') : t('export.submit')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

/** The first page, redrawn shortly after the options change. */
function Preview({
  req,
  env,
  onMissing,
}: {
  req: ExportRequest;
  env: { current: ExportEnv };
  onMissing: (chars: string[]) => void;
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
        if (cancelled() || !page || !el) return;
        const cssWidth = el.parentElement?.clientWidth ?? 360;
        const scale = (cssWidth / page.width) * (window.devicePixelRatio || 1);
        el.width = Math.round(page.width * scale);
        el.height = Math.round(page.height * scale);
        const ctx = el.getContext('2d');
        if (ctx) drawPage(ctx, page, scale, built.images, 0, built.fonts.headingFamily);
        setState({ status: 'ready', pages: built.pages.length });
        onMissing(built.missing);
      } catch {
        if (!cancelled()) setState((s) => ({ ...s, status: 'error' }));
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [req, env, onMissing]);
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
        {state.pages > 0 && t('export.pages', { count: state.pages })}
        {req.format === 'png' && state.pages > 1 && ` · ${t('export.pngPages')}`}
      </figcaption>
    </figure>
  );
}
