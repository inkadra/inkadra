// SPDX-License-Identifier: MPL-2.0
import type { Element, PlanIcon } from '@inkadra/doc-schema';
import type { PlanElement } from './plan.ts';

/**
 * Links of a set plan to the cards of the project (decision 0104): a plan stores the id of the
 * card that holds a value and shows the value live, never a copy that could go stale. These
 * helpers resolve the links against the cards the caller can see (of this board or another,
 * already cut to what a guest may see); a link whose card is gone falls back to the text the item
 * still holds.
 */

type Card<T extends Element['type']> = Extract<Element, { type: T }>;
/** Cards by id, of every board the plan may link to. */
export type CardsById = ReadonlyMap<string, Element>;

const card = <T extends Element['type']>(cards: CardsById, id: string | undefined, type: T) => {
  const found = id ? cards.get(id) : undefined;
  return found?.type === type ? (found as Card<T>) : undefined;
};

/**
 * The focal length in a frame's lens field: the one number of millimetres in it, with words
 * around it or not ("35mm", "35 mm", "anamorphic 50", "Cooke 32"). Null for none, for a zoom
 * ("24-70mm") or for several numbers, which name no single focal length. Numbers glued to letters
 * ("S4", "2x") or behind f/ and T are not focal lengths.
 */
export function lensMillimetres(lens: string | undefined): number | null {
  const text = lens ?? '';
  if (/\d\s*[-–—/]\s*\d/.test(text.replace(/\b[ft]\s*\/?\s*\d+(?:[.,]\d+)?/gi, ''))) return null;
  const numbers = [...text.matchAll(/(?<![\w.,/])(\d+(?:[.,]\d+)?)(?:\s*mm)?(?![\w.,])/gi)].map(
    (m) => Number((m[1] as string).replace(',', '.')),
  );
  if (numbers.length !== 1) return null;
  const mm = numbers[0] as number;
  return mm >= 4 && mm <= 2000 ? Math.round(mm) : null;
}

/**
 * The label of an icon: the name of the character an actor plays while the card is there, else
 * the icon's own label (what was last typed or shown).
 */
export function linkedLabel(
  icon: Pick<PlanIcon, 'label' | 'characterId'>,
  cards: CardsById,
): string | undefined {
  return card(cards, icon.characterId, 'character')?.name || icon.label;
}

/** What an actor shows of the character it plays: name, picture and who plays it. */
export function linkedCharacter(
  icon: Pick<PlanIcon, 'characterId'>,
  cards: CardsById,
): { id: string; name: string; assetId?: string; actor?: string } | null {
  const c = card(cards, icon.characterId, 'character');
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    ...(c.assetId ? { assetId: c.assetId } : {}),
    ...(c.actor ? { actor: c.actor } : {}),
  };
}

/**
 * What a camera shows of the frame it shoots: the shot's label (from `labels`, the storyboard's
 * numbering, else the frame's own), its lens parsed to millimetres, its shot size and movement.
 * The camera's own `lens` wins on the plan; nothing is written back to the frame.
 */
export function linkedShot(
  icon: Pick<PlanIcon, 'frameId' | 'lens'>,
  cards: CardsById,
  labels?: ReadonlyMap<string, string>,
): {
  id: string;
  label?: string;
  frameLens: number | null;
  lens: number | null;
  shot?: string;
  movement?: string;
} | null {
  const f = card(cards, icon.frameId, 'frame');
  if (!f) return null;
  const label = labels?.get(f.id) ?? f.label;
  const frameLens = lensMillimetres(f.lens);
  return {
    id: f.id,
    ...(label ? { label } : {}),
    frameLens,
    lens: icon.lens ?? frameLens,
    ...(f.shot ? { shot: f.shot } : {}),
    ...(f.movement ? { movement: f.movement } : {}),
  };
}

/** The header of a plan: the scenes it serves that are still there, in its order. */
export function linkedScenes(
  plan: Pick<PlanElement, 'sceneIds'>,
  cards: CardsById,
): Array<Pick<Card<'scene'>, 'id' | 'number' | 'title' | 'setting' | 'time'>> {
  return (plan.sceneIds ?? []).flatMap((id) => {
    const s = card(cards, id, 'scene');
    if (!s) return [];
    return [
      {
        id: s.id,
        number: s.number,
        title: s.title,
        ...(s.setting ? { setting: s.setting } : {}),
        ...(s.time ? { time: s.time } : {}),
      },
    ];
  });
}

/** The location a plan is set in: name, setting, address and light notes. */
export function linkedLocation(
  plan: Pick<PlanElement, 'locationId'>,
  cards: CardsById,
): Pick<Card<'location'>, 'id' | 'name' | 'setting' | 'address' | 'light'> | null {
  const l = card(cards, plan.locationId, 'location');
  if (!l) return null;
  return {
    id: l.id,
    name: l.name,
    ...(l.setting ? { setting: l.setting } : {}),
    ...(l.address ? { address: l.address } : {}),
    ...(l.light ? { light: l.light } : {}),
  };
}

/**
 * The frames a setup's cameras shoot, in the plan's order, each once: the setup's shots. A frame
 * of a scene the script left out (decision 0082) is no shot to make, and is left out too.
 */
export function setupFrames(plan: Pick<PlanElement, 'icons'>, cards: CardsById): string[] {
  const out: string[] = [];
  for (const icon of plan.icons ?? []) {
    const frame = card(cards, icon.frameId, 'frame');
    if (!frame || out.includes(frame.id)) continue;
    if (card(cards, frame.parent ?? undefined, 'scene')?.omitted) continue;
    out.push(frame.id);
  }
  return out;
}

/**
 * A link whose card is going: the text the item keeps, so it still reads the same once the card
 * is deleted (decision 0104). An actor keeps the character's name as its label.
 */
export function unlinkCharacter(icon: PlanIcon, cards: CardsById): PlanIcon {
  if (!icon.characterId) return icon;
  const { characterId: _gone, ...rest } = icon;
  const name = card(cards, icon.characterId, 'character')?.name;
  return name ? { ...rest, label: name.slice(0, 60) } : rest;
}

/** Character cards in a stable order, oldest first: the order their colours follow. */
function characterOrder(cards: CardsById): string[] {
  return [...cards.values()]
    .filter((c) => c.type === 'character')
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    .map((c) => c.id);
}

/**
 * A plan as it is drawn and listed, its links resolved (decision 0104): an actor shows the
 * name of the character it plays and, given a `palette`, that character's colour (one per
 * character, in the order of the character cards, so it is the same on every plan); a camera
 * without a lens of its own takes the one its frame names. Nothing here is ever written back:
 * edits start from the stored plan. Icons without a live link are kept as they are.
 */
export function linkedPlan<P extends Pick<PlanElement, 'icons'>>(
  plan: P,
  cards: CardsById,
  opts: { palette?: readonly string[] } = {},
): P {
  if (!plan.icons?.some((i) => i.characterId || i.frameId)) return plan;
  let order: string[] | null = null;
  const icons = plan.icons.map((icon) => {
    let next = icon;
    const c = card(cards, icon.characterId, 'character');
    if (c) {
      next = { ...next, label: c.name.slice(0, 60) };
      if (opts.palette?.length) {
        order ??= characterOrder(cards);
        next.color = opts.palette[order.indexOf(c.id) % opts.palette.length] as string;
      }
    }
    const f = icon.lens === undefined ? card(cards, icon.frameId, 'frame') : undefined;
    const mm = f ? lensMillimetres(f.lens) : null;
    if (mm) next = { ...next, lens: mm };
    return next;
  });
  return { ...plan, icons };
}

/**
 * What the icons of a plan keep when cards they link to are deleted (decision 0104): an actor
 * the character's name as its label, a camera without a lens of its own the frame's lens. The
 * changed icons only, by id; the caller writes them with the deletion, in one undo step.
 */
export function keptOnDelete(
  plan: Pick<PlanElement, 'icons'>,
  doomed: ReadonlySet<string>,
  cards: CardsById,
): PlanIcon[] {
  return (plan.icons ?? []).flatMap((icon) => {
    const character = icon.characterId && doomed.has(icon.characterId);
    const frame = icon.frameId && doomed.has(icon.frameId);
    if (!character && !frame) return [];
    let next = character ? unlinkCharacter(icon, cards) : icon;
    if (frame) {
      const { frameId: _gone, ...rest } = next;
      const mm = lensMillimetres(card(cards, icon.frameId, 'frame')?.lens);
      next = rest.lens === undefined && mm ? { ...rest, lens: mm } : rest;
    }
    return [next];
  });
}
