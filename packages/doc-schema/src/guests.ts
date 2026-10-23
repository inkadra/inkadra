// SPDX-License-Identifier: MPL-2.0

/** True when an element, or one of its containers, is hidden from guests of share links. */
export function hiddenFromGuests(
  elementId: string,
  lookup: (id: string) => { guestHidden?: boolean; parent: string | null } | undefined,
): boolean {
  const seen = new Set<string>();
  let id: string | null = elementId;
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const el = lookup(id);
    if (!el) return false;
    if (el.guestHidden === true) return true;
    id = el.parent;
  }
  return false;
}
