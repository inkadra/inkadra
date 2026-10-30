// SPDX-License-Identifier: AGPL-3.0-only
import { type Element, hiddenFromGuests, type VideoFrameSource } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureVideoFrame,
  formatSourceTime,
  frameChoices,
  placeVideoStill,
  uploadBoardId,
} from './frame-grab.ts';
import type { BoardStore } from './store.ts';
import { cancelUpload, startUpload } from './uploads.ts';
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
  const available =
    !readOnly &&
    ((external && element.type === 'link' && !!element.imageAssetId && asset?.kind === 'image') ||
      asset?.kind === 'video');
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLSelectElement>('select')?.focus();
  }, [open]);
  if (!available) return null;

  async function grab() {
    if (busy) return;
    if (open) {
      setOpen(false);
      button.current?.focus();
      return;
    }
    setError(false);
    if (external && element.type === 'link') {
      if (youtubeTime != null) setSeconds(Math.floor(youtubeTime));
      setSource({ kind: 'link-thumbnail', url: element.url });
      setOpen(true);
      return;
    }
    setBusy(true);
    try {
      const player = video.current;
      if (!player || !asset) throw new Error('missing-video');
      captureController.current = new AbortController();
      const captured = await captureVideoFrame(player, captureController.current.signal);
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

  function save(targetId: string | null) {
    if (!source || !allowed.current || busy || !asset) return;
    setError(false);
    if (navigator.onLine === false) {
      setBusy(false);
      setError(true);
      return;
    }
    const provenance: VideoFrameSource =
      source.kind === 'link-thumbnail' && youtube ? { ...source, timeSeconds: seconds } : source;
    const reference =
      youtube && element.type === 'link'
        ? (() => {
            const url = new URL(element.url);
            url.searchParams.delete('start');
            url.searchParams.set('t', String(Math.floor(seconds)));
            return url.href;
          })()
        : undefined;
    const commit = (assetId: string) => {
      uploadKey.current = null;
      pendingCommit.current = null;
      if (!mounted.current || !allowed.current) {
        if (mounted.current) setBusy(false);
        return;
      }
      const ok = placeVideoStill(store, {
        sourceId: element.id,
        targetId,
        assetId,
        source: provenance,
        userId,
        caption: `${element.type === 'link' ? element.title || element.url : asset.filename} · ${source.kind === 'uploaded-video' ? formatSourceTime(source.timeSeconds, i18n.language) : t('frameGrab.thumbnail')}`,
        reference,
      });
      setBusy(false);
      if (ok) {
        setFile(null);
        onDone();
      } else setError(true);
    };
    if (external) {
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
    uploadKey.current = startUpload({
      file,
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
      <button
        ref={button}
        type="button"
        className="ink-btn ink-btn--secondary viewer__stage-btn viewer__grab"
        aria-label={t(external ? 'frameGrab.thumbnail' : 'frameGrab.grab')}
        aria-keyshortcuts={external ? undefined : 'G'}
        aria-expanded={open}
        aria-controls={open || error ? 'frame-grab-options' : undefined}
        disabled={busy}
        onClick={() => void grab()}
      >
        <Icon name="image" size={18} />
        <span className="viewer__action-label">
          {t(external ? 'frameGrab.thumbnail' : 'frameGrab.grab')}
        </span>
        {!external && <span className="viewer__kbd">G</span>}
      </button>
      {(open || error) && (
        <section
          ref={panel}
          id="frame-grab-options"
          className="viewer__grab-options"
          aria-label={t('frameGrab.destination')}
        >
          <div className="viewer__title-row">
            <h2 className="viewer__title">{t('frameGrab.destination')}</h2>
            <button
              type="button"
              className="ink-btn ink-btn--ghost"
              aria-label={t('viewer.close')}
              onClick={() => {
                generation.current += 1;
                captureController.current?.abort();
                if (uploadKey.current) cancelUpload(uploadKey.current);
                uploadKey.current = null;
                pendingCommit.current = null;
                setBusy(false);
                setFile(null);
                setOpen(false);
                setError(false);
                button.current?.focus();
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {error && <p role="alert">{t('frameGrab.error')}</p>}
          {open && (
            <>
              <p className="ink-muted">
                {external
                  ? t('frameGrab.externalHint')
                  : t('frameGrab.captured', {
                      timecode:
                        source?.kind === 'uploaded-video'
                          ? formatSourceTime(source.timeSeconds, i18n.language)
                          : '',
                    })}
              </p>
              {youtube && (
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
              <label>
                {t('frameGrab.frame')}
                <select
                  className="ink-input"
                  value={target}
                  disabled={busy}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">{t('frameGrab.choose')}</option>
                  {frames.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {sourceHidden && target && !targetHidden && (
                <p className="ink-muted">{t('frameGrab.hiddenDestination')}</p>
              )}
              {!frames.length && <p className="ink-muted">{t('frameGrab.noFrames')}</p>}
              <button
                type="button"
                className="ink-btn ink-btn--primary"
                disabled={busy || !frames.some((f) => f.id === target)}
                onClick={() => save(target)}
              >
                {t('frameGrab.useFrame')}
              </button>
              <button
                type="button"
                className="ink-btn ink-btn--secondary"
                disabled={busy}
                onClick={() => save(null)}
              >
                {t('frameGrab.addBoard')}
              </button>
              {busy && <p role="status">{t('frameGrab.uploading')}</p>}
            </>
          )}
        </section>
      )}
    </>
  );
}
