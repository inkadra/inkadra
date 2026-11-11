// SPDX-License-Identifier: AGPL-3.0-only
import { categoryOf, iconSize, isSized, layerOf } from '@inkadra/canvas-core';
import type { PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';

/** Categories whose icons are kit to bring: lights, grip, camera and movement, video and sound. */
const KIT = new Set(['lights', 'grip', 'camera', 'av']);
/** People of those categories, not kit. */
const NOT_KIT = new Set<PlanIcon['kind']>(['crew']);
/** What a light's `stand` or a camera's `support` names that is kit to bring (decision 0104). */
const STAND_KIT = new Set([
  'cstand',
  'combo',
  'boomarm',
  'dolly',
  'tripod',
  'gimbal',
  'slider',
  'jib',
]);

/**
 * The kit a plan needs (#335 round 6, i; decision 0104), "Fresnel 1,2K ×1", "Binario 3 m ×1":
 * its icons of kit categories (lights, modifiers and grip, stands, power, camera and movement,
 * video and sound) counted by type and power or length, then the gels written on lights and the
 * stands and supports named on lights and cameras that stand on no icon, in the order they first
 * appear. People, furniture and hidden layers are left out.
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
  const add = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  const icons = (plan.icons ?? []).filter((i) => !plan.hiddenLayers?.includes(layerOf(i)));
  const ids = new Set(icons.map((i) => i.id));
  for (const icon of icons) {
    if (!KIT.has(categoryOf(icon.kind).id) || NOT_KIT.has(icon.kind)) continue;
    // Type and spec, as the mockup: the power of a light, the length of a track or a frame.
    const power = icon.power || (icon.watts ? `${icon.watts} W` : '');
    const size =
      !power && plan.scale && isSized(icon.kind)
        ? `${(Math.max(...Object.values(iconSize(icon))) / plan.scale).toLocaleString(locale, {
            maximumFractionDigits: 1,
          })} m`
        : '';
    add([t(`board.plan.icons.${icon.kind}`), power, size].filter(Boolean).join(' '));
  }
  for (const icon of icons) {
    if (icon.gel) add(`${t('board.plan.icons.gel')}: ${icon.gel}`);
    // A stand or a support named on the item, when it stands on no icon of the plan.
    const holder = icon.stand ?? icon.support;
    if (holder && STAND_KIT.has(holder) && !(icon.on && ids.has(icon.on)))
      add(t(`board.plan.icons.${holder}`));
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

/** A number typed on a measure as it is stored ("6,20" gives "6.2"); null if it is no length. */
export function measureValue(typed: string): string | null {
  const m = Number(typed.trim().replace(',', '.'));
  return Number.isFinite(m) && m > 0 && m < 100000 ? String(m) : null;
}
