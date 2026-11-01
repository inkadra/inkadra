// SPDX-License-Identifier: AGPL-3.0-only
import { formatDuration } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import { Icon } from '@inkadra/ui';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioPlayer, useWaveform } from './AudioPlayer.tsx';
import { pickVariant, playbackUrl, useAsset } from './assets.ts';
import { CardCaption } from './CardCaption.tsx';
import { useBoard } from './context.ts';
import {
  type FileFamily,
  fileBadge,
  fileFamily,
  isPdf,
  isRaw,
  metaParts,
  splitName,
} from './file-kinds.ts';
import { localPreview, useUploadProgress } from './uploads.ts';

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

/** Badge and meta of a ready asset, with the page count of a PDF in the person's language. */
export function useFileMeta(asset: Asset): { family: FileFamily; badge: string; meta: string[] } {
  const { t, i18n } = useTranslation();
  const meta = metaParts(asset, i18n.language);
  if (asset.pageCount) meta.push(t('board.file.pages', { count: asset.pageCount }));
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
 * actions as every card. Opening it (double click, Enter, the menu) shows the shared viewer.
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
  return (
    <span className="card__progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
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
  if (asset.kind === 'video') {
    preview = <VideoPreview element={element} asset={asset} pixels={pixels} state={state} />;
  } else if (family === 'audio') {
    preview = <AudioPreview id={element.id} asset={asset} state={state} width={width} />;
  } else {
    const src =
      localPreview(element.assetId) ??
      (asset.variants.length > 0 ? pickVariant(asset, pixels) : '');
    if (src && isPdf(asset)) {
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

function VideoPreview({
  element,
  asset,
  pixels,
  state,
}: {
  element: FileElement;
  asset: Asset;
  pixels: number;
  state: 'ready' | 'processing' | 'failed';
}) {
  const { t } = useTranslation();
  const poster = asset.variants.length > 0 ? pickVariant(asset, pixels) : '';
  const proxy = asset.proxy;
  const preparing = proxy?.status === 'queued' || proxy?.status === 'processing';
  const percent = proxy?.status === 'processing' ? (proxy.progress ?? null) : null;
  return (
    <Preview
      family="video"
      className="fcard__preview--video"
      style={{ aspectRatio: ratioOf(asset.width, asset.height, '16 / 9') }}
    >
      {poster && (
        <img className="fcard__img" src={poster} alt="" draggable={false} decoding="async" />
      )}
      {preparing ? (
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
        state === 'ready' && (
          // Decorative, like every card: a double click or Enter opens the shared viewer,
          // which plays the playable copy once it is ready.
          <span className="card__play fcard__play" data-playable={element.id} aria-hidden="true">
            <Icon name="play" size={14} />
          </span>
        )
      )}
      {!preparing && asset.durationMs !== null && asset.durationMs > 0 && (
        <span className="card__duration">{formatDuration(asset.durationMs)}</span>
      )}
      {state === 'processing' && !poster && (
        <span className="fcard__state">{t('board.image.processing')}</span>
      )}
    </Preview>
  );
}

/**
 * The waveform the worker read (#327), played and scrubbed on the card; a flat bar until it
 * arrives. Plays the original where the browser reads it, else the AAC copy.
 */
function AudioPreview({
  id,
  asset,
  state,
  width,
}: {
  id: string;
  asset: Asset;
  state: 'ready' | 'processing' | 'failed';
  width: number;
}) {
  const peaks = useWaveform(asset.waveformUrl);
  // One bar every 7 board pixels inside the 12 px margins of the preview.
  const bars = Math.max(12, Math.min(120, Math.floor((width - 24) / 7)));
  return (
    <Preview family="audio" className="fcard__preview--audio">
      {state === 'failed' ? (
        <span className="fcard__audio-icon" aria-hidden="true">
          <Icon name="volume" size={22} />
        </span>
      ) : (
        <AudioPlayer
          id={id}
          src={playbackUrl(asset)}
          name={asset.filename}
          durationMs={asset.durationMs}
          peaks={peaks}
          bars={bars}
        />
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
