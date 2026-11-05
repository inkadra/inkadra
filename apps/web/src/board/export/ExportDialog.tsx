// SPDX-License-Identifier: AGPL-3.0-only
import { frameLabels, listElements, type Rect, storyboardOf } from '@inkadra/canvas-core';
import {
  atLeast,
  type Board,
  CAPABILITY_ROLE,
  type ExportImageAspect,
  type ExportImageFit,
  type ExportPreset,
  type ExportSettings,
  type ProjectRole,
} from '@inkadra/shared';
import {
  Button,
  ChoiceTile,
  Dialog,
  DialogActions,
  type DialogHandle,
  Icon,
  IconButton,
  Select,
} from '@inkadra/ui';
import {
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { refreshClassifications } from '../../lib/classifications.ts';
import { useIsPhone } from '../../lib/phone.ts';
import { ColorPicker } from '../ColorPicker.tsx';
import { swatchColors } from '../colors.ts';
import { formatBytes } from '../file-kinds.ts';
import { getReviews, useReviews } from '../review-store.ts';
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
import {
  ASPECT_PIXELS,
  CENTRE,
  clampFocus,
  type Focus,
  focusAfterKey,
  frameInStage,
  IMAGE_ASPECTS,
  type ImageOptions,
  imagePages,
  manyMode,
  ORIGINALS_ZIP_MAX_BYTES,
  placeContent,
} from './image-format.ts';
import { FRAMES_PER_PAGE, type FramesPerPage, type Orientation, type PaperSize } from './layout.ts';
import type { OriginalFile, OriginalsPlan } from './originals.ts';
import {
  type ExportSource,
  fetchExportSettings,
  framesOf,
  hasApprovedFrame,
  initialExportState,
  initialImage,
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
  teamPdf,
  uploadLogo,
} from './settings.ts';
import './export.css';

export interface ExportDialogProps {
  source: ExportSource;
  /** First choice of content, e.g. the selection when opened from its menu. */
  initialWhat?: ExportWhat | undefined;
  /** Opened to make a picture, from the menu of a card, a selection or a frame. */
  imageEntry?: boolean | undefined;
  /** Opened from a button that says PDF, whatever the project exported last. */
  pdfEntry?: boolean | undefined;
  store: BoardStore;
  projectId: string;
  /** The open board: a new logo is uploaded through it, like any file. */
  boardId: string;
  projectName: string;
  boardTitle: string;
  boards: readonly Board[] | null;
  selection: ReadonlySet<string>;
  visible: Rect | null;
  /** The reader's role on this board: viewers do not download originals (decision 0011). */
  role?: ProjectRole | null | undefined;
  onClose: () => void;
}

/** How long the dialog waits for review statuses before recommending a preset without them. */
const REVIEWS_WAIT_MS = 1500;

// The engine (pdf-lib, fontkit, Inter) loads only when the dialog opens.
const engine = () => import('./engine.ts');
const originals = () => import('./originals.ts');
// The pages show the names of the storyboard lists, whichever view opened the dialog.
let catalogsRequest: Promise<void> | null = null;
const catalogsLoaded = () => {
  catalogsRequest ??= refreshClassifications().finally(() => {
    catalogsRequest = null;
  });
  return catalogsRequest;
};

export function ExportDialog(props: ExportDialogProps) {
  const { source, store, projectId, boardId, onClose, imageEntry = false } = props;
  const { t, i18n } = useTranslation();
  const isPhone = useIsPhone();
  const film = source !== 'canvas';
  // Settled when the options are first chosen, so the badge and the selection agree.
  const [recommended, setRecommended] = useState(() => recommendedPreset(source, true));
  const [basePreset, setBasePreset] = useState<ExportPreset | null>(recommended);
  const [customOpen, setCustomOpen] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [req, setReq] = useState<ExportRequest>(() => ({
    ...presetChoices(recommended, source, props.initialWhat, i18n.language),
    logo: null,
  }));
  const [image, setImage] = useState<ImageOptions>(() => initialImage(null, imageEntry));
  const [imageIndex, setImageIndex] = useState(0);
  const [imageState, setImageState] = useState<ImagePreviewState>({
    status: 'loading',
    count: 0,
    notReady: 0,
  });
  // Never remembered: nobody exports GPS positions by accident (decision 0072).
  const [size, setSize] = useState<'preview' | 'file'>('preview');
  const [plan, setPlan] = useState<OriginalsPlan | null>(null);
  const [failedFiles, setFailedFiles] = useState<{ names: string[]; zipped: boolean } | null>(null);
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // The options were changed by hand: closing would lose them.
  const [changed, setChanged] = useState(false);
  const dialog = useRef<DialogHandle>(null);
  const initialWhat = props.initialWhat;
  const [fetched, setFetched] = useState<ExportSettings | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    fetchExportSettings(projectId).then(
      (loaded) => {
        if (live) setFetched(loaded);
      },
      () => {
        if (live) setFetched('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  // The Storyboard recommends the pitch only with an approved frame, and review statuses may
  // still be on their way: wait for them briefly rather than switch the choice under the reader.
  const reviewsStatus = useReviews((s) => s.reviewsStatus);
  const reviews = useReviews((s) => s.reviews);
  const [reviewsWaited, setReviewsWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReviewsWaited(true), REVIEWS_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const approvalKnown = source !== 'storyboard' || reviewsStatus !== 'loading' || reviewsWaited;
  useEffect(() => {
    if (settingsLoaded || !fetched || !approvalKnown) return;
    const approved = source === 'storyboard' && hasApprovedFrame(store.getSnapshot().byId, reviews);
    const next = recommendedPreset(source, approved);
    setRecommended(next);
    const { format: pictureFormat, ...picture } = initialImage(
      fetched === 'failed' ? null : fetched,
      imageEntry,
    );
    setImage(picture);
    if (fetched === 'failed') {
      setBasePreset(next);
      setReq((r) => ({
        ...presetChoices(next, source, initialWhat, i18n.language),
        logo: r.logo,
        theme: r.theme,
      }));
    } else {
      const init = initialExportState(fetched, source, initialWhat, i18n.language, approved);
      setSettings(fetched);
      setBasePreset(init.basePreset);
      setCustomOpen(init.customOpen);
      setReq(init.req);
    }
    // After the preset: a menu entry for a picture starts on the picture format and its content.
    if (imageEntry) setReq((r) => ({ ...r, format: pictureFormat, what: initialWhat ?? r.what }));
    if (props.pdfEntry) setReq((r) => ({ ...r, format: 'pdf' }));
    setSettingsLoaded(true);
  }, [
    settingsLoaded,
    fetched,
    approvalKnown,
    source,
    store,
    reviews,
    initialWhat,
    imageEntry,
    props.pdfEntry,
    i18n.language,
  ]);
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

  const canDownload = atLeast(props.role ?? null, CAPABILITY_ROLE.download);
  const offersFile = req.format !== 'pdf' && image.aspect === 'original' && req.what === 'selection';
  const fileMode = offersFile && canDownload && size === 'file';
  const selection = props.selection;
  const { audience, hideGuestHidden } = req;
  useEffect(() => {
    setPlan(null);
    setFailedFiles(null);
    if (!fileMode) return;
    let live = true;
    void originals()
      .then(({ planOriginals }) => {
        const snapshot = store.getSnapshot();
        return planOriginals(
          {
            byId: snapshot.byId,
            canvas: snapshot.canvas,
            columns: snapshot.columns,
            heightOf: (el) => store.heightOf(el),
          },
          selection,
          { audience, hideGuestHidden: hideGuestHidden || audience === 'client' },
        );
      })
      .catch((): OriginalsPlan => ({ files: [], cards: [], noFile: selection.size }))
      .then((next) => {
        if (live) setPlan(next);
      });
    return () => {
      live = false;
    };
  }, [fileMode, store, selection, audience, hideGuestHidden]);
  const fileCount = plan?.files.length ?? 0;
  const fileBytes = plan?.files.reduce((sum, file) => sum + file.size, 0) ?? 0;
  const tooBig = fileCount > 1 && fileBytes > ORIGINALS_ZIP_MAX_BYTES;

  const env: ExportEnv = {
    store,
    selection,
    visible: props.visible,
    projectName: props.projectName,
    boardTitle: props.boardTitle,
    boards: props.boards,
    scope: { projectId, boardId },
    threads: getReviews().threads,
    reviews: getReviews().reviews,
    t,
    language: i18n.language,
    cache,
  };
  const envRef = useRef(env);
  envRef.current = env;

  const board = req.what === 'board' || req.what === 'selection' || req.what === 'visible';
  const asImage = req.format !== 'pdf';
  const client = req.audience === 'client';
  const several = req.what === 'selection' && props.selection.size > 1;
  const single = req.what === 'selection' && props.selection.size === 1;
  const each = several && manyMode(image) === 'each';
  const imageReady = imageState.status === 'ready' || imageState.status === 'error';
  const changeImage = (patch: Partial<ImageOptions>) => {
    setChanged(true);
    setImage((current) => ({ ...current, ...patch }));
  };
  const chooseFormat = (format: ExportFormat) => {
    // A frame by itself is a picture: its PDF is the storyboard.
    const what = format === 'pdf' && film && req.what === 'selection' ? 'storyboard' : req.what;
    updateReq((r) => ({ ...r, format, what }));
  };

  async function submit() {
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setFailed(false);
    setFailedFiles(null);
    setProgress(null);
    try {
      if (fileMode) {
        const [{ downloadOriginals }, { exportBaseName }] = await Promise.all([
          originals(),
          engine(),
        ]);
        const files = plan?.files ?? [];
        const names = await downloadOriginals(files, exportBaseName(envRef.current), {
          signal: controller.signal,
          onProgress: setProgress,
        });
        if (controller.signal.aborted) return;
        if (names.length > 0) setFailedFiles({ names, zipped: names.length < files.length });
        else onClose();
        return;
      }
      const { exportFile, downloadBlob } = await engine();
      await catalogsLoaded();
      const { blob, name } = await exportFile({ ...req, image }, envRef.current, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) return;
      downloadBlob(blob, name);
      // Editors keep their last choices for the whole project; a failure costs only that.
      if (settings?.canEdit) {
        const { what: _what, logo: _logo, theme: _theme, ...chosen } = req;
        // A picture leaves the PDF's preset alone, and from a card's menu the dialog's first format.
        const picture = asImage
          ? {
              preset: settings.preset,
              format: imageEntry ? settings.format : req.format,
              imageFormat: req.format === 'jpeg' ? ('jpeg' as const) : ('png' as const),
              imageAspect: image.aspect,
              imageFit: image.fit,
              imageBandColor: image.band,
            }
          : { preset: active };
        const patch = preferencesPatch(settings, { ...chosen, ...picture }, i18n.language);
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
    ? ['storyboard', 'shotlist', ...(asImage && props.selection.size ? ['selection' as const] : [])]
    : ['board', 'selection', 'visible'];
  const whatLabel = (w: ExportWhat) => {
    if (w !== 'selection') return t(`export.what${w[0]?.toUpperCase()}${w.slice(1)}`);
    const name = props.selection.size === 1 ? singleName(store, props.selection, t) : null;
    return name ?? t('export.whatSelection', { count: props.selection.size });
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const presetGroupName = useId();
  const customPanelId = useId();

  const slide = req.paper === 'slide';
  const paperLabel =
    req.paper === 'letter'
      ? t('export.paperLetter')
      : slide
        ? t('export.paperSlide')
        : t('export.paperA4');
  const orientLabel = req.orientation === 'portrait' ? t('export.portrait') : t('export.landscape');
  const pageLabel = slide ? paperLabel : `${paperLabel} ${orientLabel.toLocaleLowerCase()}`;
  const audienceLabel = client ? t('export.audienceClient') : t('export.audienceTeam');
  const summaryNote =
    basePreset && (!active || customOpen)
      ? t('export.editingPreset', { n: presetNumber(basePreset) })
      : `${pageLabel}, ${t('export.formatPdf')}, ${audienceLabel.toLocaleLowerCase()}`;
  const dialogTitle =
    !isPhone && props.projectName
      ? t('export.titleProject', { name: props.projectName })
      : t('export.title');

  const whatField = (
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
              {whatLabel(w)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  const framesField = req.what === 'storyboard' && (
    <Segmented
      label={t('export.framesPerPage')}
      value={String(req.framesPerPage)}
      options={FRAMES_PER_PAGE.map((n) => [String(n), String(n)])}
      onChange={(v) => set('framesPerPage', Number(v) as FramesPerPage)}
    />
  );
  // A picture of the board has the board's own size, not a page's.
  const pageField = !(asImage && board) && (
    <div className="export__row">
      <Field label={t('export.page')}>
        {(id) => (
          <Select
            id={id}
            className="ink-input"
            value={req.paper}
            onChange={(e) =>
              updateReq((r) => ({
                ...r,
                paper: e as PaperSize,
                // A 16:9 page is always a landscape slide.
                orientation: e === 'slide' ? 'landscape' : r.orientation,
              }))
            }
          >
            <option value="a4">{t('export.paperA4')}</option>
            <option value="letter">{t('export.paperLetter')}</option>
            <option value="slide">{t('export.paperSlide')}</option>
          </Select>
        )}
      </Field>
      {!slide && (
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
      )}
    </div>
  );
  const audienceField = (
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
      hint={
        asImage ? undefined : client ? t('export.audienceHintClient') : t('export.audienceHintTeam')
      }
    />
  );
  const approvedField = framesOf(req.what) && (
    <Check checked={req.approvedOnly} onChange={(v) => set('approvedOnly', v)}>
      {t('export.approvedOnly')}
    </Check>
  );
  const hideField = (
    <Check
      checked={req.hideGuestHidden || client}
      disabled={client}
      onChange={(v) => set('hideGuestHidden', v)}
    >
      {t('export.hideHidden')}
    </Check>
  );

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
        <div className={`export${asImage ? ' export--image' : ''}`}>
          <div className="export__controls">
            {!settingsLoaded ? (
              <p className="export__hint" role="status">
                {t('export.previewLoading')}
              </p>
            ) : (
              <>
                {!fileMode && (
                  <Segmented
                    label={t('export.format')}
                    value={req.format}
                    options={[
                      ['pdf', t('export.formatPdf')],
                      ['png', t('export.formatPng')],
                      ['jpeg', t('export.formatJpeg')],
                    ]}
                    onChange={(v) => chooseFormat(v as ExportFormat)}
                    hint={
                      req.format === 'jpeg'
                        ? t('export.jpegHint')
                        : req.format === 'png'
                          ? t('export.pngHint')
                          : undefined
                    }
                  />
                )}
                {asImage ? (
                  <>
                    {!fileMode && <p className="export__presets-off">{t('export.presetsOff')}</p>}
                    {whatField}
                    {framesField}
                    {pageField}
                    {several && !fileMode && (
                      <Segmented
                        label={t('export.many')}
                        value={manyMode(image)}
                        options={[
                          ['one', t('export.manyOne')],
                          ['each', t('export.manyEach')],
                        ]}
                        onChange={(v) => {
                          changeImage({ many: v as 'one' | 'each', foci: {} });
                          setImageIndex(0);
                        }}
                        hint={
                          each
                            ? t('export.manyHintEach', { count: props.selection.size })
                            : t('export.manyHintOne')
                        }
                      />
                    )}
                    <AspectField
                      aspect={image.aspect}
                      onChange={(aspect) => changeImage({ aspect })}
                    />
                    {offersFile && (
                      <Segmented
                        label={t('export.size')}
                        className={fileMode ? 'export__field--warn' : ''}
                        value={fileMode ? 'file' : 'preview'}
                        options={[
                          ['preview', t('export.sizePreview')],
                          ['file', t('export.sizeFile'), !canDownload],
                        ]}
                        onChange={(v) => {
                          setChanged(true);
                          setSize(v as 'preview' | 'file');
                        }}
                        hint={
                          !canDownload
                            ? t('export.sizeViewer')
                            : !fileMode
                              ? t('export.sizePreviewHint')
                              : plan && fileCount === 0
                                ? t('export.sizeNone')
                                : [
                                    fileCount > 1
                                      ? t('export.sizeFilesHint')
                                      : t('export.sizeFileHint'),
                                    plan?.noFile
                                      ? t('export.sizeNoFile', { count: plan.noFile })
                                      : '',
                                    tooBig ? t('export.sizeTooBig') : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')
                        }
                      />
                    )}
                    {image.aspect !== 'original' && (
                      <Segmented
                        label={t('export.fit')}
                        value={image.fit}
                        options={[
                          ['fit', t('export.fitIn')],
                          ['fill', t('export.fill')],
                        ]}
                        onChange={(v) => changeImage({ fit: v as ExportImageFit })}
                        hint={image.fit === 'fill' ? t('export.fillHint') : t('export.fitHint')}
                      />
                    )}
                    {image.aspect !== 'original' && image.fit === 'fit' && (
                      <BandField
                        band={image.band}
                        remembered={canEdit}
                        used={swatchColors(store.getSnapshot().byId.values())}
                        onChange={(band) => changeImage({ band })}
                      />
                    )}
                    {(!single || imageState.status === 'empty') && audienceField}
                    {req.what !== 'selection' && (
                      <fieldset className="export__options">
                        <legend className="export__label">{t('export.options')}</legend>
                        {approvedField}
                        {hideField}
                      </fieldset>
                    )}
                  </>
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
                          <label
                            key={id}
                            className={`export__preset${isSelected ? ' is-active' : ''}`}
                          >
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
                        {whatField}
                        {framesField}
                        {pageField}
                        {audienceField}
                        <fieldset className="export__options">
                          <legend className="export__label">{t('export.options')}</legend>
                          <Check checked={req.titlePage} onChange={(v) => set('titlePage', v)}>
                            {t('export.titlePage')}
                          </Check>
                          {approvedField}
                          {hideField}
                          <Check
                            checked={req.comments}
                            onChange={(v) => set('comments', v)}
                            hint={client ? t('export.commentsHintClient') : undefined}
                          >
                            {t('export.comments')}
                          </Check>
                          <Check
                            checked={req.kickoffSummary && teamPdf(req)}
                            disabled={client}
                            onChange={(v) => set('kickoffSummary', v)}
                            hint={client ? t('export.teamOnlyHint') : undefined}
                          >
                            {t('export.kickoffSummary')}
                          </Check>
                          <Check
                            checked={req.callSheet && teamPdf(req)}
                            disabled={client}
                            onChange={(v) => set('callSheet', v)}
                            hint={client ? t('export.teamOnlyHint') : undefined}
                          >
                            {t('export.callSheet')}
                          </Check>
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
              </>
            )}
          </div>
          <div className="export__main">
            {asImage ? (
              <ImagePreview
                req={req}
                image={fileMode ? { ...image, many: 'each' } : image}
                files={fileMode ? plan : null}
                index={imageIndex}
                onIndex={setImageIndex}
                onFocus={(focus) => changeImage({ foci: { ...image.foci, [imageIndex]: focus } })}
                ready={settingsLoaded}
                env={envRef}
                state={imageState}
                onState={setImageState}
                onMissing={setMissing}
              />
            ) : (
              <Preview
                req={req}
                ready={settingsLoaded}
                env={envRef}
                onMissing={setMissing}
                onPages={setPageCount}
              />
            )}
            {failed && (
              <p className="export__hint export__hint--error" role="alert">
                {t('export.failed')}
              </p>
            )}
            {missing.length > 0 && (
              <p className="export__notice" role="note">
                {t('export.missingGlyphs', { chars: missing.join(' ') })}
              </p>
            )}
            {failedFiles && (
              <p className="export__hint export__hint--error" role="alert">
                {t(failedFiles.zipped ? 'export.filesPartial' : 'export.filesFailed', {
                  count: failedFiles.names.length,
                  names: failedFiles.names.join(', '),
                })}
              </p>
            )}
            {asImage && !fileMode && imageState.notReady > 0 && (
              <p className="export__notice" role="note">
                {t('export.notReady', { count: imageState.notReady })}
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
                  {progress?.phase === 'files'
                    ? t('export.progressFiles', {
                        done: formatBytes(progress.done, i18n.language),
                        total: formatBytes(progress.total, i18n.language),
                      })
                    : progress
                      ? t(
                          progress.phase === 'pictures'
                            ? 'export.progressPictures'
                            : asImage && board
                              ? 'export.progressImages'
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
            <DialogActions>
              {canEdit && !fileMode && (
                <span className="export__remembered">{t('export.remembered')}</span>
              )}
              <Button className="export__cancel" onClick={() => dialog.current?.requestClose()}>
                {t('export.cancel')}
              </Button>
              <Button
                variant="primary"
                icon="download"
                className="export__submit"
                disabled={
                  busy ||
                  !settingsLoaded ||
                  (fileMode ? fileCount === 0 || tooBig : asImage && !imageReady)
                }
                aria-busy={busy || undefined}
                onClick={() => void submit()}
              >
                {busy
                  ? t('export.busy')
                  : fileMode
                    ? t('export.submitFiles', { count: fileCount || 1 })
                    : isPhone && asImage && imageState.count > 0
                    ? t('export.submitImages', { count: imageState.count })
                    : isPhone && !asImage && pageCount > 0
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
        await catalogsLoaded();
        const built = await buildPages(req, env.current, {
          preview: true,
          signal: controller.signal,
        });
        // The title page says little about the layout: show the first page of content.
        const withTitle = req.titlePage && built.pages.length > 1;
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
      </figcaption>
    </figure>
  );
}

/** The name of a lone card or frame in the content list; null when it has none of its own. */
function singleName(
  store: BoardStore,
  selection: ReadonlySet<string>,
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  const [id] = selection;
  const el = id ? store.getSnapshot().byId.get(id) : undefined;
  if (!el) return null;
  if (el.type === 'frame') {
    const label = frameLabels(storyboardOf(listElements(store.doc))).get(el.id) ?? '';
    return t('export.whatFrame', { label });
  }
  const name =
    ('title' in el && el.title) || ('caption' in el && el.caption) || t(`board.types.${el.type}`);
  return t('export.whatCard', { name });
}

/** Small drawings of the shapes, in pixels, for the aspect tiles. */
const GLYPHS: Record<ExportImageAspect, { width: number; height: number }> = {
  original: { width: 13, height: 10 },
  '4:5': { width: 10, height: 13 },
  '1:1': { width: 13, height: 13 },
  '9:16': { width: 7, height: 13 },
  '16:9': { width: 16, height: 9 },
};

function AspectField({
  aspect,
  onChange,
}: {
  aspect: ExportImageAspect;
  onChange: (aspect: ExportImageAspect) => void;
}) {
  const { t, i18n } = useTranslation();
  const name = useId();
  const hint =
    aspect === 'original'
      ? t('export.aspectUse.original')
      : `${t(`export.aspectUse.${aspect.replace(':', 'x')}`)} · ${pixelLabel(ASPECT_PIXELS[aspect], i18n.language, t)}`;
  return (
    <fieldset className="export__field">
      <legend className="export__label">{t('export.aspect')}</legend>
      <div className="export__aspects">
        {IMAGE_ASPECTS.map((a) => (
          <ChoiceTile
            key={a}
            name={name}
            value={a}
            checked={aspect === a}
            onChange={() => onChange(a)}
          >
            <span
              className={`export__glyph${a === 'original' ? ' is-original' : ''}`}
              style={GLYPHS[a]}
              aria-hidden="true"
            />
            {a === 'original' ? t('export.aspectOriginal') : a}
          </ChoiceTile>
        ))}
      </div>
      <p className="export__hint">{hint}</p>
    </fieldset>
  );
}

/** Where "Colore…" starts until someone picks a colour. */
const BAND_START = '#3A5A7C';
const BAND_PICKER = 'export-band';

/** Black, white or any colour for the bands; the app's colour picker opens from the last. */
function BandField({
  band,
  remembered,
  used,
  onChange,
}: {
  band: string;
  remembered: boolean;
  used: readonly string[];
  onChange: (band: string) => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  const tile = useRef<HTMLSpanElement>(null);
  const choices: Array<[string, string]> = [
    ['#000000', t('export.bandBlack')],
    ['#FFFFFF', t('export.bandWhite')],
  ];
  const isCustom = !choices.some(([hex]) => hex === band);
  const [custom, setCustom] = useState(isCustom ? band : BAND_START);
  const [picking, setPicking] = useState(false);
  const closePicker = useCallback(() => {
    setPicking(false);
    tile.current?.querySelector('input')?.focus();
  }, []);
  return (
    <fieldset className="export__field">
      <legend className="export__label">{t('export.band')}</legend>
      <div className="export__aspects">
        {choices.map(([hex, label]) => (
          <ChoiceTile
            key={hex}
            name={name}
            value={hex}
            checked={band === hex}
            onChange={() => onChange(hex)}
          >
            <span className="export__chip" style={{ background: hex }} aria-hidden="true" />
            {label}
          </ChoiceTile>
        ))}
        <span ref={tile} className="export__band-custom" data-el={BAND_PICKER}>
          <ChoiceTile
            name={name}
            value="custom"
            checked={isCustom}
            onChange={() => onChange(custom)}
            onClick={() => setPicking(true)}
          >
            <span className="export__chip" style={{ background: custom }} aria-hidden="true" />
            {t('export.bandCustom')}
          </ChoiceTile>
        </span>
      </div>
      {remembered && <p className="export__hint">{t('export.bandRemembered')}</p>}
      {picking && (
        <ColorPicker
          id={BAND_PICKER}
          hex={custom}
          used={used}
          onChange={(hex) => {
            setCustom(hex);
            onChange(hex);
          }}
          onClose={closePicker}
        />
      )}
    </fieldset>
  );
}

function pixelLabel(
  size: { width: number; height: number },
  language: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  return t('export.pixels', {
    width: size.width.toLocaleString(language),
    height: size.height.toLocaleString(language),
  });
}

interface ImagePreviewState {
  status: 'loading' | 'ready' | 'error' | 'empty';
  count: number;
  notReady: number;
}

/** Stage when nothing has measured it yet (tests, the first frame). */
const STAGE_FALLBACK = { width: 444, height: 340 };

/**
 * The picture as it will be exported: the frame is the file, what falls outside it is dimmed, and
 * the focus point moves the crop. Moving it only moves the canvases, so a drag redraws nothing.
 */
function ImagePreview({
  req,
  image,
  files,
  index,
  onIndex,
  onFocus,
  ready,
  env,
  state,
  onState,
  onMissing,
}: {
  req: ExportRequest;
  image: ImageOptions;
  /** "File originale": what will be downloaded instead of this picture. */
  files: OriginalsPlan | null;
  index: number;
  onIndex: (index: number) => void;
  onFocus: (focus: Focus) => void;
  ready: boolean;
  env: { current: ExportEnv };
  state: ImagePreviewState;
  onState: Dispatch<SetStateAction<ImagePreviewState>>;
  onMissing: (chars: string[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const hintId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ghost = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState(STAGE_FALLBACK);
  const [content, setContent] = useState<{
    width: number;
    height: number;
    pixels: { width: number; height: number };
    reduced: boolean;
    draw: (ctx: CanvasRenderingContext2D, scale: number) => void;
  } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0)
        setStage({ width: el.clientWidth, height: el.clientHeight || STAGE_FALLBACK.height });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const { aspect, fit, many, band } = image;
  // A new colour only repaints what is there: no "loading" while the picker is dragged.
  const paintedBand = useRef(band);
  // The focus point is left out on purpose: dragging it must not rebuild the picture.
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    if (paintedBand.current === band) onState((s) => ({ ...s, status: 'loading' }));
    paintedBand.current = band;
    const timer = setTimeout(async () => {
      try {
        const [{ buildPages }, { drawPage }] = await Promise.all([
          engine(),
          import('./render-canvas.ts'),
        ]);
        await document.fonts.load('600 12px Inter');
        await catalogsLoaded();
        const options = { aspect, fit, many, band, foci: {} };
        // Beside originals, the pictures of the cards that have a file.
        const shown = files?.cards.length
          ? { ...env.current, selection: new Set(files.cards.map((card) => card.id)) }
          : env.current;
        const built = await buildPages({ ...req, image: options }, shown, {
          preview: true,
          previewPage: index,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        onMissing(built.missing);
        const count = built.pages.length;
        if (count === 0) {
          setContent(null);
          onState({ status: 'empty', count: 0, notReady: 0 });
          return;
        }
        if (index >= count) {
          onIndex(0);
          return;
        }
        const page = built.pages[index];
        if (!page) return;
        const out = imagePages(built.pages, options);
        const at = out.pages[index] ?? page;
        const scale = out.scales[index] ?? 1;
        setContent({
          width: page.width,
          height: page.height,
          pixels: { width: Math.round(at.width * scale), height: Math.round(at.height * scale) },
          reduced: out.reduced,
          draw: (ctx, s) => drawPage(ctx, page, s, built.images, 0, built.fonts.headingFamily),
        });
        onState({ status: 'ready', count, notReady: built.notReady });
      } catch {
        if (!controller.signal.aborted) onState((s) => ({ ...s, status: 'error' }));
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [req, aspect, fit, many, band, files, index, ready, env, onMissing, onState, onIndex]);

  const social = aspect === 'original' ? null : ASPECT_PIXELS[aspect];
  const ratio = social
    ? social.width / social.height
    : content
      ? content.width / content.height
      : 3 / 2;
  const frame = frameInStage(stage, ratio);
  const filling = !!social && fit === 'fill';
  const focus = image.foci[index] ?? CENTRE;
  const at = content ? placeContent(content, frame, social ? fit : 'fit', focus) : null;
  const inner = at
    ? { left: at.x, top: at.y, width: at.width, height: at.height }
    : { left: 0, top: 0, width: 0, height: 0 };

  // Drawn once per picture and per size; the ghost is a copy.
  const drawnWidth = Math.round(inner.width);
  const drawnHeight = Math.round(inner.height);
  useEffect(() => {
    const el = canvas.current;
    if (!content || !el || drawnWidth === 0) return;
    const ratioOfDevice = window.devicePixelRatio || 1;
    el.width = Math.round(drawnWidth * ratioOfDevice);
    el.height = Math.round(drawnHeight * ratioOfDevice);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    content.draw(ctx, el.width / content.width);
    const copy = ghost.current;
    if (copy) {
      copy.width = el.width;
      copy.height = el.height;
      copy.getContext('2d')?.drawImage(el, 0, 0);
    }
  }, [content, drawnWidth, drawnHeight]);

  const shownFile: OriginalFile | undefined = files?.cards[index]?.file;
  const pixels =
    social ??
    (files
      ? shownFile?.width && shownFile.height
        ? { width: shownFile.width, height: shownFile.height }
        : null
      : (content?.pixels ?? null));
  const pixelText = pixels ? pixelLabel(pixels, i18n.language, t) : '';
  const aspectName = social ? aspect : t('export.aspectOriginal');
  const formatName = req.format === 'jpeg' ? t('export.formatJpeg') : t('export.formatPng');
  const loading = state.status === 'loading';
  const failed = state.status === 'error';
  const pagesOfDocument = req.what === 'storyboard' || req.what === 'shotlist';
  const dragTo = (e: PointerEvent<HTMLDivElement>) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return;
    onFocus(
      clampFocus({
        x: (e.clientX - box.left - frame.left) / frame.width,
        y: (e.clientY - box.top - frame.top) / frame.height,
      }),
    );
  };

  return (
    <figure className="export__preview export__preview--image">
      <div
        ref={stageRef}
        className={`export__stage${loading ? ' is-loading' : ''}`}
        data-testid="export-stage"
      >
        {state.status === 'empty' ? (
          <div className="export__empty">
            <div>
              <strong>{t('export.emptyTitle')}</strong>
              {req.audience === 'client' ? t('export.emptyClient') : t('export.emptyTeam')}
            </div>
          </div>
        ) : (
          <>
            {filling && !failed && (
              <canvas
                ref={ghost}
                className="export__ghost"
                style={{
                  left: frame.left + inner.left,
                  top: frame.top + inner.top,
                  width: inner.width,
                  height: inner.height,
                }}
              />
            )}
            <div
              className="export__frame"
              role="img"
              aria-label={`${t('export.previewImage')}: ${aspectName}, ${pixelText}`}
              style={{
                left: frame.left,
                top: frame.top,
                width: frame.width,
                height: frame.height,
                // Fit shows the bands; elsewhere the picture covers its frame.
                ...(social && fit === 'fit' ? { background: band } : {}),
              }}
            >
              {!failed && <canvas ref={canvas} className="export__picture" style={inner} />}
              {loading && <div className="export__skeleton" />}
            </div>
            <span className="export__tag">
              {aspectName} {pixelText && <small>· {pixelText}</small>}
            </span>
            {filling && !failed && (
              <div
                className="export__focus"
                tabIndex={0}
                role="slider"
                aria-label={t('export.focus')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(focus.x * 100)}
                aria-valuetext={t('export.focusValue', {
                  x: Math.round(focus.x * 100),
                  y: Math.round(focus.y * 100),
                })}
                aria-describedby={hintId}
                style={{
                  left: frame.left + frame.width * focus.x,
                  top: frame.top + frame.height * focus.y,
                }}
                onKeyDown={(e) => {
                  const next = focusAfterKey(focus, e.key, e.shiftKey);
                  if (!next) return;
                  e.preventDefault();
                  onFocus(next);
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.focus();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture?.(e.pointerId)) dragTo(e);
                }}
              />
            )}
            {loading && (
              <span className="export__stage-note" role="status">
                <span>{t('export.previewLoading')}</span>
              </span>
            )}
            {failed && (
              <span className="export__stage-note" role="alert">
                <span className="export__stage-error">{t('export.previewFailed')}</span>
              </span>
            )}
          </>
        )}
      </div>
      {state.count > 1 && (
        <div className="export__pager">
          <IconButton
            icon="chevronLeft"
            label={t('export.imagePrevious')}
            disabled={index === 0}
            onClick={() => onIndex(index - 1)}
          />
          <span aria-live="polite">
            {t('export.imageOf', { n: index + 1, total: state.count })}
          </span>
          <IconButton
            icon="chevronRight"
            label={t('export.imageNext')}
            disabled={index >= state.count - 1}
            onClick={() => onIndex(index + 1)}
          />
        </div>
      )}
      <figcaption className="export__hint">
        {state.status !== 'empty' &&
          (files
            ? files.files.length > 1
              ? t('export.filesZip', {
                  count: files.files.length,
                  size: formatBytes(
                    files.files.reduce((sum, file) => sum + file.size, 0),
                    i18n.language,
                  ),
                })
              : shownFile && `${shownFile.name} · ${formatBytes(shownFile.size, i18n.language)}`
            : pagesOfDocument
              ? [
                  `${t('export.previewImage')} · ${t('export.pages', { count: state.count })}`,
                  state.count > 1 ? t('export.pngPages') : '',
                  content?.reduced ? t('export.pngReduced') : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : state.count > 1
                ? `${t('export.imagesZip', { count: state.count })} · ${formatName}`
                : `${t('export.previewImage')} · ${pixelText} · ${formatName}`)}
      </figcaption>
      {filling && state.status !== 'empty' && (
        <p id={hintId} className="export__hint export__focus-hint">
          {t('export.focusHelp')}
        </p>
      )}
    </figure>
  );
}
