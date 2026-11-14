import { ImageCrop, Stroke } from '@inkadra/doc-schema';
import type { GuestElement } from '@inkadra/shared';
import { IconButton } from '@inkadra/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CroppedImage } from '../board/CroppedImage.tsx';
import { movingVariantUrl } from '../board/moving.tsx';
import { QualityMenu } from '../board/QualityMenu.tsx';
import {
  NO_SOURCE,
  playbackSource,
  type QualityChoice,
  useKeepPosition,
  useVideoSource,
} from '../board/video-source.ts';
import { isUnplayableVideoError, useVideoUnplayable, VideoUnplayable } from '../board/viewer.tsx';
import { useGuestActions } from './actions.ts';
import { PickControls, ReviewChip } from './GuestCardExtras.tsx';
import { guestVariant, toAsset } from './guest-assets.ts';
import { isPicture } from './model.ts';

const assetOf = (el: GuestElement) => (typeof el.assetId === 'string' ? el.assetId : undefined);

/**
 * A picture or file in large: the biggest guest thumbnail, and the original only through the
 * download button when the link allows it.
 */
export function GuestViewer({ element, onClose }: { element: GuestElement; onClose: () => void }) {
  const { t } = useTranslation();
  const actions = useGuestActions();
  const ref = useRef<HTMLDialogElement>(null);
  const asset = actions.assets.get(assetOf(element) ?? '');
  // The reduced copies when the video has them (decision 0128), else the original with
  // downloads, as before.
  const source = asset ? playbackSource(toAsset(asset)) : NO_SOURCE;
  const streams = asset?.kind === 'video' && Boolean(source.hls);
  const original = actions.rights.download ? (asset?.downloadUrl ?? null) : null;
  const [quality, setQuality] = useState<QualityChoice>('auto');
  const { videoRef, unplayable, setUnplayable } = useVideoUnplayable(
    streams ? source.hls : asset?.downloadUrl,
    asset?.id,
  );
  const played = useVideoSource(
    videoRef,
    streams ? { ...source, original } : NO_SOURCE,
    quality,
    asset?.playback?.renditions,
  );
  useKeepPosition(videoRef, quality);

  const caption =
    typeof element.caption === 'string'
      ? element.caption
      : typeof element.label === 'string'
        ? element.label
        : '';
  const wide = Math.min(2048, window.innerWidth * (window.devicePixelRatio || 1));
  const src = guestVariant(asset, wide);
  const title = asset?.filename || caption || t(`board.types.${element.type}`);
  const parsedCrop = element.type === 'image' ? ImageCrop.safeParse(element.crop) : null;
  const crop = parsedCrop?.success ? parsedCrop.data : undefined;
  const rotation =
    element.type === 'image' && typeof element.rotation === 'number' ? element.rotation : undefined;

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const onVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    if (isUnplayableVideoError(e.currentTarget.error?.code)) {
      setUnplayable(true);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the native dialog
    <dialog
      ref={ref}
      className="guest-viewer ink-motion-dialog"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="guest-viewer__stage">
        {asset?.kind === 'video' && (streams || (actions.rights.download && asset.downloadUrl)) ? (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: people's own footage has no captions */}
            <video
              ref={videoRef}
              className="guest-viewer__media"
              src={streams ? played.src : (asset.downloadUrl ?? undefined)}
              poster={src || undefined}
              controls
              onError={onVideoError}
              style={unplayable ? { display: 'none' } : undefined}
            />
            {streams && !unplayable && (
              <QualityMenu
                asset={toAsset(asset)}
                choice={quality}
                onChoose={setQuality}
                playing={played.height}
              />
            )}
            {unplayable && (
              <VideoUnplayable
                poster={src || undefined}
                filename={asset.filename || caption || title}
                downloadUrl={actions.rights.download ? (asset.downloadUrl ?? undefined) : undefined}
                downloadLabel={t('guest.download')}
                message={t('guest.viewer.unplayable')}
                className="guest-viewer__unplayable"
                mediaClassName="guest-viewer__media"
                scrimClassName="guest-viewer__unplayable-scrim"
                msgClassName="guest-viewer__unplayable-msg"
              />
            )}
          </>
        ) : src && asset ? (
          <CroppedImage
            strokes={
              element.type === 'image' && Array.isArray(element.strokes)
                ? element.strokes.flatMap((value) => {
                    const stroke = Stroke.safeParse(value);
                    return stroke.success ? [stroke.data] : [];
                  })
                : undefined
            }
            className="guest-viewer__media"
            poster={src}
            moving={movingVariantUrl(asset, wide)}
            alt={caption || title}
            width={asset.width}
            height={asset.height}
            crop={crop}
            rotation={rotation}
          />
        ) : (
          <p className="ink-muted">{t('guest.viewer.noPreview')}</p>
        )}
      </div>
      <div className="guest-viewer__bar">
        <span className="guest-viewer__name">{title}</span>
        <ReviewChip review={actions.reviews.get(element.id)} />
        {actions.rights.pick && isPicture(element) && <PickControls elementId={element.id} />}
        <span className="guest__spacer" />
        {actions.rights.download && asset?.downloadUrl && (
          <a
            className="ink-btn ink-btn--secondary"
            href={asset.downloadUrl}
            download={asset.filename ?? ''}
          >
            {t('guest.download')}
          </a>
        )}
        <IconButton
          icon="close"
          label={t('guest.viewer.close')}
          onClick={() => ref.current?.close()}
        />
      </div>
    </dialog>
  );
}
