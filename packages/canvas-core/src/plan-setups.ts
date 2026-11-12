// SPDX-License-Identifier: MPL-2.0
import type { Element, PlanIcon } from '@inkadra/doc-schema';
import type { SceneElement } from './film.ts';
import { iconCentre, layerOf, type PlanElement, variantFamily, variantView } from './plan.ts';
import { catalogueKind } from './plan-icons.ts';
import { planCounts } from './plan-kit-list.ts';
import { linkedLocation, setupFrames } from './plan-links.ts';
import type { Words } from './plan-words.ts';

/**
 * "Set plan · Kitchen, day 2": the name of a plan in the editor, the view and the export; a setup
 * adds its own, "Set plan · Kitchen, day 2 · Evening" (its title is its base's, decision 0117).
 * The base's setup name stays on its tab.
 */
export function planTitle(
  t: Words,
  plan: Pick<PlanElement, 'title' | 'variant' | 'variantOf'>,
): string {
  return [t('board.plan.name'), plan.title, plan.variantOf ? plan.variant : '']
    .filter(Boolean)
    .join(' · ');
}

/**
 * The words of a plan's card (decision 0111): its name (the base's title, else the linked
 * location), its scenes, and the counts of its setups, cameras and lights with their power. The
 * card on the board and board exports (decision 0119) write the same.
 */
export function planCardWords(
  element: PlanElement,
  byId: ReadonlyMap<string, Element>,
  t: Words,
  locale: string,
) {
  // The base of a variant is another card: follow it, so a wall moved there moves here.
  const baseEl = element.variantOf ? byId.get(element.variantOf) : undefined;
  const base = baseEl?.type === 'plan' ? baseEl : undefined;
  const plan = base ? variantView(element, base) : element;
  const scenes = scenesOfPlan(element.sceneIds ? element : (base ?? element), byId);
  const family = variantFamily(byId.values(), element);
  const { cameras, lights, watts } = planCounts(plan);
  const place = linkedLocation(base ?? element, byId)?.name;
  // The title is the base's, shown by every setup (decision 0117).
  const name = (base ? base.title : element.title) || place || t('board.plan.name');
  const kw =
    watts >= 1000
      ? `${(watts / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} kW`
      : `${watts} W`;
  const chips = [
    family.length > 1 ? t('board.plan.card.setups', { count: family.length }) : '',
    cameras ? t('board.plan.card.cameras', { count: cameras }) : '',
    lights
      ? [t('board.plan.card.lights', { count: lights }), watts > 0 ? kw : '']
          .filter(Boolean)
          .join(' · ')
      : '',
  ].filter(Boolean);
  return {
    plan,
    scenes,
    title: element.variantOf && element.variant ? `${name} · ${element.variant}` : name,
    chips,
  };
}

/** The scenes a plan serves that still exist, in its order. */
export function scenesOfPlan(
  plan: Pick<PlanElement, 'sceneIds'>,
  byId: ReadonlyMap<string, Element>,
): SceneElement[] {
  return (plan.sceneIds ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is SceneElement => e?.type === 'scene');
}

/**
 * The name of a setup: "1 · Master", the base first. The base is "Base" until it is renamed like
 * any other setup (decision 0117).
 */
export function setupName(p: PlanElement, family: readonly PlanElement[], t: Words): string {
  const n =
    Math.max(
      0,
      family.findIndex((f) => f.id === p.id),
    ) + 1;
  const name = p.variant || t(p.variantOf ? 'board.plan.variant' : 'board.plan.base');
  return `${n} · ${name}`;
}

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

/**
 * Each icon of the setup paired with the nearest icon of the base of the same kind not paired
 * yet, named pairs first. Linear in the base's icons of that kind: no sorting, so a plan of 300
 * icons is paired in about a millisecond.
 */
function pairUp(left: readonly PlanIcon[], mine: readonly PlanIcon[]): Map<PlanIcon, PlanIcon> {
  const byKind = new Map<string, PlanIcon[]>();
  for (const b of left) {
    const k = catalogueKind(b.kind);
    const list = byKind.get(k);
    if (list) list.push(b);
    else byKind.set(k, [b]);
  }
  const pairs = new Map<PlanIcon, PlanIcon>();
  const taken = new Set<PlanIcon>();
  // Named first, so a renamed icon does not take the place of one that kept its name.
  for (const pass of ['named', 'any'] as const)
    for (const icon of mine) {
      if (pairs.has(icon)) continue;
      const own = name(icon);
      let best: PlanIcon | undefined;
      let bestAt = Number.POSITIVE_INFINITY;
      for (const b of byKind.get(catalogueKind(icon.kind)) ?? []) {
        if (taken.has(b) || (pass === 'named' && (own === '' || name(b) !== own))) continue;
        const d = distance(b, icon);
        // The first of equals, as the catalogue's order had it.
        if (d < bestAt) {
          best = b;
          bestAt = d;
        }
      }
      if (best) {
        pairs.set(icon, best);
        taken.add(best);
      }
    }
  return pairs;
}

export function setupChanges(base: readonly PlanIcon[], setup: readonly PlanIcon[]): SetupChange[] {
  const own = (list: readonly PlanIcon[]) => list.filter((i) => layerOf(i) !== 'set');
  const left = own(base);
  const mine = own(setup);
  const pairs = pairUp(left, mine);
  const taken = new Set(pairs.values());
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
  /** Its place among the setups of the board: the plans' order, the base of a family first. */
  order: number;
}

/**
 * The setups of the board each shot belongs to (decision 0104): a setup knows the frames its
 * cameras link to (`setupFrames`). Computed from the plans every time, never stored. Shots in
 * several setups list them in the order of the plans, the base of a family first.
 */
export function shotSetups(elements: readonly Element[], t: Words): Map<string, ShotSetup[]> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = new Map<string, ShotSetup[]>();
  const plans = elements.filter((e): e is PlanElement => e.type === 'plan');
  let order = 0;
  for (const base of plans.filter((p) => !p.variantOf || !byId.has(p.variantOf))) {
    const family = variantFamily(plans, base);
    for (const p of family) {
      for (const frameId of setupFrames(p, byId)) {
        const list = out.get(frameId) ?? [];
        list.push({ planId: p.id, name: setupName(p, family, t), plan: planTitle(t, base), order });
        out.set(frameId, list);
      }
      order++;
    }
  }
  return out;
}

/**
 * Shots grouped under their setups ("Group by: Setup" of the shot list and the schedule): the
 * setups in the order of the plans, then the shots of no setup (`setup: null`). A shot of two
 * setups is under each, so callers count, select and key it once by its id (decision 0111).
 */
export function groupBySetup<T extends { id: string }>(
  shots: readonly T[],
  setups: ReadonlyMap<string, readonly ShotSetup[]>,
): Array<{ setup: ShotSetup | null; shots: T[] }> {
  const groups = new Map<string, { setup: ShotSetup | null; shots: T[] }>();
  const loose: T[] = [];
  for (const shot of shots) {
    const of = setups.get(shot.id);
    if (!of?.length) loose.push(shot);
    for (const s of of ?? []) {
      const group = groups.get(s.planId) ?? { setup: s, shots: [] };
      group.shots.push(shot);
      groups.set(s.planId, group);
    }
  }
  const out = [...groups.values()].sort((a, b) => (a.setup?.order ?? 0) - (b.setup?.order ?? 0));
  return loose.length ? [...out, { setup: null, shots: loose }] : out;
}

/**
 * The shot blocks of a shooting day under their setups, in the day's order (the schedule's
 * Block tab, decision 0115). Blocks of no frame, of a frame that is gone and of an omitted scene
 * (decision 0082) are left out.
 */
export function dayBySetup<B extends { shotId: string | null }>(
  blocks: readonly B[],
  byId: ReadonlyMap<string, Element>,
  setups: ReadonlyMap<string, readonly ShotSetup[]>,
): Array<{ setup: ShotSetup | null; shots: Array<{ id: string; block: B }> }> {
  const shots = blocks.flatMap((block) => {
    const frame = block.shotId ? byId.get(block.shotId) : undefined;
    const scene = frame?.parent ? byId.get(frame.parent) : undefined;
    if (frame?.type !== 'frame' || (scene?.type === 'scene' && scene.omitted)) return [];
    return [{ id: frame.id, block }];
  });
  return shots.length ? groupBySetup(shots, setups) : [];
}
