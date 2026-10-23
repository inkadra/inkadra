import type { AspectRatio, Stroke } from '@inkadra/doc-schema';
import { Icon } from '@inkadra/ui';
import type { ReactNode } from 'react';
import { pickVariant, useAsset } from '../assets.ts';
import { localPreview } from '../uploads.ts';
import { frameRatio } from './aspect.ts';
import { PENS, strokePath, VIEW_W } from './strokes.ts';

/**
 * The picture of a frame: its reference image, if any, under the pen drawing, in the frame's
 * aspect ratio. `children` are drawn on top (the live line while drawing).
 */
export function FramePicture({
  assetId,
  aspect,
  boardAspect,
  strokes,
  pixels,
  children,
}: {
  assetId: string | undefined;
  aspect: AspectRatio | undefined;
  boardAspect: AspectRatio;
  strokes: readonly Stroke[] | undefined;
  /** Rendered width in device pixels, to pick the image size. */
  pixels: number;
  children?: ReactNode;
}) {
  const ratio = frameRatio(aspect, boardAspect);
  const height = VIEW_W / ratio;
  const asset = useAsset(assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  const src = (assetId && localPreview(assetId)) || (ready ? pickVariant(ready, pixels) : '');
  const empty = !src && (strokes?.length ?? 0) === 0;
  return (
    <div className="frame-pic" style={{ aspectRatio: String(ratio) }}>
      {src && <img src={src} alt="" draggable={false} decoding="async" />}
      {empty && (
        <span className="frame-pic__empty" aria-hidden="true">
          <Icon name="frame" size={20} />
        </span>
      )}
      <svg
        className="frame-pic__ink"
        viewBox={`0 0 ${VIEW_W} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {strokes?.map((s) => (
          <StrokePath key={s.id} stroke={s} height={height} />
        ))}
        {children}
      </svg>
    </div>
  );
}

export function StrokePath({ stroke, height }: { stroke: Stroke; height: number }) {
  return (
    <path
      d={strokePath(stroke, height)}
      fill="none"
      stroke={stroke.color}
      strokeWidth={stroke.width}
      strokeOpacity={stroke.opacity ?? PENS[stroke.tool].opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="none"
    />
  );
}
