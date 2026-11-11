// SPDX-License-Identifier: AGPL-3.0-only
import {
  catalogueKind,
  iconCentre,
  layerOf,
  type PlanElement,
  setupFrames,
  variantFamily,
} from '@inkadra/canvas-core';
import type { Element, PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { planTitle } from './PlanCard.tsx';
import { setupName } from './PlanKit.tsx';

/**
 * What changed on a setup from the base setup (the note under the setup tabs, decision 0104):
 * its icons off the Set layer compared with the base's. A setup is a copy, so the icons have
 * new ids: they are matched by kind and name, else by kind and nearness.
 */
export type SetupChange =
  | { kind: 'added'; icon: PlanIcon }
  | { kind: 'removed'; icon: PlanIcon }
  /** Moved by `by` view units; a lens or a light changed with it. */
  | { kind: 'moved'; icon: PlanIcon; by: number; lens?: number }
  | { kind: 'lens'; icon: PlanIcon; lens: number }
  | { kind: 'changed'; icon: PlanIcon };

/** Fields whose change is "changed" (the place and the lens are told apart). */
const FIELDS = [
  'label',
  'rotation',
  'watts',
  'power',
  'kelvin',
  'beam',
  'intensity',
  'gel',
  'pose',
  'percent',
  'size',
  'w',
  'h',
  'reach',
  'height',
  'tilt',
  'role',
  'steps',
] as const;
/** Less than this (view units) is the same place. */
const SAME_PLACE = 6;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const name = (i: PlanIcon) => (i.label ?? '').trim().toLocaleLowerCase();
const distance = (a: PlanIcon, b: PlanIcon) => {
  const p = iconCentre(a);
  const q = iconCentre(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

export function setupChanges(base: readonly PlanIcon[], setup: readonly PlanIcon[]): SetupChange[] {
  const own = (list: readonly PlanIcon[]) => list.filter((i) => layerOf(i) !== 'set');
  const left = own(base);
  const pairs = new Map<PlanIcon, PlanIcon>();
  const taken = new Set<PlanIcon>();
  const mine = own(setup);
  // Named first, so a renamed icon does not take the place of one that kept its name.
  for (const pass of ['named', 'any'] as const)
    for (const icon of mine) {
      if (pairs.has(icon)) continue;
      const candidates = left.filter(
        (b) =>
          !taken.has(b) &&
          catalogueKind(b.kind) === catalogueKind(icon.kind) &&
          (pass === 'any' || (name(b) !== '' && name(b) === name(icon))),
      );
      const best = candidates.sort((a, b) => distance(a, icon) - distance(b, icon))[0];
      if (best) {
        pairs.set(icon, best);
        taken.add(best);
      }
    }
  const out: SetupChange[] = [];
  for (const icon of mine) {
    const was = pairs.get(icon);
    if (!was) {
      out.push({ kind: 'added', icon });
      continue;
    }
    const by = distance(was, icon);
    const lensChanged =
      catalogueKind(icon.kind) === 'camera' && (icon.lens ?? 0) !== (was.lens ?? 0);
    if (by > SAME_PLACE)
      out.push({ kind: 'moved', icon, by, ...(lensChanged ? { lens: icon.lens ?? 35 } : {}) });
    else if (lensChanged) out.push({ kind: 'lens', icon, lens: icon.lens ?? 35 });
    else if (FIELDS.some((f) => !same(icon[f], was[f]))) out.push({ kind: 'changed', icon });
  }
  for (const icon of left) if (!taken.has(icon)) out.push({ kind: 'removed', icon });
  return out;
}

/** A setup a shot belongs to: the plan card, its name in its family, and the plan's title. */
export interface ShotSetup {
  planId: string;
  /** "1 · Master". */
  name: string;
  /** "Set plan · Diner". */
  plan: string;
}

/**
 * The setups of the board each shot belongs to (decision 0104): a setup knows the frames its
 * cameras link to (`setupFrames`). Computed from the plans every time, never stored. Shots in
 * several setups list them in the order of the plans, the base of a family first.
 */
export function shotSetups(elements: readonly Element[], t: TFunction): Map<string, ShotSetup[]> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = new Map<string, ShotSetup[]>();
  const plans = elements.filter((e): e is PlanElement => e.type === 'plan');
  for (const base of plans.filter((p) => !p.variantOf || !byId.has(p.variantOf))) {
    const family = variantFamily(plans, base);
    for (const p of family)
      for (const frameId of setupFrames(p, byId)) {
        const list = out.get(frameId) ?? [];
        list.push({ planId: p.id, name: setupName(p, family, t), plan: planTitle(t, base) });
        out.set(frameId, list);
      }
  }
  return out;
}
