// SPDX-License-Identifier: AGPL-3.0-only
import type { Rect } from '@inkadra/canvas-core';
import { type Board, DEFAULT_EXPORT_PREFERENCES, type ExportSettings } from '@inkadra/shared';
import { Button, Dialog, DialogActions } from '@inkadra/ui';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getReviews } from '../review-store.ts';
import type { BoardStore } from '../store.ts';
import type { ExportEnv, ExportFormat, ExportRequest, ExportWhat } from './engine.ts';
import { FRAMES_PER_PAGE, type FramesPerPage, type Orientation, type PaperSize } from './layout.ts';
import {
  fetchExportSettings,
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
  useEffect(() => {
    let live = true;
    fetchExportSettings(projectId).then(
      (loaded) => {
        if (!live) return;
        setSettings(loaded);
        const { logo, logoAssetId: _id, canEdit: _edit, updatedAt: _at, ...prefs } = loaded;
        setReq((r) =>
          touched.current
            ? { ...r, logo }
            : { ...r, ...prefs, paper: prefs.paper ?? localePaper(), logo },
        );
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  const canEdit = settings?.canEdit ?? false;
  const [logoState, setLogoState] = useState<'idle' | 'busy' | 'type' | 'size' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = <K extends keyof ExportRequest>(key: K, value: ExportRequest[K]) => {
    touched.current = true;
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
  };
  const envRef = useRef(env);
  envRef.current = env;

  const board = req.what === 'board' || req.what === 'selection' || req.what === 'visible';
  const pngBoard = req.format === 'png' && board;
  const client = req.audience === 'client';

  async function submit() {
    setBusy(true);
    setFailed(false);
    try {
      const { exportFile, downloadBlob } = await engine();
      const { blob, name } = await exportFile(req, envRef.current);
      downloadBlob(blob, name);
      // Editors keep their last choices for the whole project; a failure costs only that.
      if (settings?.canEdit) {
        const { what: _what, logo: _logo, ...chosen } = req;
        const patch = preferencesPatch(settings, chosen);
        if (Object.keys(patch).length) await saveExportSettings(projectId, patch).catch(() => {});
      }
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
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
    } catch {
      setLogoState('failed');
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
      <Dialog open title={t('export.title')} onClose={onClose}>
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
                <select
                  id={id}
                  className="ink-input"
                  value={req.what}
                  onChange={(e) => set('what', e.target.value as ExportWhat)}
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
                </select>
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
                    <select
                      id={id}
                      className="ink-input"
                      value={req.paper}
                      onChange={(e) => set('paper', e.target.value as PaperSize)}
                    >
                      <option value="a4">{t('export.paperA4')}</option>
                      <option value="letter">{t('export.paperLetter')}</option>
                    </select>
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
                  className={`export__hint${['type', 'size', 'failed'].includes(logoState) ? ' export__hint--error' : ''}`}
                  role={['type', 'size', 'failed'].includes(logoState) ? 'alert' : 'status'}
                >
                  {logoState === 'busy'
                    ? t('export.logoUploading')
                    : logoState === 'type' || logoState === 'size'
                      ? t('export.logoInvalid')
                      : logoState === 'failed'
                        ? t('export.logoFailed')
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
          <Preview req={req} env={envRef} />
        </div>
        {failed && (
          <p className="export__hint export__hint--error" role="alert">
            {t('export.failed')}
          </p>
        )}
        <DialogActions>
          <Button onClick={onClose}>{t('export.cancel')}</Button>
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

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="export__field">
      <label className="export__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function Segmented({
  label,
  hideLabel,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  hideLabel?: boolean;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  hint?: string | undefined;
}) {
  const hintId = useId();
  return (
    <fieldset
      className="export__field export__seg-field"
      aria-describedby={hint ? hintId : undefined}
    >
      <legend className={hideLabel ? 'ink-sr-only' : 'export__label'}>{label}</legend>
      <div className="export__seg">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            className="export__seg-btn"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {text}
          </button>
        ))}
      </div>
      {hint && (
        <p id={hintId} className="export__hint">
          {hint}
        </p>
      )}
    </fieldset>
  );
}

function Check({
  checked,
  disabled,
  onChange,
  hint,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="export__check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {children}
        {hint && <span className="export__hint">{hint}</span>}
      </span>
    </label>
  );
}

/** The first page, redrawn shortly after the options change. */
function Preview({ req, env }: { req: ExportRequest; env: { current: ExportEnv } }) {
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
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const [{ buildPages }, { drawPage }] = await Promise.all([
          engine(),
          import('./render-canvas.ts'),
        ]);
        await document.fonts.load('600 12px Inter');
        const built = await buildPages(req, env.current, true);
        // The title page says little about the layout: show the first page of content.
        const withTitle = req.titlePage && req.format === 'pdf' && built.pages.length > 1;
        const page = built.pages[withTitle ? 1 : 0];
        const el = canvas.current;
        if (cancelled || !page || !el) return;
        const cssWidth = el.parentElement?.clientWidth ?? 360;
        const scale = (cssWidth / page.width) * (window.devicePixelRatio || 1);
        el.width = Math.round(page.width * scale);
        el.height = Math.round(page.height * scale);
        const ctx = el.getContext('2d');
        if (ctx) drawPage(ctx, page, scale, built.images);
        setState({ status: 'ready', pages: built.pages.length });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: 'error' }));
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [req, env]);
  return (
    <figure className="export__preview">
      <div className="export__paper" data-status={state.status}>
        <canvas
          ref={canvas}
          className="export__canvas"
          role="img"
          aria-label={t('export.preview')}
        />
        {state.status === 'loading' && (
          <span className="export__preview-note">{t('export.previewLoading')}</span>
        )}
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
