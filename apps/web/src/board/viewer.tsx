// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, updateElement } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { type Asset, isRawImageType } from '@inkadra/shared';
import { Avatar, Button, Icon } from '@inkadra/ui';
import { memo, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassifications } from '../lib/classifications.ts';
import { pickVariant, playbackUrl, useAsset } from './assets.ts';
import { CroppedImage } from './CroppedImage.tsx';
import { GuestModeContext } from './context.ts';
import { FrameGrab } from './FrameGrab.tsx';
import { fileBadge, fileFamily, isPdf } from './file-kinds.ts';
import { VideoFrameStepper } from './frame-grab.ts';
import { hasImageTransform } from './image-crop.ts';
import { playInline } from './inline-player.ts';
import { MovingPicture, movingVariantUrl } from './moving.tsx';
import { authorName, editableText } from './review-model.ts';
import { canComment, openComments, useReviews } from './review-store.ts';
import { isTyping } from './shortcuts.ts';
import { type BoardStore, LOCAL } from './store.ts';
import { TagEditor } from './tags.tsx';
import {
  isVideoLink,
  isYoutubeUrl,
  videoEmbedUrl,
  YOUTUBE_ORIGIN,
  youtubePlayerTime,
} from './youtube.ts';

type Exif = Record<string, unknown>;

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** 1/250 s for short exposures, 2.5 s for long ones. */
export function shutterText(seconds: number): string {
  if (seconds >= 1) return `${Math.round(seconds * 10) / 10} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

/** The EXIF fields worth showing, in the order a photographer reads them. */
export function exifRows(exif: Exif | null, locale: string): Array<{ key: string; value: string }> {
  if (!exif) return [];
  const rows: Array<{ key: string; value: string }> = [];
  const add = (key: string, value: string) => value && rows.push({ key, value });
  const make = text(exif.Make);
  const model = text(exif.Model);
  add('camera', model.startsWith(make) ? model : [make, model].filter(Boolean).join(' '));
  add('lens', text(exif.LensModel));
  const focal = typeof exif.FocalLength === 'number' ? `${Math.round(exif.FocalLength)} mm` : '';
  const ff =
    typeof exif.FocalLengthIn35mmFormat === 'number' &&
    exif.FocalLengthIn35mmFormat !== Math.round(Number(exif.FocalLength))
      ? ` (${exif.FocalLengthIn35mmFormat} mm eq.)`
      : '';
  add('focal', focal && focal + ff);
  add('aperture', typeof exif.FNumber === 'number' ? `ƒ/${exif.FNumber}` : '');
  add('shutter', typeof exif.ExposureTime === 'number' ? shutterText(exif.ExposureTime) : '');
  add('iso', text(exif.ISO));
  const taken = text(exif.DateTimeOriginal);
  const date = taken ? new Date(taken) : null;
  add(
    'taken',
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
      : '',
  );
  return rows;
}

/** MediaError SRC_NOT_SUPPORTED (4) or DECODE (3) */
export function isUnplayableVideoError(code: number | null | undefined): boolean {
  return !code || code === 3 || code === 4;
}

/** Monitors playback and media error events to detect unsupported codecs (e.g. ProRes). */
export function useVideoUnplayable(url: string | null | undefined, assetId: string | undefined) {
  const [unplayable, setUnplayable] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resets unplayable state when the element or asset changes
  useEffect(() => {
    setUnplayable(false);
  }, [assetId, url]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attaches listeners when the url changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const check = () => {
      if (video.error && isUnplayableVideoError(video.error.code)) {
        setUnplayable(true);
        return;
      }
      if (video.networkState === 3 /* NETWORK_NO_SOURCE */) {
        setUnplayable(true);
      }
    };

    // Listen for media errors dispatched by the browser
    if (video.networkState === 3 /* NETWORK_NO_SOURCE */) {
      setUnplayable(true);
    }

    video.addEventListener('error', check);

    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const startStallCheck = () => {
      if (stallTimer) return;
      stallTimer = setTimeout(() => {
        if (
          !video.paused &&
          video.currentTime === 0 &&
          (video.readyState < 2 || video.videoWidth === 0)
        ) {
          setUnplayable(true);
        }
      }, 2000);
    };

    const clearStallCheck = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      if (video.currentTime > 0 || video.readyState >= 2) {
        setUnplayable(false);
      }
    };

    video.addEventListener('play', startStallCheck);
    video.addEventListener('waiting', startStallCheck);
    video.addEventListener('stalled', startStallCheck);
    video.addEventListener('timeupdate', clearStallCheck);
    video.addEventListener('playing', clearStallCheck);

    return () => {
      video.removeEventListener('error', check);
      video.removeEventListener('play', startStallCheck);
      video.removeEventListener('waiting', startStallCheck);
      video.removeEventListener('stalled', startStallCheck);
      video.removeEventListener('timeupdate', clearStallCheck);
      video.removeEventListener('playing', clearStallCheck);
      if (stallTimer) clearTimeout(stallTimer);
    };
  }, [url]);

  return { videoRef, unplayable, setUnplayable };
}

/** Shown over the poster when the browser cannot decode a video format (e.g. ProRes). */
export function VideoUnplayable({
  poster,
  filename,
  downloadUrl,
  downloadLabel,
  message,
  className = 'viewer__unplayable',
  mediaClassName = 'viewer__media',
  scrimClassName = 'viewer__unplayable-scrim',
  msgClassName = 'viewer__unplayable-msg',
}: {
  poster?: string;
  filename?: string;
  downloadUrl?: string;
  downloadLabel: string;
  message: string;
  className?: string;
  mediaClassName?: string;
  scrimClassName?: string;
  msgClassName?: string;
}) {
  return (
    <div className={className}>
      {poster && <img className={mediaClassName} src={poster} alt={filename} />}
      <div className={scrimClassName}>
        <p className={msgClassName}>{message}</p>
        {downloadUrl && (
          <a className="ink-btn ink-btn--secondary" href={downloadUrl} download={filename ?? ''}>
            {downloadLabel}
          </a>
        )}
      </div>
    </div>
  );
}

const ThumbnailImage = memo(function ThumbnailImage({
  assetId,
  alt,
}: {
  assetId?: string;
  alt?: string;
}) {
  const asset = useAsset(assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  if (!ready) {
    return <span className="viewer__thumb-placeholder" />;
  }
  return (
    <img
      className="viewer__thumb-img"
      src={pickVariant(ready, 120) || ready.url}
      alt={alt ?? ''}
      loading="lazy"
    />
  );
});

/** Thumbnails farther than this from the current item stay empty until it gets close. */
const THUMB_WINDOW = 10;

export interface GalleryItem {
  id: string;
  assetId?: string;
  filename?: string;
  type?: 'image' | 'file' | 'link';
}

/** Full view of an image or a video, with its shooting data, palette and tags. */
export function MediaViewer({
  store,
  element,
  projectId,
  userId,
  readOnly,
  onClose,
  gallery,
  initialFrameId,
}: {
  initialFrameId?: string;
  store: BoardStore;
  element: Extract<Element, { type: 'image' | 'file' | 'link' }>;
  projectId: string;
  userId: string;
  readOnly: boolean;
  onClose: () => void;
  gallery?: {
    index: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
    onSelect?: (index: number) => void;
    usedIn: string[];
    items?: GalleryItem[];
  };
}) {
  const { tagLabel } = useClassifications();
  const { t, i18n } = useTranslation();
  const assetId = element.type === 'link' ? element.imageAssetId : element.assetId;
  const asset = useAsset(assetId);
  const isYoutube = element.type === 'link' && isYoutubeUrl(element.url);
  const embedUrl =
    element.type === 'link' && isVideoLink(element.url) ? videoEmbedUrl(element.url) : null;
  const ready: Asset | null = asset && asset !== 'missing' ? asset : null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [youtubeTime, setYoutubeTime] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset player time when navigating gallery items
  useEffect(() => {
    setYoutubeTime(null);
    if (!isYoutube) return;
    const receive = (event: MessageEvent) => {
      const time = youtubePlayerTime(event, iframeRef.current?.contentWindow ?? null);
      if (time !== null) setYoutubeTime(time);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [element.id, isYoutube]);
  // A video playing on its card must not keep going behind the viewer.
  useEffect(() => {
    playInline(null);
  }, []);
  const [copied, setCopied] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset original toggle when switching elements
  useEffect(() => {
    setShowOriginal(false);
  }, [element.id]);
  const isTransformedImage = element.type === 'image' && hasImageTransform(element);
  const { videoRef, unplayable, setUnplayable } = useVideoUnplayable(
    ready ? playbackUrl(ready) : undefined,
    ready?.id,
  );

  const stepper = useRef(new VideoFrameStepper());
  const [videoPaused, setVideoPaused] = useState(false);
  useEffect(() => {
    const player = videoRef.current;
    if (!player || !ready?.id) return;
    stepper.current = new VideoFrameStepper();
    return stepper.current.start(player);
  }, [ready?.id, videoRef]);

  const guestMode = useContext(GuestModeContext);
  const threads = useReviews((s) => s.threads);
  const reviewsReady = useReviews((s) => s.status);
  const reviewsBoard = useReviews((s) => s.boardId);
  const reviewsPreview = useReviews((s) => s.preview);
  const mayComment = useReviews((s) => canComment(s.role));
  const showComments = !guestMode && !reviewsPreview && reviewsBoard !== null;
  const elementThreads = threads.filter((th) => th.elementId === element.id && !th.resolvedAt);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) && e.key !== 'Escape' && e.key !== 'Tab') return;
      // The canvas behind listens on window too.
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      if (e.key === 'Escape' && dialogRef.current?.querySelector('.viewer__grab-options')) {
        e.preventDefault();
        dialogRef.current.querySelector<HTMLButtonElement>('.viewer__grab-options button')?.click();
        return;
      }
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dialogRef.current?.querySelector<HTMLButtonElement>('.viewer__grab')?.click();
        return;
      }
      if (
        (e.key === ',' ||
          e.key === '.' ||
          (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) &&
        videoRef.current?.paused
      ) {
        e.preventDefault();
        stepper.current.step(videoRef.current, e.key === ',' || e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (gallery && !e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        gallery.onPrevious();
      }
      if (gallery && !e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        gallery.onNext();
      }
      if (e.key === 'Tab') {
        const focusable = [
          ...(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input, select, textarea, video[controls], [tabindex="0"]',
          ) ?? []),
        ].filter(
          (el) =>
            el.checkVisibility?.({ checkVisibilityCSS: true }) ?? el.getClientRects().length > 0,
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !focusable.includes(document.activeElement as HTMLElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !focusable.includes(document.activeElement as HTMLElement))
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [onClose, gallery, videoRef]);

  // Focus once on opening, keep it during navigation, give it back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const dialog = dialogRef.current;
    return () => {
      // Unless the parent already moved focus elsewhere.
      const active = document.activeElement;
      const lost = !active || active === document.body || dialog?.contains(active);
      if (opener && opener !== document.body && opener.isConnected && lost) opener.focus();
    };
  }, []);

  const rows = exifRows(ready?.exif ?? null, i18n.language);
  const palette = ready?.palette ?? [];
  const wide = Math.min(2400, window.innerWidth * (window.devicePixelRatio || 1));

  function addColors() {
    store.undo.stopCapturing();
    store.doc.transact(() => {
      palette.forEach((hex, i) => {
        createElement(
          store.doc,
          'color',
          { x: element.x + element.w + 24 + (i % 3) * 132, y: element.y + Math.floor(i / 3) * 132 },
          { hex },
          { userId, origin: LOCAL },
        );
      });
    }, LOCAL);
    onClose();
  }

  async function copyAllPalette() {
    if (!palette.length || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(palette.join(' '));
      setCopied('all');
    } catch {
      // clipboard write denied or unavailable
    }
  }

  const onVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    if (isUnplayableVideoError(e.currentTarget.error?.code)) {
      setUnplayable(true);
    }
  };

  const displayName =
    element.type === 'link'
      ? element.title || element.url
      : (ready?.filename ?? (element.type === 'image' ? element.caption : '') ?? t('viewer.title'));

  return (
    <div
      ref={dialogRef}
      className={`viewer${infoOpen ? ' viewer--info-open' : ''}`}
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-label={displayName}
      data-chrome
    >
      <div className="viewer__stage-container">
        {/* Stage Top Bar */}
        <header className="viewer__stage-header">
          <span className="viewer__stage-title">{displayName}</span>
          {gallery && (
            <span className="viewer__stage-counter">
              {gallery.index + 1} / {gallery.total}
            </span>
          )}
          {element.tags?.map((tag) => (
            <span key={tag} className="viewer__tag-badge">
              {tagLabel(tag)}
            </span>
          ))}
          <div className="viewer__header-spacer" />
          {isTransformedImage && (
            <button
              type="button"
              className="ink-btn ink-btn--secondary viewer__stage-btn viewer__original-toggle"
              aria-pressed={showOriginal}
              aria-label={t(showOriginal ? 'viewer.showEdited' : 'viewer.showOriginal')}
              onClick={() => setShowOriginal((prev) => !prev)}
            >
              <span className="viewer__action-icon" aria-hidden="true">
                <Icon name="image" size={18} />
              </span>
              <span className="viewer__action-label">
                {t(showOriginal ? 'viewer.showEdited' : 'viewer.showOriginal')}
              </span>
            </button>
          )}
          <FrameGrab
            key={element.id}
            store={store}
            element={element}
            asset={ready}
            video={videoRef}
            projectId={projectId}
            userId={userId}
            readOnly={readOnly || guestMode}
            initialFrameId={initialFrameId}
            youtubeTime={youtubeTime}
            onDone={onClose}
          />
          <button
            type="button"
            className="ink-btn ink-btn--secondary viewer__stage-btn viewer__info-toggle"
            aria-expanded={infoOpen}
            aria-controls="viewer-info"
            onClick={() => setInfoOpen((open) => !open)}
          >
            {t('viewer.info')}
          </button>
          <button
            type="button"
            className="ink-btn ink-btn--secondary viewer__stage-btn"
            onClick={onClose}
            aria-label={t('viewer.close')}
          >
            <span className="viewer__action-icon" aria-hidden="true">
              <Icon name="close" size={18} />
            </span>
            <span className="viewer__action-label">{t('viewer.close')}</span>{' '}
            <span className="viewer__kbd">{t('viewer.keys.esc')}</span>
          </button>
        </header>

        {/* Stage Area */}
        <div
          className="viewer__stage"
          onPointerDown={(e) => e.target === e.currentTarget && onClose()}
        >
          {/* Navigation Arrows */}
          {gallery && (
            <>
              <button
                type="button"
                className="viewer__stage-nav viewer__stage-nav--prev"
                disabled={gallery.index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  gallery.onPrevious();
                }}
                aria-label={t('moodboard.previous')}
              >
                <svg className="viewer__nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M15 5l-7 7 7 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="viewer__stage-nav viewer__stage-nav--next"
                disabled={gallery.index === gallery.total - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  gallery.onNext();
                }}
                aria-label={t('moodboard.next')}
              >
                <svg className="viewer__nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9 5l7 7-7 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          )}

          <div className={`viewer__media-wrap${embedUrl ? ' viewer__media-wrap--embed' : ''}`}>
            {embedUrl ? (
              <div className="viewer__embed">
                <iframe
                  ref={iframeRef}
                  className="viewer__iframe"
                  src={
                    isYoutube
                      ? `${embedUrl}&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
                      : embedUrl
                  }
                  onLoad={() =>
                    isYoutube &&
                    iframeRef.current?.contentWindow?.postMessage(
                      JSON.stringify({ event: 'listening', id: 'inkadra-viewer' }),
                      YOUTUBE_ORIGIN,
                    )
                  }
                  title={
                    (element.type === 'link' && element.title) ||
                    (isYoutube ? 'YouTube video' : 'Vimeo video')
                  }
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : ready?.kind === 'video' ? (
              <>
                {/* biome-ignore lint/a11y/useMediaCaption: people's own footage has no captions */}
                <video
                  ref={videoRef}
                  className="viewer__media viewer__media--contain"
                  src={playbackUrl(ready)}
                  poster={ready.variants.length > 0 ? pickVariant(ready, wide) : undefined}
                  controls
                  autoPlay
                  onError={onVideoError}
                  onPlay={() => setVideoPaused(false)}
                  onPause={() => setVideoPaused(true)}
                  onLoadedData={(e) => setVideoPaused(e.currentTarget.paused)}
                  style={unplayable ? { display: 'none' } : undefined}
                />
                {unplayable && (
                  <VideoUnplayable
                    poster={ready.variants.length > 0 ? pickVariant(ready, wide) : undefined}
                    filename={ready.filename}
                    downloadUrl={ready.url}
                    downloadLabel={t('viewer.download')}
                    message={t('viewer.unplayable')}
                  />
                )}
              </>
            ) : ready?.kind === 'audio' ? (
              <div className="viewer__file">
                <span className={`fcard__tile fbadge--${fileFamily(ready)}`} aria-hidden="true">
                  {fileBadge(ready) || <Icon name="volume" size={18} />}
                </span>
                {/* biome-ignore lint/a11y/useMediaCaption: people's own recordings have no captions */}
                <audio className="viewer__audio" src={ready.url} controls autoPlay />
              </div>
            ) : ready &&
              !pickVariant(ready, wide) &&
              (ready.kind !== 'image' || isRawImageType(ready.mime)) ? (
              <div className="viewer__file">
                <span className={`fcard__tile fbadge--${fileFamily(ready)}`} aria-hidden="true">
                  {fileBadge(ready) || <Icon name="file" size={18} />}
                </span>
                <p className="viewer__file-msg">{t('viewer.noView')}</p>
                <a className="ink-btn ink-btn--primary" href={ready.url} download={ready.filename}>
                  <Icon name="download" size={16} />
                  {t('viewer.download')}
                </a>
              </div>
            ) : ready && isPdf(ready) ? (
              // No PDF view yet (pdf.js comes with #294): page 1 and the download.
              <div className="viewer__file viewer__file--pdf">
                <img
                  className="viewer__media viewer__media--contain viewer__pdf-page"
                  src={pickVariant(ready, wide)}
                  alt={ready.filename}
                />
                <div className="viewer__pdf-bar">
                  {ready.pageCount && (
                    <span>{t('viewer.pageOne', { count: ready.pageCount })}</span>
                  )}
                  <a
                    className="ink-btn ink-btn--primary"
                    href={ready.url}
                    download={ready.filename}
                  >
                    <Icon name="download" size={16} />
                    {t('viewer.download')}
                  </a>
                </div>
              </div>
            ) : ready ? (
              isTransformedImage && !showOriginal ? (
                <CroppedImage
                  className="viewer__media viewer__media--contain"
                  poster={pickVariant(ready, wide) || ready.url}
                  moving={movingVariantUrl(ready, wide)}
                  alt={element.caption ?? ready.filename}
                  width={ready.width}
                  height={ready.height}
                  crop={element.crop}
                  rotation={element.rotation}
                />
              ) : (
                <MovingPicture
                  className="viewer__media viewer__media--contain"
                  poster={pickVariant(ready, wide) || ready.url}
                  moving={movingVariantUrl(ready, wide)}
                  alt={
                    element.type === 'image' ? (element.caption ?? ready.filename) : ready.filename
                  }
                />
              )
            ) : null}
          </div>

          {/* Bottom Hints */}
          {(ready?.kind !== 'video' || videoPaused) && (
            <div className="viewer__hints">
              <span className="viewer__hint">
                <span className="viewer__hint-kbd">
                  {ready?.kind === 'video' ? ', / . · ⇧ ← / →' : '← →'}
                </span>{' '}
                {t(ready?.kind === 'video' ? 'frameGrab.stepHint' : 'viewer.hints.nav')}
              </span>
            </div>
          )}
        </div>

        {/* Thumbnails Strip */}
        {gallery?.items && gallery.items.length > 1 && (
          <nav className="viewer__thumbnails" aria-label={t('viewer.thumbnails')}>
            {gallery.items.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                aria-current={idx === gallery.index ? 'true' : undefined}
                className={`viewer__thumb${idx === gallery.index ? ' is-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  gallery.onSelect?.(idx);
                }}
                data-ink-tooltip={item.filename || t('viewer.item', { n: idx + 1 })}
                aria-label={item.filename || t('viewer.item', { n: idx + 1 })}
              >
                {Math.abs(idx - gallery.index) <= THUMB_WINDOW ? (
                  <ThumbnailImage assetId={item.assetId} alt="" />
                ) : (
                  <span className="viewer__thumb-placeholder" />
                )}
                <span className="viewer__thumb-idx">{idx + 1}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Sidebar Details */}
      <aside id="viewer-info" className="viewer__side" data-scroll>
        {gallery && !ready && (
          <p role="status">
            {t(asset === 'missing' ? 'moodboard.unavailable' : 'moodboard.loading')}
          </p>
        )}

        {gallery && gallery.usedIn.length > 0 && (
          <section>
            <h3 className="viewer__title">{t('moodboard.usedIn')}</h3>
            <div className="viewer__used-in">
              {gallery.usedIn.map((label) => (
                <span key={label} className="viewer__used-chip">
                  {label}
                </span>
              ))}
            </div>
          </section>
        )}

        {ready?.width && ready.height && (
          <dl className="viewer__facts">
            <dt>{t('viewer.size')}</dt>
            <dd>
              {ready.width} × {ready.height}
            </dd>
          </dl>
        )}

        {element.type === 'link' && element.description && (
          <section>
            <p className="ink-muted viewer__desc">{element.description}</p>
          </section>
        )}

        {element.type !== 'link' && ready?.kind === 'image' && (
          <section>
            <h3 className="viewer__title">{t('viewer.exif')}</h3>
            {rows.length === 0 ? (
              <p className="ink-muted viewer__none">{t('viewer.noExif')}</p>
            ) : (
              <dl className="viewer__facts">
                {rows.map((r) => (
                  <div key={r.key} className="viewer__fact">
                    <dt>{t(`viewer.fields.${r.key}`)}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}

        {palette.length > 0 && (
          <section>
            <div className="viewer__title-row">
              <h3 className="viewer__title">{t('viewer.palette')}</h3>
              <button type="button" className="viewer__copy-all-btn" onClick={copyAllPalette}>
                {t('viewer.copyAll')}
              </button>
            </div>
            <div className="viewer__palette">
              {palette.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className="viewer__swatch"
                  style={{ background: hex }}
                  aria-label={t('viewer.copyHex', { hex })}
                  data-ink-tooltip={t('viewer.copyHex', { hex })}
                  onClick={async () => {
                    if (!navigator.clipboard?.writeText) return;
                    try {
                      await navigator.clipboard.writeText(hex);
                      setCopied(hex);
                    } catch {
                      // clipboard write denied or unavailable
                    }
                  }}
                >
                  <span className="ink-mono">{hex}</span>
                </button>
              ))}
            </div>
            <p className="viewer__copied" role="status">
              {copied === 'all'
                ? t('viewer.copiedAll')
                : copied
                  ? t('viewer.copied', { hex: copied })
                  : ''}
            </p>
            {!readOnly && (
              <Button icon="color" onClick={addColors}>
                {t('viewer.addColors')}
              </Button>
            )}
          </section>
        )}

        <section>
          <h3 className="viewer__title">{t('tags.title')}</h3>
          <TagEditor
            tags={element.tags ?? []}
            readOnly={readOnly}
            projectId={projectId}
            onChange={(tags) => updateElement(store.doc, element.id, { tags }, LOCAL)}
          />
        </section>

        {showComments && (
          <section className="viewer__comments-section" aria-label={t('comments.title')}>
            <div className="viewer__title-row">
              <h3 className="viewer__title">
                {t('comments.title')}
                {reviewsReady === 'ready' && elementThreads.length > 0 && (
                  <span className="viewer__count-badge">{elementThreads.length}</span>
                )}
              </h3>
              {mayComment && (
                <button
                  type="button"
                  className="viewer__open-comments-btn"
                  onClick={() => {
                    onClose();
                    openComments({ elementId: element.id });
                  }}
                >
                  {t('comments.open')}
                </button>
              )}
            </div>
            {reviewsReady === 'loading' ? (
              <p role="status" className="ink-muted viewer__none">
                {t('comments.loading')}
              </p>
            ) : reviewsReady === 'error' ? (
              <p role="status" className="ink-muted viewer__none">
                {t('comments.loadError')}
              </p>
            ) : elementThreads.length > 0 ? (
              <div className="viewer__comments-list">
                {elementThreads.slice(0, 3).map((th) => {
                  const name = authorName(th.author) ?? t('comments.deletedAuthor');
                  return (
                    <div key={th.id} className="viewer__comment-card">
                      <Avatar name={name} size={20} />
                      <div className="viewer__comment-content">
                        <strong className="viewer__comment-author">{name}</strong>
                        <p className="viewer__comment-text">{editableText(th)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="ink-muted viewer__none">{t('comments.emptyOpen')}</p>
            )}
          </section>
        )}

        {element.type === 'link' ? (
          <a
            className="ink-btn ink-btn--ghost viewer__download"
            href={element.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(isYoutube ? 'viewer.openOnYoutube' : 'moodboard.openSource')}
          </a>
        ) : (
          ready && (
            <a
              className="ink-btn ink-btn--ghost viewer__download"
              href={ready.url}
              download={ready.filename}
            >
              {t('viewer.download')}
            </a>
          )
        )}
      </aside>
    </div>
  );
}
