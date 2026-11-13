// SPDX-License-Identifier: AGPL-3.0-only
import { formatDuration } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { Asset, AssetRendition, VideoNoLive } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AudioPlayer, useWaveform } from './AudioPlayer.tsx';
import { pickVariant, playbackUrl, useAsset } from './assets.ts';
import { CardCaption } from './CardCaption.tsx';
import { useBoard } from './context.ts';
import { FontSpecimen, ModelTile } from './FontSpecimen.tsx';
import {
  type FileFamily,
  fileBadge,
  fileFamily,
  isPdf,
  isRaw,
  metaParts,
  splitName,
} from './file-kinds.ts';
import { playInline, stopInline, useInlinePlaying, useInlineStops } from './inline-player.ts';
import { MAP_ASPECT, MapCredit, TrackLine } from './MapCard.tsx';
import { MapSurface, useExploring } from './MapExplore.tsx';
import { formatClimb, formatDistance } from './maps.ts';
import { rungLabel } from './QualityMenu.tsx';
import { localPreview, useUploadProgress } from './uploads.ts';
import { type PlaybackSource, playbackSource, useVideoSource } from './video-source.ts';

type FileElement = Extract<Element, { type: 'file' }>;

/** File name with an ellipsis in the stem, so the extension stays visible. */
export function FileName({ name }: { name: string }) {
  const { stem, ext } = splitName(name);
  return (
    <span className="fcard__name" title={name}>
      <span className="fcard__stem">{stem}</span>
      {ext && <span className="fcard__ext">{ext}</span>}
    </span>
  );
}

/** The type badge, coloured by family. */
export function FileBadge({ family, label }: { family: FileFamily; label: string }) {
  if (!label) return null;
  return <span className={`fbadge fbadge--${family}`}>{label}</span>;
}

/**
 * Footer shared by every card of the family: the name, then badge · size · what tells this
 * file apart. Also under camera RAW image cards.
 */
export function FileFooter({
  name,
  family,
  badge,
  meta,
}: {
  name: ReactNode;
  family: FileFamily;
  badge: string;
  meta: readonly string[];
}) {
  return (
    <div className="fcard__footer">
      {typeof name === 'string' ? <FileName name={name} /> : name}
      <span className="fcard__meta">
        <FileBadge family={family} label={badge} />
        {meta.length > 0 && <span className="fcard__meta-text">{meta.join(' · ')}</span>}
      </span>
    </div>
  );
}

/**
 * Badge and meta of a ready asset, with the page count of a PDF in the person's language; a
 * GPX route says its length and climb instead, as in the mockup.
 */
export function useFileMeta(asset: Asset): { family: FileFamily; badge: string; meta: string[] } {
  const { t, i18n } = useTranslation();
  const track = asset.track;
  const meta = track
    ? [
        formatDistance(track.distanceM, i18n.language),
        ...(track.elevationGainM ? [formatClimb(track.elevationGainM)] : []),
      ]
    : metaParts(asset, i18n.language);
  const layers = asset.exif?.LayerCount;
  if (
    fileFamily(asset) === 'design' &&
    typeof layers === 'number' &&
    Number.isInteger(layers) &&
    layers >= 0 &&
    layers <= 32768
  )
    meta.push(t('board.file.layers', { count: layers }));
  const details = asset.exif?.filePreview;
  if (details && typeof details === 'object') {
    const info = details as Record<string, unknown>;
    if (fileFamily(asset) === 'font') {
      meta.length = 0;
      for (const value of [info.family, info.style ?? info.weight])
        if (typeof value === 'string' || typeof value === 'number') meta.push(String(value));
      if (typeof info.glyphs === 'number')
        meta.push(t('board.file.glyphs', { count: info.glyphs }));
    }
    if (typeof info.polygons === 'number')
      meta.push(t('board.file.polygons', { count: info.polygons }));
  }
  if (typeof asset.exif?.OfficeSheetCount === 'number')
    meta.push(t('office.sheetCount', { count: asset.exif.OfficeSheetCount }));
  else if (asset.pageCount)
    meta.push(
      t(/\.(pptx|odp)$/i.test(asset.filename) ? 'office.slideCount' : 'board.file.pages', {
        count: asset.pageCount,
      }),
    );
  return { family: fileFamily(asset), badge: fileBadge(asset), meta };
}

/** The coloured tile of a file with no preview: its extension on a folded page. */
function IconTile({ family, label }: { family: FileFamily; label: string }) {
  return (
    <span className={`fcard__tile fbadge--${family}`} aria-hidden="true">
      {label || <Icon name="file" size={18} />}
    </span>
  );
}

function Preview({
  family,
  style,
  className,
  children,
}: {
  family: FileFamily;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={['fcard__preview', `fcard__preview--${family}`, className]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {children}
    </div>
  );
}

/** Aspect ratio of a picture, kept between a panorama and a tall phone shot. */
function ratioOf(width: number | null, height: number | null, fallback: string): string {
  if (!width || !height) return fallback;
  const r = Math.min(2.4, Math.max(0.6, width / height));
  return `${r}`;
}

/**
 * The card of a file element: a preview on top, the shared footer below, and the same
 * actions as every card. Opening it (double click, Enter, the menu) shows the shared viewer;
 * the play button of a video plays it right on the card.
 */
export function FileCard({ element, width }: { element: FileElement; width: number }) {
  const { t } = useTranslation();
  const asset = useAsset(element.assetId);
  const progress = useUploadProgress(element.assetId);
  const ready = asset && asset !== 'missing' ? asset : null;

  if (!ready) {
    const missing = asset === 'missing';
    return (
      <div className={`fcard${missing ? ' fcard--failed' : ' fcard--processing'}`}>
        <Preview family="generic" className="fcard__preview--tile">
          <IconTile family="generic" label="" />
          {progress !== null ? <UploadBar progress={progress} /> : null}
        </Preview>
        <FileFooter
          name={
            <span className="fcard__name">
              {missing ? t('board.file.missing') : t('board.file.loading')}
            </span>
          }
          family="generic"
          badge=""
          meta={
            progress !== null
              ? [t('board.file.uploading', { percent: Math.round(progress * 100) })]
              : []
          }
        />
        <CardCaption element={element} />
      </div>
    );
  }
  return <ReadyFileCard element={element} asset={ready} width={width} progress={progress} />;
}

function UploadBar({ progress }: { progress: number }) {
  const { t } = useTranslation();
  const percent = Math.round(progress * 100);
  return (
    <span
      className="card__progress"
      role="progressbar"
      aria-label={t('board.file.uploading', { percent })}
      aria-valuenow={percent}
    >
      <span style={{ width: `${progress * 100}%` }} />
    </span>
  );
}

function ReadyFileCard({
  element,
  asset,
  width,
  progress,
}: {
  element: FileElement;
  asset: Asset;
  width: number;
  progress: number | null;
}) {
  const { t } = useTranslation();
  const { scale } = useBoard();
  const { family, badge, meta } = useFileMeta(asset);
  const exploring = useExploring(element.id);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const pixels = width * scale * dpr;
  const uploading = progress !== null;
  const state =
    asset.status === 'failed'
      ? 'failed'
      : uploading || asset.status === 'pending' || asset.status === 'processing'
        ? 'processing'
        : 'ready';
  const footerMeta = uploading
    ? [t('board.file.uploading', { percent: Math.round(progress * 100) })]
    : meta;

  let preview: ReactNode;
  if (family === 'font') {
    preview = (
      <Preview family={family} className="fcard__preview--font">
        <FontSpecimen asset={asset} />
      </Preview>
    );
  } else if (family === '3d') {
    preview = (
      <Preview family={family} className="fcard__preview--model">
        <ModelTile />
      </Preview>
    );
  } else if (asset.kind === 'video' && element.showPreview === false) {
    preview = null;
  } else if (asset.kind === 'video') {
    preview = (
      <VideoPreview
        element={element}
        asset={asset}
        pixels={pixels}
        state={state}
        uploading={uploading}
      />
    );
  } else if (family === 'audio') {
    preview = (
      <AudioPreview
        id={element.id}
        asset={asset}
        state={state}
        width={width}
        uploading={uploading}
      />
    );
  } else {
    const src =
      (asset.variants.length > 0 ? pickVariant(asset, pixels) : '') ||
      localPreview(element.assetId) ||
      '';
    if (asset.track) {
      preview = (
        <Preview
          family={family}
          className="fcard__preview--map"
          style={{ aspectRatio: MAP_ASPECT }}
        >
          {src && (
            <img className="fcard__img" src={src} alt="" draggable={false} decoding="async" />
          )}
          <TrackLine track={asset.track} />
          {src && asset.track.view && (
            <MapSurface
              id={element.id}
              name={asset.filename}
              track={asset.track}
              exploring={exploring}
            />
          )}
          {src && <MapCredit />}
        </Preview>
      );
    } else if (
      src &&
      (isPdf(asset) || /\.(docx|xlsx|pptx|odt|ods|odp|csv)$/i.test(asset.filename))
    ) {
      preview = (
        <Preview family={family} className="fcard__preview--page">
          <img
            className="fcard__page"
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            style={{ aspectRatio: ratioOf(asset.width, asset.height, '1 / 1.41') }}
          />
        </Preview>
      );
    } else if (src) {
      preview = (
        <Preview
          family={family}
          className="fcard__preview--picture"
          style={{ aspectRatio: ratioOf(asset.width, asset.height, '4 / 3') }}
        >
          <img className="fcard__img" src={src} alt="" draggable={false} decoding="async" />
        </Preview>
      );
    } else {
      preview = (
        <Preview family={family} className="fcard__preview--tile">
          <IconTile family={family} label={badge} />
          {state === 'processing' && !uploading && (
            <span className="fcard__state">{t('board.image.processing')}</span>
          )}
        </Preview>
      );
    }
  }

  return (
    <div className={`fcard fcard--${state}`} data-family={family}>
      <div className="fcard__media">
        {preview}
        {uploading && <UploadBar progress={progress} />}
        {state === 'failed' && (
          <span className="fcard__failed">
            <Icon name="warning" size={12} />
            {t('board.image.failed')}
          </span>
        )}
      </div>
      <FileFooter
        name={asset.filename || t('board.types.file')}
        family={family}
        badge={badge}
        meta={footerMeta}
      />
      <CardCaption element={element} />
    </div>
  );
}

/**
 * The video in its card, on the board's one-player rule. Mounted only once play is pressed, so a
 * large board holds no video elements. A file the browser turns out not to read goes to the
 * viewer, which explains and offers the download.
 */
/**
 * The rungs of a ladder on a card (decision 0128): "Preparazione… 480p · 35%" before any is
 * ready, "Si può già guardare · 1080p · 64%" once the card plays, a bar per rung.
 */
function RungsProgress({
  rungs,
  making,
  watchable,
  noLive,
}: {
  rungs: AssetRendition[];
  making: AssetRendition | undefined;
  watchable: boolean;
  noLive?: VideoNoLive;
}) {
  const { t } = useTranslation();
  return (
    <span className="fcard__prep fcard__prep--rungs" role="status">
      <span className="fcard__prep-line">
        <span>{watchable ? t('board.file.watchable') : t('board.file.preparing')}</span>
        {making && (
          <span className="num">
            {rungLabel(making.name)} · {making.progress ?? 0}%
          </span>
        )}
      </span>
      {watchable && making?.live && (
        <span className="fcard__prep-line">
          <span>
            <span className="live-tag">{t('board.file.live.liveNow')}</span>{' '}
            {t('board.file.live.liveNowText', { rung: rungLabel(making.name) })}
          </span>
        </span>
      )}
      {!watchable && noLive && (
        <span className="fcard__prep-line fcard__prep-line--quiet">
          <span>
            {t('board.file.live.noLive', { reason: t(`board.file.live.reasons.${noLive}`) })}
          </span>
        </span>
      )}
      <span className="fcard__rungs" aria-hidden="true">
        {rungs.map((r) => (
          <span
            key={r.name}
            className={
              r.status === 'ready'
                ? 'fcard__rung is-done'
                : r.live
                  ? 'fcard__rung is-live'
                  : 'fcard__rung'
            }
          >
            <span>{rungLabel(r.name)}</span>
            <span className="fcard__bar">
              <i style={{ width: `${r.status === 'ready' ? 100 : (r.progress ?? 0)}%` }} />
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

function CardVideo({
  element,
  source,
  poster,
  name,
  hadFocus,
}: {
  element: FileElement;
  source: PlaybackSource;
  poster: string;
  name: string;
  hadFocus: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const { openElement } = useBoard();
  const video = useRef<HTMLVideoElement>(null);
  // Auto on the card: the playlist where there is one, the plain file otherwise.
  const { src, hls } = useVideoSource(video, source);
  // hls.js attaches after the first play was asked: ask again once it feeds the video.
  useEffect(() => {
    if (hls) void video.current?.play()?.catch(() => {});
  }, [hls]);
  const id = element.id;
  useInlineStops(id, video);
  // Playing here, not with autoPlay: StrictMode's second mount has to start it again. A layout
  // effect, because its cleanup still finds the video in the page and can read the focus.
  useLayoutEffect(() => {
    const el = video.current;
    if (!el) return;
    hadFocus.current = false;
    el.focus({ preventScroll: true });
    void el.play()?.catch(() => {});
    return () => {
      hadFocus.current = document.activeElement === el;
      el.pause();
    };
  }, [hadFocus]);
  return (
    // biome-ignore lint/a11y/useMediaCaption: people's own footage has no captions
    <video
      ref={video}
      className="fcard__video"
      data-tour="video"
      data-play-link={id}
      aria-label={t('board.menu.videoPlayer', { title: name })}
      src={src}
      poster={poster || undefined}
      controls
      playsInline
      onEnded={() => stopInline(id)}
      onError={() => {
        stopInline(id);
        openElement?.(element);
      }}
    />
  );
}

function VideoPreview({
  element,
  asset,
  pixels,
  state,
  uploading,
}: {
  element: FileElement;
  asset: Asset;
  pixels: number;
  state: 'ready' | 'processing' | 'failed';
  /** The upload bar and the footer already say so: no "Processing" over the bar. */
  uploading: boolean;
}) {
  const { t } = useTranslation();
  const { openElement } = useBoard();
  const poster = asset.variants.length > 0 ? pickVariant(asset, pixels) : '';
  const playable = playbackSource(asset);
  const source = playable.hls ?? playable.src;
  const proxy = asset.proxy;
  // A ladder plays as soon as its smallest rung is ready (decision 0128).
  const preparing = !playable.hls && (proxy?.status === 'queued' || proxy?.status === 'processing');
  const percent = proxy?.status === 'processing' ? (proxy.progress ?? null) : null;
  const rungs = [...(asset.playback?.renditions ?? [])].sort(
    (a, b) => Number(a.name) - Number(b.name),
  );
  const making =
    rungs.find((r) => r.status === 'processing') ?? rungs.find((r) => r.status === 'queued');
  // A guest whose link allows no downloads gets a picture as the url (guest-assets.ts): nothing
  // to play on the card, and the viewer shows them that picture as before.
  const plays = !!source && !asset.variants.some((variant) => variant.url === source);
  const playing = useInlinePlaying(element.id) && state === 'ready' && !preparing && plays;
  const playButton = useRef<HTMLButtonElement>(null);
  // Stopping a video that had the keyboard hands the focus back to the play button.
  const hadFocus = useRef(false);
  useEffect(() => {
    if (playing || !hadFocus.current) return;
    hadFocus.current = false;
    playButton.current?.focus({ preventScroll: true });
  }, [playing]);
  return (
    <Preview
      family="video"
      className="fcard__preview--video"
      style={{ aspectRatio: ratioOf(asset.width, asset.height, '16 / 9') }}
    >
      {playing && source ? (
        <CardVideo
          element={element}
          source={playable}
          poster={poster}
          name={asset.filename}
          hadFocus={hadFocus}
        />
      ) : (
        <>
          {poster && (
            <img className="fcard__img" src={poster} alt="" draggable={false} decoding="async" />
          )}
          {preparing && rungs.length > 0 ? (
            <RungsProgress
              rungs={rungs}
              making={making}
              watchable={false}
              noLive={asset.playback?.noLive}
            />
          ) : preparing ? (
            <span className="fcard__prep" role="status">
              <span>{t('board.file.preparing')}</span>
              <span className="fcard__bar" aria-hidden="true">
                <i
                  className={percent === null ? 'is-indeterminate' : undefined}
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </span>
              {percent !== null && <span className="fcard__percent">{percent}%</span>}
            </span>
          ) : (
            state === 'ready' &&
            source && (
              <button
                ref={playButton}
                type="button"
                className="card__play fcard__play"
                data-play-link={element.id}
                data-tour={plays ? 'video' : undefined}
                aria-label={t('board.file.play', { name: asset.filename })}
                onClick={(event) => {
                  event.stopPropagation();
                  if (plays) playInline(element.id);
                  else openElement?.(element);
                }}
              >
                <Icon name="play" size={14} />
              </button>
            )
          )}
          {!preparing && making && playable.hls && (
            <RungsProgress rungs={rungs} making={making} watchable />
          )}
          {!preparing && state === 'ready' && !source && (
            <span className="fcard__prep" role="status">
              {t('board.file.unavailable')}
            </span>
          )}
          {!preparing && source && asset.durationMs !== null && asset.durationMs > 0 && (
            // Above the rungs while they are made, as in the mockup of decision 0128.
            <span
              className={
                making && playable.hls ? 'card__duration card__duration--top' : 'card__duration'
              }
            >
              {formatDuration(asset.durationMs)}
            </span>
          )}
          {state === 'processing' && !uploading && !poster && (
            <span className="fcard__state">{t('board.image.processing')}</span>
          )}
        </>
      )}
    </Preview>
  );
}

/**
 * The waveform the worker read (#327), played and scrubbed on the card; a flat bar until it
 * arrives. Plays the original where the browser reads it, else the AAC copy. Until the asset
 * is ready (uploading, queued, being read) there is no player: an `<audio>` given the address
 * of a file that is not there yet gets a 404, stays in error, and the first play fails with
 * "Format error" (QA 2026-11-02 round 2, R2-03).
 */
export function AudioPreview({
  id,
  asset,
  state,
  width,
  uploading = false,
}: {
  id: string;
  asset: Asset;
  state: 'ready' | 'processing' | 'failed';
  width: number;
  uploading?: boolean;
}) {
  const { t } = useTranslation();
  const peaks = useWaveform(state === 'ready' ? asset.waveformUrl : null);
  // One bar every 7 board pixels inside the 12 px margins of the preview.
  const bars = Math.max(12, Math.min(120, Math.floor((width - 24) / 7)));
  return (
    <Preview family="audio" className="fcard__preview--audio">
      {state === 'ready' ? (
        <AudioPlayer
          id={id}
          src={playbackUrl(asset) ?? asset.url}
          name={asset.filename}
          durationMs={asset.durationMs}
          peaks={peaks}
          bars={bars}
        />
      ) : (
        <>
          <span className="fcard__audio-icon" aria-hidden="true">
            <Icon name="volume" size={22} />
          </span>
          {state === 'processing' && !uploading && (
            <span className="fcard__state">{t('board.image.processing')}</span>
          )}
        </>
      )}
    </Preview>
  );
}

/** Footer under an image card whose picture is a camera RAW: RAW badge, camera, exposure. */
export function RawImageFooter({ asset }: { asset: Asset }) {
  const { family, badge, meta } = useFileMeta(asset);
  if (!isRaw(asset)) return null;
  return <FileFooter name={asset.filename} family={family} badge={badge} meta={meta} />;
}
