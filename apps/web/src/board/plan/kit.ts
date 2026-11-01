// SPDX-License-Identifier: AGPL-3.0-only
import { categoryOf, iconSize, isSized, layerOf } from '@inkadra/canvas-core';
import type { PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';

/** Categories whose icons are kit to bring: lights, grip, camera and movement, audio and video. */
const KIT = new Set(['lights', 'grip', 'camera', 'av']);

/**
 * The kit a plan needs (#335 round 6, i), "Fresnel 1,2K ×1", "Binario 3 m ×1": its icons of
 * kit categories counted by type and power or length, in the order they first appear; people, furniture and
 * hidden layers are left out.
 */
export function kitList(
  plan: {
    icons?: readonly PlanIcon[] | undefined;
    hiddenLayers?: readonly string[] | undefined;
    scale?: number | undefined;
  },
  t: TFunction,
  locale?: string,
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const icon of plan.icons ?? []) {
    if (!KIT.has(categoryOf(icon.kind).id) || plan.hiddenLayers?.includes(layerOf(icon))) continue;
    // Type and spec, as the mockup: the power of a light, the length of a track or a frame.
    const size =
      !icon.power && plan.scale && isSized(icon.kind)
        ? `${(Math.max(...Object.values(iconSize(icon))) / plan.scale).toLocaleString(locale, {
            maximumFractionDigits: 1,
          })} m`
        : '';
    const name = [t(`board.plan.icons.${icon.kind}`), icon.power, size].filter(Boolean).join(' ');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}
