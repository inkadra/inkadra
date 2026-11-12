// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon } from '@inkadra/doc-schema';
import { iconSize, layerOf, type PlanElement, variantView } from './plan.ts';
import { modifiersOn } from './plan-attach.ts';
import { itemName } from './plan-elements.ts';
import {
  attachRole,
  catalogueKind,
  categoryOf,
  isKitLight,
  isLight,
  isSized,
} from './plan-icons.ts';
import { wattsText } from './plan-labels.ts';
import { type CircuitStatus, iconWatts, planPower } from './plan-power.ts';
import type { Words } from './plan-words.ts';

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
 * The sections of the kit list, as the mockup: lights; modifiers, grip and stands; camera and
 * movement, with video and sound (the village is the camera department's).
 */
export type KitGroup = 'lights' | 'grip' | 'camera';
export const KIT_GROUPS: readonly KitGroup[] = ['lights', 'grip', 'camera'];

/** A line of the kit: a type with its spec, how many, its section and a light's watts each. */
export interface KitLine {
  /**
   * What the line is, the same in every language: the kind and the spec that tells lines apart
   * (power or length). Two lines that read the same in a language stay two lines.
   */
  key: string;
  name: string;
  count: number;
  group: KitGroup;
  watts?: number;
}

/**
 * The kit a plan needs (#335 round 6, i; decisions 0104 and 0117), "Fresnel 2K ×1", "Track 3 m
 * ×1": its icons of kit categories (lights, modifiers and grip, stands, power, camera and
 * movement, video and sound) counted by type and power or length; the modifiers on a light as
 * one line ("Softbox, grid ×1"); the gels written on lights as one line counting them all ("Gel:
 * 216, CTO full ×2"); then the stands and supports named on lights and cameras that stand on no
 * icon, in the order they first appear. People, furniture, hidden layers and
 * the sources that are no kit (the sun, a fire…, `isKitLight`) are left out.
 */
export function kitList(
  plan: {
    icons?: readonly PlanIcon[] | undefined;
    hiddenLayers?: readonly string[] | undefined;
    scale?: number | undefined;
  },
  t: Words,
  locale: string,
): KitLine[] {
  // Lines are counted by what they are (decision 0116), never by how a language writes them.
  const counts = new Map<string, KitLine>();
  const add = (key: string, name: string, group: KitGroup, watts?: number) => {
    const line = counts.get(key);
    if (line) line.count += 1;
    else counts.set(key, { key, name, count: 1, group, ...(watts ? { watts } : {}) });
  };
  const icons = (plan.icons ?? []).filter((i) => !plan.hiddenLayers?.includes(layerOf(i)));
  const ids = new Set(icons.map((i) => i.id));
  const byId = new Map(icons.map((i) => [i.id, i]));
  /** A modifier on a light of the plan: a part of its light's line. */
  const onLight = (icon: PlanIcon) => {
    const light = icon.on ? byId.get(icon.on) : undefined;
    return attachRole(icon.kind) === 'modifier' && !!light && isLight(light.kind);
  };
  for (const icon of icons) {
    if (!KIT.has(categoryOf(icon.kind).id) || NOT_KIT.has(icon.kind) || onLight(icon)) continue;
    // The sun, the moon, a fire… are in the legend, not kit to bring.
    if (isLight(icon.kind) && !isKitLight(icon.kind)) continue;
    // Type and spec, as the mockup: the power of a light, the length of a track or a frame.
    const power = icon.power || (icon.watts ? wattsText(icon.watts, locale) : '');
    const metres =
      !power && plan.scale && isSized(icon.kind)
        ? Math.round((Math.max(...Object.values(iconSize(icon))) / plan.scale) * 10) / 10
        : 0;
    const size = metres ? `${metres.toLocaleString(locale, { maximumFractionDigits: 1 })} m` : '';
    const category = categoryOf(icon.kind).id;
    // The spec in the key as written in English: "1K" typed and 1000 W are one line.
    const spec = icon.power || (icon.watts ? wattsText(icon.watts, 'en') : '');
    add(
      `icon:${icon.kind}:${spec}:${metres || ''}`,
      [t(`board.plan.icons.${icon.kind}`), power, size].filter(Boolean).join(' '),
      category === 'av' ? 'camera' : (category as KitGroup),
      isLight(icon.kind) ? iconWatts(icon) : undefined,
    );
  }
  // The modifiers of each light on one line, as they are rigged together.
  for (const icon of icons) {
    if (!isLight(icon.kind)) continue;
    const mods = modifiersOn(icon, icons).map((m) => m.kind);
    if (mods.length)
      add(
        `modifiers:${mods.join(',')}`,
        mods.map((m) => t(`board.plan.icons.${m}`)).join(', '),
        'grip',
      );
  }
  // Every gel on one line: the colours to bring, and how many sheets.
  const gels = icons.flatMap((i) => (i.gel ? [i.gel] : []));
  if (gels.length) {
    const name = `${t('board.plan.icons.gel')}: ${[...new Set(gels)].join(', ')}`;
    counts.set('gels', { key: 'gels', name, count: gels.length, group: 'grip' });
  }
  for (const icon of icons) {
    // A stand or a support named on the item, when it stands on no icon of the plan.
    const holder = icon.stand ?? icon.support;
    if (holder && STAND_KIT.has(holder) && !(icon.on && ids.has(icon.on)))
      // The same line as an icon of that kind standing on its own.
      add(`icon:${holder}::`, t(`board.plan.icons.${holder}`), icon.support ? 'camera' : 'grip');
  }
  return [...counts.values()];
}

/**
 * The counts of the card on the board (decision 0111): cameras, and the lights with the watts
 * they draw, by the rule of the kit and the power: a sun, a moon, a fire… are no light to bring
 * (decision 0115). Modifiers on a light and hidden layers are not counted.
 */
export function planCounts(
  plan: Pick<PlanElement, 'icons' | 'hiddenLayers' | 'circuits' | 'voltage'>,
) {
  const icons = (plan.icons ?? []).filter((i) => !plan.hiddenLayers?.includes(layerOf(i)));
  return {
    cameras: icons.filter((i) => catalogueKind(i.kind) === 'camera').length,
    lights: icons.filter((i) => isKitLight(i.kind) && !i.on).length,
    watts: planPower(plan).watts,
  };
}

/** The power of a plan as the outputs print it (decision 0104): a total and a line per circuit. */
export interface PowerLines {
  /** "Power at 230 V". */
  title: string;
  /** "2.5 kW · 10.8 A". */
  total: string;
  /** "Circuit A · 16 A: Fresnel, LED COB" and "8.7 A". */
  rows: Array<{ text: string; amps: string; status: CircuitStatus }>;
}

/**
 * "Key, Hair, Practical ×3": names in order, each repeated one once with how many. Items are the
 * same when their `key` is, however they read (decision 0116).
 */
export function foldNames(items: readonly { key: string; name: string }[]): string {
  const counts = new Map<string, { name: string; count: number }>();
  for (const { key, name } of items) {
    const known = counts.get(key);
    if (known) known.count += 1;
    else counts.set(key, { name, count: 1 });
  }
  return [...counts.values()]
    .map(({ name, count }) => (count > 1 ? `${name} ×${count}` : name))
    .join(', ');
}

/**
 * The lights of a circuit as the Kit tab and the outputs write them, "Key, Hair, Practical ×3":
 * named lights by their name, the others by their kind.
 */
export function circuitNames(
  lights: readonly string[],
  icons: readonly PlanIcon[],
  t: Words,
): string {
  const byId = new Map(icons.map((i) => [i.id, i]));
  return foldNames(
    lights
      .map((id) => byId.get(id))
      .filter((i): i is PlanIcon => !!i)
      .map((i) => ({ key: i.label ? `label:${i.label}` : `kind:${i.kind}`, name: itemName(i, t) }))
      .filter((i) => i.name),
  );
}

/**
 * The power per circuit of a plan for the call sheet, the scene sheets, the PDF sheet and the
 * read-only view: computed from the lights every time, never stored. Null without lights that
 * draw power.
 */
export function powerLines(
  plan: Pick<PlanElement, 'icons' | 'hiddenLayers' | 'circuits' | 'voltage'>,
  t: Words,
  locale?: string,
): PowerLines | null {
  const power = planPower(plan);
  if (power.watts <= 0) return null;
  const n = (v: number, digits: number) =>
    v.toLocaleString(locale, { maximumFractionDigits: digits });
  const watts = power.watts >= 1000 ? `${n(power.watts / 1000, 1)} kW` : `${n(power.watts, 0)} W`;
  return {
    title: t('board.plan.powerAt', { volts: power.voltage }),
    total: `${watts} · ${n(power.amps, 1)} A`,
    // Lights that draw nothing and are on no circuit (a sun, a moon) say nothing about power.
    rows: power.circuits
      .filter((c) => c.breaker !== null || c.watts > 0)
      .map((c) => {
        // "Key, Hair, Practical ×3", as the Kit tab writes a circuit.
        const names = circuitNames(c.lights, plan.icons ?? [], t);
        const head =
          c.breaker !== null
            ? t('board.plan.links.circuitLine', { name: c.name, amps: n(c.breaker, 1) })
            : t('board.plan.noCircuit');
        return {
          text: names ? `${head}: ${names}` : head,
          amps: `${n(c.amps, 1)} A`,
          status: c.status,
        };
      }),
  };
}

/** "2.5 kW · 10.8 A": a power and the amperes it draws, in the way of this language. */
export function powerText(watts: number, amps: number, lang: string): string {
  const kw = watts >= 1000;
  const n = (v: number, d: number) => v.toLocaleString(lang, { maximumFractionDigits: d });
  return `${kw ? `${n(watts / 1000, 1)} kW` : `${n(watts, 0)} W`} · ${n(amps, 1)} A`;
}

/** The kit of a setup as it is shown and counted: the setup over its base's Set. */
export function setupKit(plan: PlanElement, base: PlanElement | undefined, t: Words, lang: string) {
  const merged = base ? variantView(plan, base) : plan;
  return kitList(merged, t, lang);
}

/**
 * How many items all the setups of a plan need together (decision 0117): per kit line, the most
 * any one setup needs, since the same lamp moves from setup to setup.
 */
export function familyKitCount(family: readonly PlanElement[], t: Words, lang: string): number {
  const most = new Map<string, number>();
  for (const p of family) {
    const base = p.variantOf ? family.find((f) => f.id === p.variantOf) : undefined;
    for (const l of setupKit(p, base, t, lang))
      most.set(l.key, Math.max(most.get(l.key) ?? 0, l.count));
  }
  return [...most.values()].reduce((n, c) => n + c, 0);
}
