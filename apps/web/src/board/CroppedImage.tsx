// SPDX-License-Identifier: AGPL-3.0-only
import type { ImageCrop } from '@inkadra/doc-schema';
import type { CSSProperties } from 'react';
import {
  croppedRotatedSize,
  FULL_CROP,
  hasImageTransform,
  normalizeRotation,
  rotatedBounds,
  sanitizeCrop,
} from './image-crop.ts';
import { MovingPicture } from './moving.tsx';

export interface CroppedImageProps {
  poster: string;
  moving?: string | null | undefined;
  alt: string;
  width?: number | null | undefined;
  height?: number | null | undefined;
  crop?: ImageCrop | undefined;
  rotation?: number | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/**
 * Renders an image with non-destructive `crop` and `rotation` applied identically across
 * canvas cards, moodboard gallery, media viewer and guest views.
 * When uncropped and unrotated, renders `MovingPicture` directly.
 */
export function CroppedImage({
  poster,
  moving,
  alt,
  width,
  height,
  crop,
  rotation,
  className,
  style,
}: CroppedImageProps) {
  if (!hasImageTransform({ crop, rotation })) {
    return (
      <MovingPicture className={className} poster={poster} moving={moving ?? null} alt={alt} />
    );
  }

  const baseW = width && width > 0 ? width : 4;
  const baseH = height && height > 0 ? height : 3;
  const rot = normalizeRotation(rotation);
  const c = crop ? sanitizeCrop(crop) : FULL_CROP;
  const rBounds = rotatedBounds(baseW, baseH, rot);
  const outSize = croppedRotatedSize(baseW, baseH, c, rot);

  return (
    <div
      className={className ? `cropped-image ${className}` : 'cropped-image'}
      data-cropped="true"
      data-rotation={rot}
      style={{
        aspectRatio: `${outSize.width} / ${outSize.height}`,
        ['--cropped-ratio' as string]: outSize.width / outSize.height,
        ...style,
      }}
    >
      <div
        className="cropped-image__plane"
        style={{
          width: `${100 / c.w}%`,
          height: `${100 / c.h}%`,
          left: `${(-c.x / c.w) * 100}%`,
          top: `${(-c.y / c.h) * 100}%`,
        }}
      >
        <div
          className="cropped-image__rot"
          style={{
            width: `${(baseW / rBounds.width) * 100}%`,
            height: `${(baseH / rBounds.height) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${rot}deg)`,
          }}
        >
          <MovingPicture poster={poster} moving={moving ?? null} alt={alt} />
        </div>
      </div>
    </div>
  );
}
