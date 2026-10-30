// SPDX-License-Identifier: AGPL-3.0-only
import {
  boundsOf,
  COLUMN_GAP,
  COLUMN_HEADER,
  COLUMN_PADDING,
  inflate,
  intersects,
  type Rect,
} from '@inkadra/canvas-core';
import { Element, hiddenFromGuests, toGuestElement } from '@inkadra/doc-schema';

/**
 * Who an export is for. `client` keeps exactly what a guest of a share link sees: hidden
 * cards and their contents are left out and each element keeps only its guest fields.
 */
export type Audience = 'team' | 'client';

export interface ExportFilter {
  audience: Audience;
  /** Leave out cards hidden from guests even for the team. Always true for clients. */
  hideGuestHidden: boolean;
}

type Lookup = (id: string) => Element | undefined;

/** The element as the export may show it, or null when it must be left out. */
export function exportable(el: Element, lookup: Lookup, filter: ExportFilter): Element | null {
  const client = filter.audience === 'client';
  if ((client || filter.hideGuestHidden) && hiddenFromGuests(el.id, lookup)) return null;
  if (!client) return el;
  const parsed = Element.safeParse(toGuestElement(el));
  return parsed.success ? parsed.data : null;
}

export interface BoardSource {
  byId: ReadonlyMap<string, Element>;
  /** Elements on the canvas, in drawing order. */
  canvas: readonly Element[];
  /** Children of each column and scene, top to bottom. */
  columns: ReadonlyMap<string, readonly Element[]>;
  heightOf(el: Element): number;
  /** Height of a card stacked in a column at width `w`; the canvas does not measure those. */
  nestedHeight?(el: Element, w: number): number | null;
}

export type ExportScope =
  | { kind: 'board' }
  | { kind: 'selection'; ids: ReadonlySet<string> }
  | { kind: 'visible'; rect: Rect };

export interface Placed extends Rect {
  el: Element;
  /** Cards stacked inside a column or a scene. */
  children?: Placed[];
}

/** Space around the cards of a board page, in board units. */
export const REGION_PADDING = 24;

/**
 * The cards an export draws, with their rectangles in board units, and the region around them.
 * Children of columns and scenes are stacked again without the cards that are left out.
 */
export function collectBoard(
  source: BoardSource,
  scope: ExportScope,
  filter: ExportFilter,
): { items: Placed[]; region: Rect | null } {
  const lookup: Lookup = (id) => source.byId.get(id);
  const selected = scope.kind === 'selection' ? withContainers(scope.ids, lookup) : null;
  const items: Placed[] = [];
  for (const raw of source.canvas) {
    if (raw.type === 'arrow') continue;
    const el = exportable(raw, lookup, filter);
    if (!el) continue;
    if (selected && !selected.has(el.id)) continue;
    const placed = place(el, source, lookup, filter);
    if (scope.kind === 'visible' && !intersects(placed, scope.rect)) continue;
    items.push(placed);
  }
  const shown = new Set(items.map((p) => p.el.id));
  for (const raw of source.canvas) {
    if (raw.type !== 'arrow') continue;
    const el = exportable(raw, lookup, filter);
    if (el?.type !== 'arrow') continue;
    // An arrow attached to a card that is left out would point at nothing.
    const ends = [el.from.elementId, el.to.elementId].filter((id): id is string => !!id);
    if (ends.some((id) => !shown.has(id) && !nestedIn(id, shown, lookup))) continue;
    if (selected && !selected.has(el.id) && ends.length < 2) continue;
    const rect = { x: el.x, y: el.y, w: el.w, h: el.h ?? 1 };
    if (scope.kind === 'visible' && !intersects(rect, scope.rect)) continue;
    items.push({ el, ...rect });
  }
  const bounds = boundsOf(items);
  const region =
    scope.kind === 'visible' ? scope.rect : bounds ? inflate(bounds, REGION_PADDING) : null;
  return { items, region };
}

/** A selected card inside a column brings its column, which is what the canvas shows. */
function withContainers(ids: ReadonlySet<string>, lookup: Lookup): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    let el = lookup(id);
    const seen = new Set<string>();
    while (el && el.parent !== null && !seen.has(el.id)) {
      seen.add(el.id);
      el = lookup(el.parent);
    }
    if (el) out.add(el.id);
  }
  return out;
}

function nestedIn(id: string, shown: ReadonlySet<string>, lookup: Lookup): boolean {
  const parent = lookup(id)?.parent;
  return !!parent && shown.has(parent);
}

function place(el: Element, source: BoardSource, lookup: Lookup, filter: ExportFilter): Placed {
  const rect = { x: el.x, y: el.y, w: el.w, h: source.heightOf(el) };
  if (el.type !== 'column' && el.type !== 'scene') return { el, ...rect };
  if (el.collapsed) return { el, ...rect, children: [] };
  const all = source.columns.get(el.id) ?? [];
  const children: Placed[] = [];
  const header = el.type === 'scene' ? COLUMN_HEADER + 16 : COLUMN_HEADER;
  let y = el.y + COLUMN_PADDING + header;
  const w = el.w - COLUMN_PADDING * 2;
  for (const raw of all) {
    const child = exportable(raw, lookup, filter);
    if (!child) continue;
    // Cards in a column fill its width.
    const h = child.h ?? source.nestedHeight?.(child, w) ?? source.heightOf(child);
    children.push({ el: child, x: el.x + COLUMN_PADDING, y, w, h });
    y += h + COLUMN_GAP;
  }
  const stacked = y - el.y - (children.length ? COLUMN_GAP : 0) + COLUMN_PADDING;
  return { el, ...rect, h: Math.max(stacked, header + COLUMN_PADDING * 2), children };
}
