// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The rows of the Elements tab, the names and summaries of items and the legend live in
 * canvas-core (decision 0116): every client lists a plan the same. So do what a selection holds
 * and the seats at a table, which the Properties write.
 */
export {
  ELEMENT_GROUPS,
  ELEMENT_LAYERS,
  type ElementRow,
  type ElementsFilter,
  elementSections,
  foldIcons,
  itemName,
  itemSummary,
  NAMED_SEATS,
  SEAT_SURFACES,
  seatsAround,
  seatsLine,
  selectionMix,
  supportText,
} from '@inkadra/canvas-core';
