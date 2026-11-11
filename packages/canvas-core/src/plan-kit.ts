// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon, PlanIconKind } from '@inkadra/doc-schema';
import type { PlanElement } from './plan.ts';
import { modifiersOn } from './plan-attach.ts';
import { catalogueKind, isLight } from './plan-icons.ts';

/** Fields a configured light or camera of the project kit carries to a new copy. */
const KEPT = [
  'label',
  'make',
  'watts',
  'power',
  'gel',
  'stand',
  'kelvin',
  'role',
  'beam',
  'intensity',
  'lens',
  'support',
  'color',
  'percent',
  'size',
] as const;

/** A light or camera set up once in the project, to place again with its modifiers. */
export interface ProjectKitEntry {
  key: string;
  /** What a copy starts with: the kind and the fields of KEPT. */
  icon: Omit<PlanIcon, 'id' | 'x' | 'y'>;
  modifiers: PlanIconKind[];
  /** The lenses this camera was given across the project, smallest first. */
  lenses: number[];
}

const configuredLight = (i: PlanIcon, mods: number) =>
  !!(i.make || i.watts || i.power || i.gel || i.stand || i.kelvin || mods);
const configuredCamera = (i: PlanIcon) => !!(i.label || i.make);

/**
 * The project kit (decision 0104): the distinct configured lights and cameras found in the given
 * plans, derived every time, never stored, so it cannot drift. A light counts when it has a make,
 * power, gel, stand, colour temperature or modifiers; a camera when it has a name or a make.
 * Lights are the same when every kept field and their modifiers match; cameras when their name
 * and make match, their lenses gathered.
 */
export function projectKit(plans: ReadonlyArray<Pick<PlanElement, 'icons'>>): ProjectKitEntry[] {
  const out = new Map<string, ProjectKitEntry>();
  for (const plan of plans) {
    const icons = plan.icons ?? [];
    for (const icon of icons) {
      const kind = catalogueKind(icon.kind);
      const camera = kind === 'camera';
      const modifiers = camera ? [] : modifiersOn(icon, icons).map((m) => catalogueKind(m.kind));
      if (
        camera
          ? !configuredCamera(icon)
          : !isLight(kind) || !configuredLight(icon, modifiers.length)
      )
        continue;
      const kept: Record<string, unknown> = { kind };
      for (const field of KEPT) if (icon[field] !== undefined) kept[field] = icon[field];
      const key = camera
        ? JSON.stringify(['camera', icon.label ?? '', icon.make ?? ''])
        : // The same modifiers in any order are the same light (two of one rank keep the plan's).
          JSON.stringify([kept, [...modifiers].sort()]);
      const known = out.get(key);
      const lens = camera ? (icon.lens ?? null) : null;
      if (known) {
        if (lens && !known.lenses.includes(lens)) known.lenses.push(lens);
        known.lenses.sort((a, b) => a - b);
        continue;
      }
      // A camera's lenses are listed; a copy starts with the first.
      out.set(key, {
        key,
        icon: kept as ProjectKitEntry['icon'],
        modifiers,
        lenses: lens ? [lens] : [],
      });
    }
  }
  return [...out.values()];
}

/**
 * Kits joined into one (decision 0114): the open board's, derived live, then those the server
 * derived from the other boards. An entry already listed is not listed twice; a camera's lenses
 * are gathered from all of them.
 */
export function mergeProjectKits(
  ...kits: ReadonlyArray<readonly ProjectKitEntry[]>
): ProjectKitEntry[] {
  const out = new Map<string, ProjectKitEntry>();
  for (const kit of kits)
    for (const entry of kit) {
      const known = out.get(entry.key);
      if (!known) {
        out.set(entry.key, { ...entry, lenses: [...entry.lenses] });
        continue;
      }
      for (const lens of entry.lenses) if (!known.lenses.includes(lens)) known.lenses.push(lens);
      known.lenses.sort((a, b) => a - b);
    }
  return [...out.values()];
}
