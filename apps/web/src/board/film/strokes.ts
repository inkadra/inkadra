import { decodeStroke, type Point } from '@inkadra/canvas-core';
import type { Stroke } from '@inkadra/doc-schema';

/** Width of the drawing in SVG units; the height follows the aspect ratio. */
export const VIEW_W = 1000;

export type PenTool = Stroke['tool'] | 'eraser';

/** Width (thousandths of the picture width) and opacity of each pen. */
export const PENS: Record<Stroke['tool'], { width: number; opacity: number }> = {
  pencil: { width: 3, opacity: 1 },
  brush: { width: 10, opacity: 1 },
  marker: { width: 28, opacity: 0.35 },
};

export const PEN_COLORS = ['#1C1C1E', '#FFFFFF', '#E5484D', '#F5A524', '#30A46C', '#3E7BFA'];

/**
 * A smooth SVG path through points relative to the picture (0 to 1): quadratic curves
 * through the midpoints, so a few stored points still draw a round line.
 */
export function pathOf(points: readonly Point[], height: number): string {
  if (points.length === 0) return '';
  const p = points.map((q) => ({ x: q.x * VIEW_W, y: q.y * height }));
  const first = p[0] as Point;
  const f = (n: number) => Math.round(n * 10) / 10;
  if (p.length < 3) {
    const last = p.at(-1) as Point;
    return `M${f(first.x)} ${f(first.y)}L${f(last.x)} ${f(last.y)}`;
  }
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i] as Point;
    const b = p[i + 1] as Point;
    d += `Q${f(a.x)} ${f(a.y)} ${f((a.x + b.x) / 2)} ${f((a.y + b.y) / 2)}`;
  }
  const last = p.at(-1) as Point;
  return `${d}L${f(last.x)} ${f(last.y)}`;
}

export function strokePath(stroke: Stroke, height: number): string {
  return pathOf(decodeStroke(stroke.points), height);
}
