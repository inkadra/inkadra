// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The kit list, the counts of the card and the power per circuit live in canvas-core (decision
 * 0116): the web and the mobile app read a plan the same.
 */
export {
  circuitNames,
  foldNames,
  KIT_GROUPS,
  type KitGroup,
  type KitLine,
  kitList,
  type PowerLines,
  planCounts,
  powerLines,
  wattsText,
} from '@inkadra/canvas-core';

/** A number typed on a measure as it is stored ("6,20" gives "6.2"); null if it is no length. */
export function measureValue(typed: string): string | null {
  const m = Number(typed.trim().replace(',', '.'));
  return Number.isFinite(m) && m > 0 && m < 100000 ? String(m) : null;
}
