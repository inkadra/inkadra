// SPDX-License-Identifier: MPL-2.0

/**
 * The draw order of elements: by `z`, then by `id`. Lower comes first: drawn below on the
 * canvas, higher in a column or a scene.
 *
 * `z` is a fractional index (the `fractional-indexing` keys, digits `0-9A-Za-z`), made so that
 * plain code-unit comparison (`<` on strings) orders it: `Zz` < `a0` < `a0V` < `a0v` < `a1`.
 * Never compare keys with `localeCompare` or `Intl.Collator`: collation puts lower case before
 * upper case and ignores case at first, so it orders `a0` before `Zz` and `a0v` before `a0V`,
 * and the result depends on the runtime's locale data. Two elements may share a key (two
 * clients inserting at the same place at once): the id breaks the tie, so every client draws
 * them alike.
 */
export function compareZ(a: { z: string; id: string }, b: { z: string; id: string }): number {
  if (a.z !== b.z) return a.z < b.z ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
