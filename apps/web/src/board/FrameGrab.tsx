// SPDX-License-Identifier: AGPL-3.0-only
import { type Element, hiddenFromGuests, type VideoFrameSource } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import { Button, Icon, Select } from '@inkadra/ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import {
  BlackFrame,
  canCaptureTab,
  captureTabFrame,
  captureVideoFrame,
  coarsePointer,
  cropPicture,
  formatSourceTime,
  frameChoices,
  NoFrame,
  placeVideoStill,
  uploadBoardId,
} from './frame-grab.ts';
import { FULL_CROP, isIdentityCrop } from './image-crop.ts';
import { isMac } from './shortcuts.ts';
import type { BoardStore } from './store.ts';
import { TabCaptureCrop } from './TabCaptureCrop.tsx';
import { cancelUpload, startUpload, useUploads } from './uploads.ts';
import { isVideoLink, isYoutubeUrl, parseYoutubeStartTime } from './youtube.ts';

export function FrameGrab({
  store,
  element,
  asset,
  video,
  userId,
  projectId,
  readOnly,
  initialFrameId,
  youtubeTime,
  embed,
  unavailable = false,
  onSaved,
  onDone,
}: {
  store: BoardStore;
  element: Extract<Element, { type: 'file' | 'image' | 'link' }>;
  asset: Asset | null;
  video: React.RefObject<HTMLVideoElement | null>;
  userId: string;
  projectId: string;
  readOnly: boolean;
  initialFrameId?: string;
  youtubeTime?: number | null;
  /** The player of a link: a photo of the tab is cut down to it where the browser can. */
  embed?: React.RefObject<HTMLElement | null>;
  /** The player said it cannot play this video here. */
  unavailable?: boolean;
  onSaved?: ((frameId: string | null, imageId: string | null) => void) | undefined;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<VideoFrameSource | null>(null);
  const [target, setTarget] = useState(initialFrameId ?? '');
  const [seconds, setSeconds] = useState(
    element.type === 'link' ? (parseYoutubeStartTime(element.url) ?? 0) : 0,
  );
  /** The local capture had to do: the server could not read the original. */
  const [fromCopy, setFromCopy] = useState(false);
  /** The photo of the tab, while it is being cropped. */
  const [shot, setShot] = useState<{ width: number; height: number } | null>(null);
  const [crop, setCrop] = useState(FULL_CROP);
  const [capturing, setCapturing] = useState(false);
  const [tabIssue, setTabIssue] = useState<'denied' | 'black' | 'noFrame' | 'failed' | null>(null);
  const lastTarget = useRef<string | null>(null);
  const screenshotInput = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const allowed = useRef(!readOnly);
  allowed.current = !readOnly;
  const mounted = useRef(true);
  const generation = useRef(0);
  const uploadKey = useRef<string | null>(null);
  const captureController = useRef<AbortController | null>(null);
  const pendingCommit = useRef<((assetId: string) => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    const offline = () => {
      if (!uploadKey.current) return;
      generation.current += 1;
      cancelUpload(uploadKey.current);
      uploadKey.current = null;
      pendingCommit.current = null;
      setBusy(false);
      setError(true);
    };
    window.addEventListener('offline', offline);
    return () => {
      mounted.current = false;
      generation.current += 1;
      captureController.current?.abort();
      if (uploadKey.current) cancelUpload(uploadKey.current);
      pendingCommit.current = null;
      window.removeEventListener('offline', offline);
    };
  }, []);
  const subscribe = store.subscribe ?? (() => () => {});
  const snapshot = store.getSnapshot ?? (() => null);
  const currentSnapshot = useSyncExternalStore(subscribe, snapshot, snapshot);
  const frames = currentSnapshot ? frameChoices(store) : [];
  const sourceHidden = currentSnapshot
    ? hiddenFromGuests(element.id, (id) => currentSnapshot.byId.get(id))
    : false;
  const targetHidden =
    target && currentSnapshot
      ? hiddenFromGuests(target, (id) => currentSnapshot.byId.get(id))
      : false;
  const external = element.type === 'link' && isVideoLink(element.url);
  const youtube = element.type === 'link' && isYoutubeUrl(element.url);
  const available = !readOnly && (external || asset?.kind === 'video');
  const uploads = useUploads();
  const uploading = uploadKey.current ? uploads.find((i) => i.key === uploadKey.current) : null;
  const takeScreenshot = (image: File) => {
    if (element.type !== 'link') return;
    setFile(image);
    setShot(null);
    setSource({ kind: 'link-thumbnail', url: element.url });
    setTabIssue(null);
    setError(false);
    setOpen(true);
  };
  const pasted = useRef(takeScreenshot);
  pasted.current = takeScreenshot;
  // Anywhere in the viewer, not only in the panel; never onto the board behind.
  useEffect(() => {
    if (!available || !external) return;
    const paste = (e: ClipboardEvent) => {
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!image) return;
      e.preventDefault();
      e.stopPropagation();
      pasted.current(image);
    };
    window.addEventListener('paste', paste, true);
    return () => window.removeEventListener('paste', paste, true);
  }, [available, external]);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('.ink-select')?.focus();
  }, [open]);
  if (!available) return null;
  const phone = coarsePointer();
  const hasThumbnail = external && asset?.kind === 'image';
  const service = youtube ? 'YouTube' : 'Vimeo';
  const tabOffered = canCaptureTab() && tabIssue !== 'failed';
  const takeThumbnail = () => {
    if (element.type !== 'link') return;
    setFile(null);
    setShot(null);
    setTabIssue(null);
    setSource({ kind: 'link-thumbnail', url: element.url });
  };
  /** The clipboard where the browser lets us read it; else a file to choose. */
  const pasteScreenshot = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((x) => x.startsWith('image/'));
        if (!type) continue;
        takeScreenshot(new File([await item.getType(type)], 'screenshot.png', { type }));
        return;
      }
    } catch {
      // Refused, or a browser without clipboard.read: the file picker still works.
    }
    screenshotInput.current?.click();
  };
  const captureTab = async () => {
    if (element.type !== 'link') return;
    const { url } = element;
    setTabIssue(null);
    setError(false);
    setSource(null);
    setFile(null);
    setShot(null);
    setCapturing(true);
    const controller = new AbortController();
    captureController.current = controller;
    const { signal } = controller;
    try {
      const captured = await captureTabFrame(embed?.current ?? null, signal);
      if (!mounted.current) return;
      setFile(captured.file);
      setShot({ width: captured.width, height: captured.height });
      setCrop(FULL_CROP);
      // shortcut: the only kind a link has in the schema, which stays as it is in this PR;
      // Info shows its address and time, so the name never reaches anyone.
      setSource({
        kind: 'link-thumbnail',
        url,
        ...(youtube && youtubeTime != null ? { timeSeconds: youtubeTime } : {}),
      });
    } catch (err) {
      if (!mounted.current || signal.aborted) return;
      if (err instanceof BlackFrame) setTabIssue('black');
      else if (err instanceof NoFrame) setTabIssue('noFrame');
      else if (err instanceof DOMException && err.name === 'NotAllowedError') setTabIssue('denied');
      else setTabIssue('failed');
    } finally {
      if (mounted.current) setCapturing(false);
    }
  };
  const closePanel = () => {
    generation.current += 1;
    captureController.current?.abort();
    if (uploadKey.current) cancelUpload(uploadKey.current);
    uploadKey.current = null;
    pendingCommit.current = null;
    setBusy(false);
    setFile(null);
    setShot(null);
    setSource(null);
    setTabIssue(null);
    setOpen(false);
    setError(false);
    button.current?.focus();
  };

  async function grab() {
    if (busy) return;
    if (open) {
      closePanel();
      return;
    }
    setError(false);
    setFromCopy(false);
    if (external && element.type === 'link') {
      if (youtubeTime != null) setSeconds(Math.floor(youtubeTime));
      setSource(null);
      setOpen(true);
      return;
    }
    setBusy(true);
    try {
      const player = video.current;
      if (!player || !asset) throw new Error('missing-video');
      captureController.current = new AbortController();
      const captured = await captureVideoFrame(player, captureController.current.signal);
      if (asset.proxy?.status === 'ready') {
        try {
          const bytes = await api.bytes(
            `/assets/${asset.id}/frame?time=${captured.timeSeconds}`,
            captureController.current.signal,
          );
          captured.file = new File([bytes as BlobPart], captured.file.name, { type: 'image/png' });
        } catch (err) {
          if (captureController.current?.signal.aborted) throw err;
          // Past the last frame, a busy server, no ffmpeg: the frame on screen is still good.
          setFromCopy(true);
        }
      }
      if (!mounted.current || !allowed.current) return;
      setFile(captured.file);
      setSource({ kind: 'uploaded-video', assetId: asset.id, timeSeconds: captured.timeSeconds });
      setOpen(true);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function save(targetId: string | null) {
    if (!source || !allowed.current || busy || (!file && !asset)) return;
    lastTarget.current = targetId;
    setError(false);
    if (navigator.onLine === false) {
      setBusy(false);
      setError(true);
      return;
    }
    const provenance: VideoFrameSource =
      source.kind === 'link-thumbnail' && youtube ? { ...source, timeSeconds: seconds } : source;
    const commit = (assetId: string) => {
      uploadKey.current = null;
      pendingCommit.current = null;
      if (!mounted.current || !allowed.current) {
        if (mounted.current) setBusy(false);
        return;
      }
      const placed = placeVideoStill(store, {
        sourceId: element.id,
        targetId,
        assetId,
        // A screenshot someone supplied can show anything: it claims no origin.
        source: external && file && !shot ? undefined : provenance,
        userId,
      });
      setBusy(false);
      if (placed) {
        setFile(null);
        onSaved?.(targetId, targetId ? null : placed);
        onDone();
      } else setError(true);
    };
    if (external && !file && asset) {
      commit(asset.id);
      return;
    }
    const boardId = uploadBoardId(store);
    if (!file || !boardId) {
      setError(true);
      return;
    }
    setBusy(true);
    pendingCommit.current = commit;
    const run = ++generation.current;
    let upload = file;
    if (shot && !isIdentityCrop(crop)) {
      try {
        upload = await cropPicture(file, crop);
      } catch {
        setBusy(false);
        setError(true);
        return;
      }
      if (run !== generation.current) return;
    }
    uploadKey.current = startUpload({
      file: upload,
      projectId,
      boardId,
      onAsset: () => {},
      onComplete: (assetId) => {
        if (run === generation.current) pendingCommit.current?.(assetId);
      },
      onFailed: () => {
        if (mounted.current && run === generation.current) {
          generation.current += 1;
          if (uploadKey.current) cancelUpload(uploadKey.current);
          uploadKey.current = null;
          pendingCommit.current = null;
          setBusy(false);
          setError(true);
        }
      },
    });
  }

  return (
    <>
      <input
        ref={screenshotInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked?.type.startsWith('image/')) takeScreenshot(picked);
        }}
      />
      <button
        ref={button}
        type="button"
        className="ink-btn ink-btn--secondary viewer__stage-btn viewer__grab"
        aria-label={t('frameGrab.grab')}
        aria-keyshortcuts={external ? undefined : 'G'}
        aria-expanded={open}
        aria-controls={open || error ? 'frame-grab-options' : undefined}
        disabled={busy || capturing}
        onClick={() => void grab()}
      >
        <Icon name="image" size={18} />
        <span className="viewer__action-label">{t('frameGrab.grab')}</span>
        {!external && <span className="viewer__kbd">G</span>}
      </button>
      {shot && file && open && (
        <TabCaptureCrop
          file={file}
          width={shot.width}
          height={shot.height}
          crop={crop}
          onCrop={setCrop}
        />
      )}
      {(open || error) && !capturing && (
        <section
          ref={panel}
          id="frame-grab-options"
          className="viewer__grab-options"
          aria-label={
            external && !source ? t('frameGrab.tabDialog', { service }) : t('frameGrab.destination')
          }
        >
          <div className="viewer__title-row">
            <h2 className="viewer__title">
              {shot
                ? t('frameGrab.tabCaptured')
                : external && !source
                  ? t('frameGrab.tabTitle')
                  : t('frameGrab.destination')}
            </h2>
            <button
              type="button"
              className="ink-btn ink-btn--ghost"
              aria-label={t('viewer.close')}
              onClick={closePanel}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {error && (
            <div className="viewer__grab-call is-danger" role="alert">
              <b>{t('frameGrab.errorTitle')}</b>
              <p>{t('frameGrab.error')}</p>
              <Button
                variant="secondary"
                onClick={() => (source ? void save(lastTarget.current) : void grab())}
              >
                {t('frameGrab.retry')}
              </Button>
            </div>
          )}
          {open && external && !source && (
            <>
              {unavailable ? (
                <div className="viewer__grab-call is-danger" role="alert">
                  <b>{t('frameGrab.blockedTitle')}</b>
                  <p>{t('frameGrab.blocked')}</p>
                  {element.type === 'link' && (
                    <a
                      className="ink-btn ink-btn--secondary"
                      href={element.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('frameGrab.openYoutube')}
                    </a>
                  )}
                </div>
              ) : tabIssue === 'denied' ? (
                <div className="viewer__grab-call is-danger" role="alert">
                  <b>{t('frameGrab.deniedTitle')}</b>
                  <p>{t('frameGrab.denied')}</p>
                  <Button variant="secondary" onClick={() => void captureTab()}>
                    {t('frameGrab.retry')}
                  </Button>
                </div>
              ) : tabIssue === 'black' ? (
                <div className="viewer__grab-call is-danger" role="alert">
                  <b>{t('frameGrab.blackTitle')}</b>
                  <p>{t('frameGrab.black')}</p>
                </div>
              ) : tabIssue === 'noFrame' ? (
                <div className="viewer__grab-call is-danger" role="alert">
                  <b>{t('frameGrab.noFrameTitle')}</b>
                  <p>{t('frameGrab.noFrame')}</p>
                  <Button variant="secondary" onClick={() => void captureTab()}>
                    {t('frameGrab.retry')}
                  </Button>
                </div>
              ) : tabOffered ? (
                <>
                  <p>{t('frameGrab.tabBody', { service })}</p>
                  <ul className="viewer__grab-list">
                    <li>{t('frameGrab.tabPause')}</li>
                    <li>{t('frameGrab.tabSubtitles')}</li>
                    <li>{t('frameGrab.tabQuality')}</li>
                  </ul>
                  <div className="viewer__grab-row">
                    <Button variant="ghost" onClick={closePanel}>
                      {t('frameGrab.cancel')}
                    </Button>
                    <Button variant="primary" onClick={() => void captureTab()}>
                      {t('frameGrab.tabContinue')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="viewer__grab-call is-warn">
                  <b>{t('frameGrab.noTabTitle')}</b>
                  <p>{t(phone ? 'frameGrab.noTabPhone' : 'frameGrab.noTabDesktop')}</p>
                </div>
              )}
              <hr className="menu__divider" />
              {phone ? (
                <button
                  type="button"
                  className="menu__item viewer__grab-item"
                  onClick={() => screenshotInput.current?.click()}
                >
                  <Icon name="upload" size={16} />
                  {t('frameGrab.screenshot')}
                </button>
              ) : (
                <button
                  type="button"
                  className="menu__item viewer__grab-item"
                  aria-keyshortcuts={isMac() ? 'Meta+V' : 'Control+V'}
                  onClick={() => void pasteScreenshot()}
                >
                  <Icon name="image" size={16} />
                  {t(tabOffered && !tabIssue ? 'frameGrab.pasteOr' : 'frameGrab.paste')}
                  <span className="menu__key">{isMac() ? '⌘V' : 'Ctrl+V'}</span>
                </button>
              )}
              {hasThumbnail && (
                <button
                  type="button"
                  className="menu__item viewer__grab-item"
                  onClick={takeThumbnail}
                >
                  <Icon name="film" size={16} />
                  {t('frameGrab.thumbnailVideo')}
                </button>
              )}
            </>
          )}
          {open && (!external || source) && (
            <>
              {shot ? (
                <>
                  <span className="film-chip viewer__grab-quality">
                    {t('frameGrab.tabQualityChip', {
                      width: Math.round(shot.width * crop.w),
                      height: Math.round(shot.height * crop.h),
                    })}
                  </span>
                  <p className="ink-muted">{t('frameGrab.cropHint')}</p>
                </>
              ) : (
                !external && (
                  <p className="ink-muted">
                    {t(fromCopy ? 'frameGrab.capturedCopy' : 'frameGrab.captured', {
                      timecode:
                        source?.kind === 'uploaded-video'
                          ? formatSourceTime(source.timeSeconds, i18n.language)
                          : '',
                    })}
                  </p>
                )
              )}
              {file && external && !shot && <p className="ink-muted">{file.name}</p>}
              {youtube && !file && (
                <label>
                  {t('frameGrab.referenceTime')}
                  <input
                    className="ink-input"
                    type="number"
                    min="0"
                    step="1"
                    value={seconds}
                    onChange={(e) => {
                      const time = Number(e.target.value);
                      setSeconds(Number.isFinite(time) ? Math.max(0, time) : 0);
                    }}
                  />
                </label>
              )}
              {/* biome-ignore lint/a11y/noLabelWithoutControl: Select renders a labelable button. */}
              <label>
                {t('frameGrab.frame')}
                <Select
                  className="ink-input"
                  value={target}
                  disabled={busy}
                  onChange={(e) => setTarget(e)}
                >
                  <option value="">{t('frameGrab.choose')}</option>
                  {frames.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </label>
              {sourceHidden && target && !targetHidden && (
                <p className="ink-muted">{t('frameGrab.hiddenDestination')}</p>
              )}
              {!frames.length && <p className="ink-muted">{t('frameGrab.noFrames')}</p>}
              <button
                type="button"
                className={`ink-btn ${target ? 'ink-btn--primary' : 'ink-btn--secondary'}`}
                disabled={busy || !frames.some((f) => f.id === target)}
                onClick={() => void save(target)}
              >
                {t('frameGrab.useFrame')}
              </button>
              <button
                type="button"
                className={`ink-btn ${target ? 'ink-btn--secondary' : 'ink-btn--primary'}`}
                disabled={busy}
                onClick={() => void save(null)}
              >
                {t('frameGrab.addBoard')}
              </button>
              {shot && (
                <Button variant="ghost" disabled={busy} onClick={() => void captureTab()}>
                  {t('frameGrab.tabAgain')}
                </Button>
              )}
              {shot && <p className="ink-muted">{t('frameGrab.noText')}</p>}
              {busy && (
                <>
                  <p role="status">{t('frameGrab.uploading')}</p>
                  {uploading && (
                    <span
                      className="viewer__grab-bar"
                      role="progressbar"
                      aria-valuenow={Math.round(
                        (uploading.sent / Math.max(1, uploading.size)) * 100,
                      )}
                    >
                      <span
                        style={{
                          width: `${(uploading.sent / Math.max(1, uploading.size)) * 100}%`,
                        }}
                      />
                    </span>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
