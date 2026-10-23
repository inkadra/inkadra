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
  arrow: Pick<ArrowElement, 'from' | 'to'>,
  rectOf: (id: string) => Rect | null,
): { a: Point; b: Point } {
  const ra = arrow.from.elementId ? rectOf(arrow.from.elementId) : null;
  const rb = arrow.to.elementId ? rectOf(arrow.to.elementId) : null;
  const pa = ra ? centerOf(ra) : { x: arrow.from.x, y: arrow.from.y };
  const pb = rb ? centerOf(rb) : { x: arrow.to.x, y: arrow.to.y };
  return { a: ra ? exitPoint(ra, pb) : pa, b: rb ? exitPoint(rb, pa) : pb };
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
  fields: Partial<Pick<ArrowElement, 'label' | 'line' | 'heads'>>,
  opts: { userId: string | null; origin?: unknown },
): ArrowElement {
  const { a, b } = arrowEnds({ from, to }, rectOf);
  const box = segmentBox(a, b);
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
      const { a, b } = arrowEnds(arrow, rectOf);
      const box = segmentBox(a, b);
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
      const { a, b } = arrowEnds({ from, to }, rectOf);
      const box = segmentBox(a, b);
      map.set('from', from);
      map.set('to', to);
      map.set('x', Math.round(box.x));
      map.set('y', Math.round(box.y));
      map.set('w', Math.round(box.w) || 1);
      map.set('h', Math.round(box.h) || 1);
    }
  }, origin);
}
