import type { AspectRatio, FrameShape, Stroke } from '@inkadra/doc-schema';
import { Icon } from '@inkadra/ui';
import { memo, type ReactNode } from 'react';
import { pickVariant, useAsset } from '../assets.ts';
import { localPreview } from '../uploads.ts';
import { frameRatio } from './aspect.ts';
import { ShapeView } from './shapes.tsx';
import { PENS, strokePath, VIEW_W } from './strokes.ts';

/**
 * The picture of a frame: its reference image, if any, under the pen drawing and its shapes,
 * in the frame's aspect ratio. `under` is drawn between the image and the drawing (the onion
 * skin), `children` on top (the live line while drawing). Memoized: the animatic re-renders on
 * every playback tick, the picture only when the frame changes.
 */
export const FramePicture = memo(function FramePicture({
  assetId,
  aspect,
  boardAspect,
  strokes,
  shapes,
  referenceOpacity,
  hideReference = false,
  hideDrawing = false,
  pixels,
  under,
  children,
}: {
  assetId: string | undefined;
  aspect: AspectRatio | undefined;
  boardAspect: AspectRatio;
  strokes: readonly Stroke[] | undefined;
  shapes?: readonly FrameShape[] | undefined;
  referenceOpacity?: number | undefined;
  hideReference?: boolean;
  hideDrawing?: boolean;
  /** Rendered width in device pixels, to pick the image size. */
  pixels: number;
  under?: ReactNode;
  children?: ReactNode;
}) {
  const ratio = frameRatio(aspect, boardAspect);
  const height = VIEW_W / ratio;
  const asset = useAsset(assetId);
  const ready = asset && asset !== 'missing' ? asset : null;
  const src = (assetId && localPreview(assetId)) || (ready ? pickVariant(ready, pixels) : '');
  const empty = !src && (strokes?.length ?? 0) === 0 && (shapes?.length ?? 0) === 0 && !under;
  return (
    <div className="frame-pic" style={{ aspectRatio: String(ratio) }}>
      {src && !hideReference && (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          style={referenceOpacity !== undefined ? { opacity: referenceOpacity } : undefined}
        />
      )}
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
        {under}
        {!hideDrawing && (
          <>
            {strokes?.map((s) => (
              <StrokePath key={s.id} stroke={s} height={height} />
            ))}
            {shapes?.map((s) => (
              <ShapeView key={s.id} shape={s} height={height} />
            ))}
          </>
        )}
        {children}
      </svg>
    </div>
  );
});

export function StrokePath({
  stroke,
  height,
  color,
}: {
  stroke: Stroke;
  height: number;
  /** Draws in this colour instead (the onion skin). */
  color?: string;
}) {
  return (
    <path
      d={strokePath(stroke, height)}
      fill="none"
      stroke={color ?? stroke.color}
      strokeWidth={stroke.width}
      strokeOpacity={stroke.opacity ?? PENS[stroke.tool].opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="none"
    />
  );
}
