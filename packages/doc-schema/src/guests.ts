// SPDX-License-Identifier: MPL-2.0
import { UNSORTED } from './elements.ts';

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
