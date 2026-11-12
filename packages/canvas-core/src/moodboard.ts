// SPDX-License-Identifier: MPL-2.0
import type { Element } from '@inkadra/doc-schema';
import { normaliseTag } from './tags.ts';

/** A moodboard reference: a picture, a link with a picture or a colour. */
export type Reference = Extract<Element, { type: 'image' | 'link' | 'color' }>;

/**
 * The named groups by name and, last, the references without one (decision 0077). Names are
 * compared as tags; a group shows the name of its first reference. References keep their order.
 */
export function referenceGroups<T extends Pick<Reference, 'group'>>(
  references: readonly T[],
): Array<{ name: string | null; items: T[] }> {
  const named = new Map<string, { name: string; items: T[] }>();
  const loose: T[] = [];
  for (const el of references) {
    if (!el.group) {
      loose.push(el);
      continue;
    }
    const key = normaliseTag(el.group);
    const group = named.get(key) ?? { name: el.group, items: [] };
    group.items.push(el);
    named.set(key, group);
  }
  return [
    ...[...named.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...(loose.length ? [{ name: null, items: loose }] : []),
  ];
}
