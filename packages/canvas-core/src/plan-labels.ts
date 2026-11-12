// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon } from '@inkadra/doc-schema';
import { isLight } from './plan-icons.ts';

/**
 * The words a set plan writes next to its icons (decisions 0104, 0116 and 0118), the same on
 * every client: the label, a named light's second line and the watts as the mockup writes them.
 */

/** Size of an icon's label and of a light's second line, view units, as the mockup's plan. */
export const PLAN_LABEL_SIZE = 12;
export const PLAN_SUB_LABEL_SIZE = 11;

/** "300 W", "2K", "1.2K": a light's watts as the mockup writes them, in the reader's language. */
export function wattsText(watts: number, locale?: string): string {
  return watts >= 1000
    ? `${(watts / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}K`
    : `${watts.toLocaleString(locale, { maximumFractionDigits: 0 })} W`;
}

/** "A cam · 35 mm", "Key · 300 W": the label of an icon on the plan. */
export function iconLabel(icon: PlanIcon, locale?: string): string {
  const mm = icon.lens ?? 35;
  // "A cam 35mm" already says it: no "· 35 mm" again.
  const said = new RegExp(`\\b${mm}\\s?mm\\b`, 'i').test(icon.label ?? '');
  const lens = icon.kind === 'camera' && icon.showLens && !said ? `${mm} mm` : '';
  // The power as written, or the watts (decision 0104); a kilowatt and more as "2K".
  const written = icon.power || (icon.watts ? wattsText(icon.watts, locale) : '');
  const power = written && !icon.label?.includes(written) ? written : '';
  return [icon.label, lens, power].filter(Boolean).join(' · ');
}

/**
 * The second, dim line under a named light (the mockup's "5600 K · 60%"): its colour
 * temperature and level; '' for other icons and for lights without either.
 */
export function iconSubLabel(icon: PlanIcon): string {
  if (!icon.label || !isLight(icon.kind)) return '';
  return [
    icon.kelvin ? `${icon.kelvin} K` : '',
    // Full power goes without saying, as the mockup's "Sodium · 2K / 2100 K" (decision 0119).
    icon.intensity !== undefined && icon.intensity < 1
      ? `${Math.round(icon.intensity * 100)}%`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
