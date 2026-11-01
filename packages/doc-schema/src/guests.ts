// SPDX-License-Identifier: MPL-2.0
import { type Element, type ElementType, UNSORTED } from './elements.ts';

/**
 * True when an element, or one of its containers, is hidden from guests of share links.
 * The unsorted tray is internal to the board, so an element whose chain of containers reaches
 * `UNSORTED` counts as hidden, too. Fails closed: an element whose chain is broken (a parent
 * that is missing, for example a column deleted while a card moved into it) or circular also
 * counts as hidden. Only the canvas (null) ends a chain as shown.
 */
export function hiddenFromGuests(
  elementId: string,
  lookup: (id: string) => { guestHidden?: boolean; parent: string | null } | undefined,
): boolean {
  const seen = new Set<string>();
  let id: string | null = elementId;
  while (id !== null) {
    if (id === UNSORTED) return true;
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
 * status, not the review) and `notes` (the director's notes); on characters `contact` and
 * `notes`, on locations `address`, `mapUrl`, `availability`, `contact` and `notes` (people's
 * details and private places, decision 0044). `createdBy` is always sent as null.
 */
export const GUEST_ELEMENT_FIELDS = {
  note: [...COMMON_GUEST_FIELDS, 'color'],
  image: [...COMMON_GUEST_FIELDS, 'assetId', 'caption', 'crop', 'rotation'],
  link: [...COMMON_GUEST_FIELDS, 'url', 'title', 'description', 'imageAssetId'],
  file: [...COMMON_GUEST_FIELDS, 'assetId', 'caption'],
  todo: [...COMMON_GUEST_FIELDS, 'title', 'items', 'list', 'sceneId'],
  color: [...COMMON_GUEST_FIELDS, 'hex', 'label'],
  column: [...COMMON_GUEST_FIELDS, 'title', 'collapsed', 'color'],
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
    'shapes',
    'referenceOpacity',
  ],
  arrow: [...COMMON_GUEST_FIELDS, 'from', 'to', 'label', 'line', 'heads', 'path'],
  character: [
    ...COMMON_GUEST_FIELDS,
    'name',
    'role',
    'assetId',
    'age',
    'description',
    'actor',
    'scenes',
  ],
  location: [...COMMON_GUEST_FIELDS, 'name', 'setting', 'assetId', 'light', 'scenes'],
  section: [...COMMON_GUEST_FIELDS, 'title'],
  table: [...COMMON_GUEST_FIELDS, 'columns', 'rows', 'header', 'color'],
  map: [...COMMON_GUEST_FIELDS, 'name', 'address', 'url', 'lat', 'lon', 'zoom', 'imageAssetId'],
} as const satisfies Record<ElementType, readonly string[]>;

/**
 * An element as guests receive it: only the fields of GUEST_ELEMENT_FIELDS, `createdBy` null.
 * It still parses with `Element`. Whether the element is shown at all is hiddenFromGuests.
 * When `label` is passed for a frame (computed from the full document before hiding), it sets
 * the frame's shot label.
 */
export function toGuestElement(element: Element, label?: string): Record<string, unknown> {
  const source = element as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of GUEST_ELEMENT_FIELDS[element.type]) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  if (element.type === 'frame' && label !== undefined) {
    out.label = label;
  }
  out.createdBy = null;
  return out;
}
