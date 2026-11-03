// SPDX-License-Identifier: AGPL-3.0-only
import type { ImageCrop, Stroke } from '@inkadra/doc-schema';
import { type CSSProperties, type PointerEvent, useState } from 'react';
import { StrokePath } from './film/FramePicture.tsx';
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
  strokes?: readonly Stroke[] | undefined;
  onStroke?: ((points: number[]) => void) | undefined;
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
  strokes, onStroke,
}: CroppedImageProps) {
  const [draft, setDraft] = useState<number[] | null>(null);
  if (!hasImageTransform({ crop, rotation }) && !strokes?.length && !onStroke) {
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
          <svg className="image-drawing" viewBox={`0 0 1000 ${1000*baseH/baseW}`} preserveAspectRatio="none" aria-hidden="true" style={{pointerEvents:onStroke ? 'auto' : 'none',touchAction:onStroke ? 'none' : undefined}}
            onPointerDown={onStroke ? e => { e.stopPropagation(); e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDraft(imagePoint(e,baseW,baseH)); } : undefined}
            onPointerMove={onStroke ? e => { if (!draft || draft.length >= 2048) return; setDraft([...draft,...imagePoint(e,baseW,baseH)]); } : undefined}
            onPointerUp={onStroke ? e => { e.stopPropagation(); if (draft) onStroke([...draft,...(draft.length < 2048 ? imagePoint(e,baseW,baseH) : [])]); setDraft(null); } : undefined}
            onPointerCancel={() => setDraft(null)}>
            {strokes?.map(stroke => <StrokePath key={stroke.id} stroke={stroke} height={1000*baseH/baseW} />)}
            {draft && <StrokePath stroke={{id:'draft',tool:'pencil',color:'#E5484D',width:3,points:draft}} height={1000*baseH/baseW} />}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** SVG's inverse screen matrix includes the image's crop, rotation and canvas zoom. */
function imagePoint(e: PointerEvent<SVGSVGElement>, w: number, h: number): number[] {
  const matrix = e.currentTarget.getScreenCTM();
  if (!matrix) return [0,0];
  const point = new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());
  return [Math.round(Math.max(0,Math.min(4096,point.x/1000*4096))),Math.round(Math.max(0,Math.min(4096,point.y/(1000*h/w)*4096)))];
}
