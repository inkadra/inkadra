// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The kit list, the counts of the card and the power per circuit live in canvas-core (decision
 * 0116): the web and the mobile app read a plan the same. So does how a typed measure is stored.
 */
export {
  circuitNames,
  foldNames,
  KIT_GROUPS,
  type KitGroup,
  type KitLine,
  kitList,
  measureValue,
  type PowerLines,
  planCounts,
  powerLines,
  wattsText,
} from '@inkadra/canvas-core';
