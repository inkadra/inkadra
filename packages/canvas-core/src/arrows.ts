// SPDX-License-Identifier: MPL-2.0
import { type ArrowEnd, type Element, roots } from '@inkadra/doc-schema';
import type * as Y from 'yjs';
import { createElement } from './board.ts';
import type { Point, Rect } from './geometry.ts';

export type ArrowElement = Extract<Element, { type: 'arrow' }>;

/** Space between an arrow tip and the card it points at, in world units. */
export const ARROW_GAP = 6;

const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Where the line from the middle of `rect` toward `toward` leaves the rectangle, pushed out by
 * `gap`. Returns the middle when `toward` is inside.
 */
export function exitPoint(rect: Rect, toward: Point, gap = ARROW_GAP): Point {
  const c = centerOf(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) <= rect.w / 2 && Math.abs(dy) <= rect.h / 2) return c;
  const hw = rect.w / 2 + gap;
  const hh = rect.h / 2 + gap;
  const t = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy),
  );
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * The two drawn ends of an arrow. An end attached to a card that `rectOf` knows starts at the
 * card's edge, facing the other end; otherwise it is the stored point.
 */
export function arrowEnds(
  arrow: Pick<ArrowElement, 'from' | 'to' | 'path'>,
  rectOf: (id: string) => Rect | null,
): { a: Point; b: Point } {
  const { a, b } = arrowGeometry(arrow, rectOf);
  return { a, b };
}

/** How far the middle of a curved arrow bows out, as a share of its length, and at most. */
export const CURVE_BOW = 0.18;
export const MAX_CURVE_BOW = 160;

/**
 * Control point of a curved arrow from `a` to `b`: the quadratic curve through it bows to the
 * left of the direction a → b (up, for an arrow pointing right). Null for a straight arrow.
 */
export function curveControl(a: Point, b: Point, path: ArrowElement['path']): Point | null {
  if (path !== 'curved') return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  // The curve passes halfway between the chord and the control point.
  const bow = 2 * Math.min(len * CURVE_BOW, MAX_CURVE_BOW);
  return { x: (a.x + b.x) / 2 + (dy / len) * bow, y: (a.y + b.y) / 2 - (dx / len) * bow };
}

export interface ArrowGeometry {
  a: Point;
  b: Point;
  /** Control point of the quadratic curve; null when the arrow is straight. */
  c: Point | null;
  /** Middle of the drawn path, where the label sits. */
  mid: Point;
}

/**
 * Where an arrow is drawn. A curved arrow leaves its cards facing its control point, so the
 * heads follow the curve.
 */
export function arrowGeometry(
  arrow: Pick<ArrowElement, 'from' | 'to' | 'path'>,
  rectOf: (id: string) => Rect | null,
): ArrowGeometry {
  const ra = arrow.from.elementId ? rectOf(arrow.from.elementId) : null;
  const rb = arrow.to.elementId ? rectOf(arrow.to.elementId) : null;
  const pa = ra ? centerOf(ra) : { x: arrow.from.x, y: arrow.from.y };
  const pb = rb ? centerOf(rb) : { x: arrow.to.x, y: arrow.to.y };
  const c = curveControl(pa, pb, arrow.path);
  const a = ra ? exitPoint(ra, c ?? pb) : pa;
  const b = rb ? exitPoint(rb, c ?? pa) : pb;
  const mid = c
    ? { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 }
    : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { a, b, c, mid };
}

/** SVG path data of an arrow. */
export function arrowPathData({ a, b, c }: Pick<ArrowGeometry, 'a' | 'b' | 'c'>): string {
  return c ? `M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}` : `M${a.x} ${a.y}L${b.x} ${b.y}`;
}

/** Points along the path, for renderers that only draw polylines. */
export function arrowPolyline({ a, b, c }: Pick<ArrowGeometry, 'a' | 'b' | 'c'>, steps = 24) {
  if (!c) return [a, b];
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    });
  }
  return out;
}

/** Bounding box of an arrow's path (the curve stays inside its control triangle). */
export function arrowBox(g: Pick<ArrowGeometry, 'a' | 'b' | 'mid'>): Rect {
  const xs = [g.a.x, g.b.x, g.mid.x];
  const ys = [g.a.y, g.b.y, g.mid.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}

/** Bounding box of a segment, at least one unit wide and tall (the schema wants w > 0). */
export function segmentBox(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(1, Math.abs(a.x - b.x)), h: Math.max(1, Math.abs(a.y - b.y)) };
}

export function createArrow(
  doc: Y.Doc,
  from: ArrowEnd,
  to: ArrowEnd,
  rectOf: (id: string) => Rect | null,
  fields: Partial<Pick<ArrowElement, 'label' | 'line' | 'heads' | 'path'>>,
  opts: { userId: string | null; origin?: unknown },
): ArrowElement {
  const box = arrowBox(arrowGeometry({ from, to, path: fields.path }, rectOf));
  return createElement(
    doc,
    'arrow',
    { x: box.x, y: box.y },
    { ...fields, from, to, w: box.w, h: box.h },
    opts,
  ) as ArrowElement;
}

/**
 * After cards moved: stores where the attached ends now are (the point an end keeps once its
 * card is deleted) and the new bounding box, for the arrows attached to `movedIds`.
 */
export function refreshArrows(
  doc: Y.Doc,
  arrows: readonly ArrowElement[],
  movedIds: Iterable<string>,
  rectOf: (id: string) => Rect | null,
  origin?: unknown,
): void {
  const moved = new Set(movedIds);
  const touched = arrows.filter(
    (a) =>
      (a.from.elementId && moved.has(a.from.elementId)) ||
      (a.to.elementId && moved.has(a.to.elementId)),
  );
  if (touched.length === 0) return;
  const { elements } = roots(doc);
  doc.transact(() => {
    for (const arrow of touched) {
      const map = elements.get(arrow.id);
      if (!map) continue;
      const g = arrowGeometry(arrow, rectOf);
      const { a, b } = g;
      const box = arrowBox(g);
      map.set('from', { ...arrow.from, x: Math.round(a.x), y: Math.round(a.y) });
      map.set('to', { ...arrow.to, x: Math.round(b.x), y: Math.round(b.y) });
      map.set('x', Math.round(box.x));
      map.set('y', Math.round(box.y));
      map.set('w', Math.round(box.w) || 1);
      map.set('h', Math.round(box.h) || 1);
    }
  }, origin);
}

/** Moves the free ends of arrows by (dx, dy); attached ends stay with their cards. */
export function moveArrows(
  doc: Y.Doc,
  arrows: readonly ArrowElement[],
  dx: number,
  dy: number,
  rectOf: (id: string) => Rect | null,
  origin?: unknown,
): void {
  const { elements } = roots(doc);
  doc.transact(() => {
    for (const arrow of arrows) {
      const map = elements.get(arrow.id);
      if (!map) continue;
      const shift = (end: ArrowEnd): ArrowEnd =>
        end.elementId && rectOf(end.elementId)
          ? end
          : { ...end, x: Math.round(end.x + dx), y: Math.round(end.y + dy) };
      const from = shift(arrow.from);
      const to = shift(arrow.to);
      const box = arrowBox(arrowGeometry({ from, to, path: arrow.path }, rectOf));
      map.set('from', from);
      map.set('to', to);
      map.set('x', Math.round(box.x));
      map.set('y', Math.round(box.y));
      map.set('w', Math.round(box.w) || 1);
      map.set('h', Math.round(box.h) || 1);
    }
  }, origin);
}

/** Sets the path of arrows and stores their new bounding box. */
export function setArrowPath(
  doc: Y.Doc,
  arrows: readonly ArrowElement[],
  path: ArrowElement['path'],
  rectOf: (id: string) => Rect | null,
  origin?: unknown,
): void {
  const { elements } = roots(doc);
  doc.transact(() => {
    for (const arrow of arrows) {
      const map = elements.get(arrow.id);
      if (!map) continue;
      if (path) map.set('path', path);
      else map.delete('path');
      const box = arrowBox(arrowGeometry({ ...arrow, path }, rectOf));
      map.set('x', Math.round(box.x));
      map.set('y', Math.round(box.y));
      map.set('w', Math.round(box.w) || 1);
      map.set('h', Math.round(box.h) || 1);
    }
  }, origin);
}
