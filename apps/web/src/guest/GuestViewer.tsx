import type { GuestElement } from '@inkadra/shared';
import { IconButton } from '@inkadra/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MovingPicture, movingVariantUrl } from '../board/moving.tsx';
import { isUnplayableVideoError, useVideoUnplayable, VideoUnplayable } from '../board/viewer.tsx';
import { useGuestActions } from './actions.ts';
import { PickControls, ReviewChip } from './GuestCardExtras.tsx';
import { guestVariant } from './guest-assets.ts';
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
  const { videoRef, unplayable, setUnplayable } = useVideoUnplayable(asset?.downloadUrl, asset?.id);

  const caption =
    typeof element.caption === 'string'
      ? element.caption
      : typeof element.label === 'string'
        ? element.label
        : '';
  const wide = Math.min(2048, window.innerWidth * (window.devicePixelRatio || 1));
  const src = guestVariant(asset, wide);
  const title = asset?.filename || caption || t(`board.types.${element.type}`);

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
      className="guest-viewer"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="guest-viewer__stage">
        {asset?.kind === 'video' && actions.rights.download && asset.downloadUrl ? (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: people's own footage has no captions */}
            <video
              ref={videoRef}
              className="guest-viewer__media"
              src={asset.downloadUrl}
              poster={src || undefined}
              controls
              onError={onVideoError}
              style={unplayable ? { display: 'none' } : undefined}
            />
            {unplayable && (
              <VideoUnplayable
                poster={src || undefined}
                filename={asset.filename || caption || title}
                downloadUrl={actions.rights.download ? asset.downloadUrl : undefined}
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
          <MovingPicture
            className="guest-viewer__media"
            poster={src}
            moving={movingVariantUrl(asset, wide)}
            alt={caption || title}
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
