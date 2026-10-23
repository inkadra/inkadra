// SPDX-License-Identifier: MPL-2.0

/** Column chrome, in world units: the web and mobile renderers draw columns with these. */
export const COLUMN_PADDING = 10;
export const COLUMN_HEADER = 28;
export const COLUMN_GAP = 8;

/**
 * Where a card dropped at `y` lands in a column, given the vertical extent of each child
 * (top and height, in the same units as `y`). Returns an index from 0 to children.length.
 */
export function dropIndex(children: Array<{ top: number; height: number }>, y: number): number {
  const index = children.findIndex((c) => y < c.top + c.height / 2);
  return index === -1 ? children.length : index;
}
