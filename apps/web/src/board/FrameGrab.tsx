// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, VideoFrameSource } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { captureVideoFrame, frameChoices, placeVideoStill, uploadBoardId } from './frame-grab.ts';
import type { BoardStore } from './store.ts';
import { startUpload } from './uploads.ts';
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
  frameTime,
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
  frameTime?: () => number | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
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
  const pendingCommit = useRef<((assetId: string) => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const subscribe = store.subscribe ?? (() => () => {});
  const snapshot = store.getSnapshot ?? (() => null);
  const currentSnapshot = useSyncExternalStore(subscribe, snapshot, snapshot);
  const frames = currentSnapshot ? frameChoices(store) : [];
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
      const timeSeconds = frameTime?.() ?? player.currentTime;
      const captured = await captureVideoFrame(player);
      if (!mounted.current || !allowed.current) return;
      setFile(captured);
      setSource({ kind: 'uploaded-video', assetId: asset.id, timeSeconds });
      setOpen(true);
    } catch {
      setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function save(targetId: string | null) {
    if (!source || !allowed.current || busy || !asset) return;
    setError(false);
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
      if (!mounted.current || !allowed.current) return;
      const ok = placeVideoStill(store, {
        sourceId: element.id,
        targetId,
        assetId,
        source: provenance,
        userId,
        caption: `${element.type === 'link' ? element.title || element.url : asset.filename} · ${source.kind === 'uploaded-video' ? `${source.timeSeconds.toFixed(3)} s` : t('frameGrab.thumbnail')}`,
        reference,
      });
      setBusy(false);
      if (ok) onDone();
      else setError(true);
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
    startUpload({
      file,
      projectId,
      boardId,
      onAsset: () => {},
      onComplete: (assetId) => pendingCommit.current?.(assetId),
      onFailed: () => {
        if (mounted.current) {
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
        aria-controls="frame-grab-options"
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
              disabled={busy}
              aria-label={t('viewer.close')}
              onClick={() => {
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
                      seconds:
                        source?.kind === 'uploaded-video' ? source.timeSeconds.toFixed(3) : '',
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
