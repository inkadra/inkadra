import { type FrameShape, STROKE_GRID } from '@inkadra/doc-schema';
import { VIEW_W } from './strokes.ts';

export type ShapeKind = FrameShape['kind'];
/** Kinds drawn by dragging; texts are typed. */
export const DRAG_SHAPES = ['rect', 'ellipse', 'line', 'arrow'] as const satisfies ShapeKind[];

/** Length of an arrow head, as a multiple of the line width (at least 12 units). */
const HEAD = 4;

/**
 * A shape or a text of a frame drawing, in the SVG units of the picture (VIEW_W wide,
 * `height` high). `color` draws it in another colour (the onion skin).
 */
export function ShapeView({
  shape,
  height,
  color,
}: {
  shape: Pick<FrameShape, 'kind' | 'color' | 'width' | 'x0' | 'y0' | 'x1' | 'y1' | 'text'>;
  height: number;
  color?: string;
}) {
  const ink = color ?? shape.color;
  const x0 = (shape.x0 / STROKE_GRID) * VIEW_W;
  const y0 = (shape.y0 / STROKE_GRID) * height;
  const x1 = (shape.x1 / STROKE_GRID) * VIEW_W;
  const y1 = (shape.y1 / STROKE_GRID) * height;
  const line = {
    fill: 'none',
    stroke: ink,
    strokeWidth: shape.width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (shape.kind) {
    case 'rect':
      return (
        <rect
          x={Math.min(x0, x1)}
          y={Math.min(y0, y1)}
          width={Math.abs(x1 - x0)}
          height={Math.abs(y1 - y0)}
          {...line}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={(x0 + x1) / 2}
          cy={(y0 + y1) / 2}
          rx={Math.abs(x1 - x0) / 2}
          ry={Math.abs(y1 - y0) / 2}
          {...line}
        />
      );
    case 'line':
      return <line x1={x0} y1={y0} x2={x1} y2={y1} {...line} />;
    case 'arrow': {
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(12, shape.width * HEAD);
      const wing = (side: number) =>
        `${x1 - head * Math.cos(angle + side * 0.45)} ${y1 - head * Math.sin(angle + side * 0.45)}`;
      return <path d={`M${x0} ${y0}L${x1} ${y1}M${wing(-1)}L${x1} ${y1}L${wing(1)}`} {...line} />;
    }
    case 'text':
      return (
        <text x={x0} y={y0} fill={ink} fontSize={shape.width} fontFamily="inherit">
          {shape.text}
        </text>
      );
  }
}
