// SPDX-License-Identifier: MPL-2.0
import { type Element, type ElementType, UNSORTED } from './elements.ts';

/**
 * True when an element, or one of its containers, is hidden from guests of share links.
 * Fails closed: an element whose chain of containers is broken (a parent that is missing, for
 * example a column deleted while a card moved into it) or circular counts as hidden. Only
 * `UNSORTED` and the canvas (null) end a chain as shown.
 */
export function hiddenFromGuests(
  elementId: string,
  lookup: (id: string) => { guestHidden?: boolean; parent: string | null } | undefined,
): boolean {
  const seen = new Set<string>();
  let id: string | null = elementId;
  while (id !== null && id !== UNSORTED) {
    if (seen.has(id)) return true;
    seen.add(id);
    const el = lookup(id);
    if (!el) return true;
    if (el.guestHidden === true) return true;
    id = el.parent;
  }
  return false;
}

const COMMON_GUEST_FIELDS = [
  'id',
  'type',
  'x',
  'y',
  'w',
  'h',
  'z',
  'parent',
  'createdBy',
  'createdAt',
] as const;

/**
 * The fields of each element type that guests of share links receive (decision 0013). It is
 * an allow list: a field added to an element later stays out of guest snapshots until it is
 * added here. Left out on purpose: `tags` (internal labels), `locked` (editing state),
 * `guestHidden` (hidden elements are not sent at all) and, on frames, `status` (the production
 * status, not the review) and `notes` (the director's notes). `createdBy` is always sent as
 * null.
 */
export const GUEST_ELEMENT_FIELDS = {
  note: [...COMMON_GUEST_FIELDS, 'color'],
  image: [...COMMON_GUEST_FIELDS, 'assetId', 'caption'],
  link: [...COMMON_GUEST_FIELDS, 'url', 'title', 'description', 'imageAssetId'],
  file: [...COMMON_GUEST_FIELDS, 'assetId', 'caption'],
  todo: [...COMMON_GUEST_FIELDS, 'title', 'items'],
  color: [...COMMON_GUEST_FIELDS, 'hex', 'label'],
  column: [...COMMON_GUEST_FIELDS, 'title', 'collapsed'],
  board: [...COMMON_GUEST_FIELDS, 'boardId'],
  scene: [
    ...COMMON_GUEST_FIELDS,
    'number',
    'title',
    'setting',
    'time',
    'location',
    'synopsis',
    'collapsed',
  ],
  frame: [
    ...COMMON_GUEST_FIELDS,
    'label',
    'assetId',
    'aspect',
    'action',
    'shot',
    'angle',
    'movement',
    'lens',
    'durationMs',
    'audio',
    'dialogue',
    'location',
    'cast',
    'strokes',
  ],
  arrow: [...COMMON_GUEST_FIELDS, 'from', 'to', 'label', 'line', 'heads'],
} as const satisfies Record<ElementType, readonly string[]>;

/**
 * An element as guests receive it: only the fields of GUEST_ELEMENT_FIELDS, `createdBy` null.
 * It still parses with `Element`. Whether the element is shown at all is hiddenFromGuests.
 */
export function toGuestElement(element: Element): Record<string, unknown> {
  const source = element as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of GUEST_ELEMENT_FIELDS[element.type]) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  out.createdBy = null;
  return out;
}
