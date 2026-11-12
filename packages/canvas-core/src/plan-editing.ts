// SPDX-License-Identifier: MPL-2.0
import {
  MAX_PLAN_ICONS,
  type PlanIcon,
  type PlanIconKind,
  type PlanLayer,
} from '@inkadra/doc-schema';
import type * as Y from 'yjs';
import { updateElement } from './board.ts';
import type { Point } from './geometry.ts';
import {
  addPlanIcon,
  allowedWrites,
  defaultIconSize,
  defaultLayer,
  itemLocked,
  itemsBox,
  itemTier,
  layerOf,
  measureEnds,
  moveItem,
  type PlanElement,
  type PlanGroupName,
  type PlanItem,
  planGroupOf,
  planItems,
  removePlanItems,
  rotateItem,
  toPlanGrid,
  transferPlanItems,
  updatePlanItems,
  variantView,
  withAttached,
} from './plan.ts';
import {
  attachIcon,
  detachIcon,
  moveWithAttached,
  rotateManyWithAttached,
  rotateWithAttached,
  settleWrite,
  snapTarget,
} from './plan-attach.ts';
import { attachRole, kindLayer, NOMINAL_SCALE } from './plan-icons.ts';
import { removePlanWalls } from './plan-walls.ts';

/**
 * The editing operations of a set plan (decision 0104), shared by every client that edits one
 * (decision 0116): what a selection, a move, a turn, a lock, a layer and a placed icon write.
 * The editor keeps its own state (tool, selection, preview, undo steps); these say what goes into
 * the document. Writers take the document and an origin, as the other canvas-core writers do;
 * functions named `…Writes` only compute the items to pass to writePlanItems.
 */

const isIcon = (item: PlanItem | null | undefined): item is PlanIcon => !!item && 'x' in item;

/** A plan being edited: a base, or a setup with its base, whose Set layer it shows and edits. */
export interface PlanEdit {
  plan: PlanElement;
  base: PlanElement | undefined;
  /** What is drawn and what writes start from: a setup with its base's Set layer under its own,
   *  measures drawn where their icons stand. */
  drawn: PlanElement;
  /** What the base holds, not what is drawn on Set: an item of the setup stranded on Set is the
   *  setup's (variantView shows it), and moving it to Set again moves it into the base. */
  baseIds: ReadonlySet<string>;
}

export function planEdit(plan: PlanElement, base?: PlanElement): PlanEdit {
  const merged = base ? variantView(plan, base) : plan;
  return {
    plan,
    base,
    drawn: { ...merged, shapes: merged.shapes?.map((sh) => measureEnds(sh, merged.icons)) },
    baseIds: new Set(base ? planItems(base).map(({ item }) => item.id) : []),
  };
}

/** The plan an item is stored in: the base for what the base holds, else the plan edited. */
export function planItemOwner(edit: PlanEdit, id: string): string {
  return edit.base && edit.baseIds.has(id) ? edit.base.id : edit.plan.id;
}

/** The plan a new item of `layer` goes to: the Set layer is the base's, shared by its setups. */
export function planLayerOwner(edit: PlanEdit, layer: PlanLayer): string {
  return edit.base && layer === 'set' ? edit.base.id : edit.plan.id;
}

/** Icons placed in the same change, not drawn yet, and the plan each went to. */
export interface PlacedIcons {
  icons: readonly PlanIcon[];
  owners: ReadonlyMap<string, string>;
}

/**
 * Writes items where they live: the base's Set layer, or the plan. Only what differs from
 * `baseline` is written (for a gesture, the items as they were when it started), so another
 * person's edit of another field made meanwhile stays. The locks hold first (decision 0114), then
 * the attachment rules (decision 0104): an `on` whose base is gone is dropped, and what sits on a
 * written base is placed again.
 */
export function writePlanItems(
  doc: Y.Doc,
  edit: PlanEdit,
  written: readonly PlanItem[],
  origin?: unknown,
  baseline?: readonly PlanItem[],
  placed: PlacedIcons = { icons: [], owners: new Map() },
): void {
  const all = planItems(edit.drawn);
  // The locks first: what settles below follows only the writes that happen.
  const allowed = allowedWrites(
    all.map((e) => e.item),
    written,
  );
  const items = settleWrite([...(edit.drawn.icons ?? []), ...placed.icons], allowed);
  const before = baseline ?? items.flatMap((i) => all.find((e) => e.item.id === i.id)?.item ?? []);
  const owner = (id: string) => placed.owners.get(id) ?? planItemOwner(edit, id);
  const own = items.filter((i) => owner(i.id) === edit.plan.id);
  const shared = items.filter((i) => owner(i.id) !== edit.plan.id);
  if (own.length) updatePlanItems(doc, edit.plan.id, own, origin, before);
  if (shared.length && edit.base) updatePlanItems(doc, edit.base.id, shared, origin, before);
}

/**
 * Removes items from the plan and its base, with what is attached to them. Items locked on their
 * own stay (decision 0114). One transaction. Returns the ids it removed, to unpick them.
 */
export function removeUnlockedItems(
  doc: Y.Doc,
  edit: PlanEdit,
  ids: readonly string[],
  origin?: unknown,
): string[] {
  const kept = new Set(
    planItems(edit.drawn).flatMap((e) => (itemLocked(e.item) ? [e.item.id] : [])),
  );
  const gone = ids.filter((id) => !kept.has(id));
  if (!gone.length) return [];
  doc.transact(() => {
    removePlanItems(doc, edit.plan.id, gone, origin);
    if (edit.base) removePlanItems(doc, edit.base.id, gone, origin);
  }, origin);
  return gone;
}

/**
 * Removes walls and openings, from the Set layer (the base's, for a setup). Those locked on their
 * own stay (decision 0114). Returns the ids it removed, to unpick them.
 */
export function removeUnlockedWalls(
  doc: Y.Doc,
  edit: PlanEdit,
  ids: readonly string[],
  origin?: unknown,
): string[] {
  const locked = new Set(
    [...(edit.drawn.walls ?? []), ...(edit.drawn.openings ?? [])].flatMap((w) =>
      itemLocked(w) ? [w.id] : [],
    ),
  );
  const gone = ids.filter((id) => !locked.has(id));
  if (gone.length) removePlanWalls(doc, planLayerOwner(edit, 'set'), gone, origin);
  return gone;
}

/**
 * The items locked on their own, or unlocked (decision 0114): locked when one of them is not yet.
 * The only write a locked item takes, besides its base's moves.
 */
export function lockWrites(items: readonly PlanItem[]): PlanItem[] {
  const lock = !items.every(itemLocked);
  return items.map((i) => ({ ...i, locked: lock ? true : undefined }) as PlanItem);
}

/**
 * The items turned by `degrees`. Several turn round the middle of their box as one piece, a base
 * turns what is on it (decision 0104), any other item turns on its own.
 */
export function rotateWrites(edit: PlanEdit, items: readonly PlanItem[], degrees: number) {
  const icons = edit.drawn.icons ?? [];
  if (items.length > 1) {
    const b = itemsBox(items);
    return rotateManyWithAttached(icons, items, degrees, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  }
  const [item] = items;
  if (isIcon(item) && withAttached(icons, [item.id]).size > 1)
    return rotateWithAttached(icons, item.id, degrees);
  return item ? [rotateItem(item, degrees)] : [];
}

/** The items moved by `d` (view units), with what is attached to the icons among them. */
export function nudgeWrites(edit: PlanEdit, items: readonly PlanItem[], d: Point): PlanItem[] {
  const carried = moveWithAttached(
    edit.drawn.icons ?? [],
    items.filter(isIcon).map((i) => i.id),
    d,
  );
  return [...items.filter((i) => !isIcon(i)).map((i) => moveItem(i, d)), ...carried];
}

/** Bring forward (+1) and Send back (-1): the stacking tier of the icons among the items, 0 to 5. */
export function restackWrites(items: readonly PlanItem[], by: 1 | -1): PlanIcon[] {
  return items
    .filter(isIcon)
    .map((i) => ({ ...i, tier: Math.max(0, Math.min(5, Number(itemTier(i)) + by)) }) as PlanIcon);
}

/**
 * Moves the items of the plan edited (not its base's) to a layer. On a setup, Set is the base's,
 * shared by every setup (decisions 0062, 0104): what goes there moves into the base in one
 * transaction, so a setup never keeps items of its own on Set.
 */
export function moveToPlanLayer(
  doc: Y.Doc,
  edit: PlanEdit,
  items: readonly PlanItem[],
  layer: PlanLayer,
  origin?: unknown,
): void {
  const own = items.filter((i) => planItemOwner(edit, i.id) === edit.plan.id);
  const onLayer = (i: PlanItem) => ({ layer: defaultLayer(i) === layer ? undefined : layer });
  if (edit.base && layer === 'set') {
    if (own.length)
      transferPlanItems(
        doc,
        edit.plan.id,
        edit.base.id,
        own.map((i) => i.id),
        onLayer,
        origin,
      );
    return;
  }
  writePlanItems(
    doc,
    edit,
    own.map((i) => ({ ...i, ...onLayer(i) }) as PlanItem),
    origin,
  );
}

/**
 * Who a layer or the Grip and crew group is hidden for. On a setup, a layer is hidden for
 * everyone and in its exports: `patch` is what to write on the plan. On a base, and Grip and crew
 * (no layer of the document) anywhere, it is this person's preference, which the client keeps
 * (decision 0114). `hidden` is what is hidden now, the document's and this person's.
 */
export function hiddenToggle(
  plan: Pick<PlanElement, 'variantOf' | 'hiddenLayers'>,
  hidden: ReadonlySet<PlanGroupName>,
  layer: PlanGroupName,
):
  | { for: 'plan'; patch: { hiddenLayers: PlanLayer[] | undefined } }
  | { for: 'person'; name: PlanGroupName } {
  if (!plan.variantOf || layer === 'grip') return { for: 'person', name: layer };
  const next = hidden.has(layer)
    ? (plan.hiddenLayers ?? []).filter((l) => l !== layer)
    : [...(plan.hiddenLayers ?? []), layer];
  return { for: 'plan', patch: { hiddenLayers: next.length ? next : undefined } };
}

/** What to write on the plan to lock or unlock a layer for everyone. */
export function lockedLayersToggle(
  plan: Pick<PlanElement, 'lockedLayers'>,
  layer: PlanLayer,
): { lockedLayers: PlanLayer[] | undefined } {
  const locked = plan.lockedLayers ?? [];
  const next = locked.includes(layer) ? locked.filter((l) => l !== layer) : [...locked, layer];
  return { lockedLayers: next.length ? next : undefined };
}

/**
 * A plan drawn in metres before it has a scale gets the nominal one with its first wall, in the
 * same change: what the walls tool showed in metres stays true (decision 0110). The scale is the
 * base's, for a setup.
 */
export function ensurePlanScale(doc: Y.Doc, edit: PlanEdit, origin?: unknown): void {
  if (!edit.drawn.scale)
    updateElement(
      doc,
      edit.base?.id ?? edit.plan.id,
      { scale: NOMINAL_SCALE, grid: '0.5' },
      origin,
    );
}

/** Whether the plan edited has no room for another icon. */
export const planIconsFull = (edit: PlanEdit): boolean =>
  (edit.plan.icons?.length ?? 0) >= MAX_PLAN_ICONS;

/** How a new icon is drawn: the layer being worked on (its kind's when none) and its colour. */
export interface FreshIconStyle {
  layer?: PlanLayer | null | undefined;
  /** Its colour, by kind: the pen's colour, or the kind's family colour. */
  color: (kind: PlanIconKind) => string;
}

/**
 * A new icon of `kind` at `p` (0 to 1 of the drawing): on the grid, its real size at the plan's
 * scale, its colour, and the layer it goes on (stored only when not its kind's own).
 */
export function freshPlanIcon(
  edit: PlanEdit,
  kind: PlanIconKind,
  p: Point,
  style: FreshIconStyle,
): { layer: PlanLayer; icon: Omit<PlanIcon, 'id'> } {
  const layer = style.layer ?? kindLayer(kind);
  return {
    layer,
    icon: {
      kind,
      color: style.color(kind),
      x: toPlanGrid(p.x),
      y: toPlanGrid(p.y),
      ...defaultIconSize(kind, edit.drawn.scale),
      ...(layer !== kindLayer(kind) ? { layer } : {}),
    } as Omit<PlanIcon, 'id'>,
  };
}

/**
 * Places an icon at `p` (0 to 1 of the drawing), in the plan its layer belongs to. `on` attaches
 * it to that icon; `modifiers` are placed on its front, in order (a light of the project kit).
 * One transaction (decision 0104). Returns its id; null when the plan is full.
 */
export function placePlanIcon(
  doc: Y.Doc,
  edit: PlanEdit,
  kind: PlanIconKind,
  p: Point,
  opts: FreshIconStyle & {
    fields?: Partial<PlanIcon> | undefined;
    on?: string | null | undefined;
    modifiers?: readonly PlanIconKind[] | undefined;
  },
  origin?: unknown,
): string | null {
  if (planIconsFull(edit)) return null;
  const icons = edit.drawn.icons ?? [];
  let id: string | null = null;
  doc.transact(() => {
    const placed: { icons: PlanIcon[]; owners: Map<string, string> } = {
      icons: [],
      owners: new Map(),
    };
    const add = (k: PlanIconKind, fields?: Partial<PlanIcon>): PlanIcon | null => {
      const { layer, icon } = freshPlanIcon(edit, k, p, opts);
      const target = planLayerOwner(edit, layer);
      const newId = addPlanIcon(doc, target, { ...icon, ...fields }, origin);
      if (!newId) return null;
      const added = { ...icon, ...fields, id: newId } as PlanIcon;
      placed.icons.push(added);
      placed.owners.set(newId, target);
      return added;
    };
    /** Attaches against what is there now, the icons just placed included. */
    const attach = (itemId: string, baseId: string) => {
      const all = [...icons, ...placed.icons];
      const next = attachIcon(all, itemId, baseId);
      if (!next.length) return;
      writePlanItems(doc, edit, next, origin, all, placed);
      for (const n of next) {
        const at = placed.icons.findIndex((i) => i.id === n.id);
        if (at >= 0) placed.icons[at] = n;
      }
    };
    const main = add(kind, opts.fields);
    if (!main) return;
    id = main.id;
    if (opts.on) attach(main.id, opts.on);
    for (const m of opts.modifiers ?? []) {
      const mod = add(m);
      if (!mod) break;
      attach(mod.id, main.id);
    }
  }, origin);
  return id;
}

/**
 * The base an icon would attach to at `at` (view units), for every way of placing or dragging
 * one (decision 0104): never an icon on a layer or group in `hidden`, so nothing attaches to
 * something invisible. A locked layer's icons stay bases: a person may still sit on a locked
 * sofa, which itself does not move.
 */
export function planSnapAt(
  edit: PlanEdit,
  hidden: ReadonlySet<PlanGroupName>,
  item: Pick<PlanIcon, 'kind'> & Partial<Pick<PlanIcon, 'id'>>,
  at: Point,
): PlanIcon | null {
  return snapTarget(
    item,
    at,
    (edit.drawn.icons ?? []).filter((i) => !hidden.has(layerOf(i)) && !hidden.has(planGroupOf(i))),
  );
}

/**
 * The base an icon placed or dragged to `at` lands on: none when it goes free, that is with
 * snapping off (`attach`), Alt held (`alt`), or a kind that never attaches.
 */
export function planDropTarget(
  edit: PlanEdit,
  hidden: ReadonlySet<PlanGroupName>,
  item: Pick<PlanIcon, 'kind'> & Partial<Pick<PlanIcon, 'id'>>,
  at: Point,
  how: { attach: boolean; alt: boolean },
): PlanIcon | null {
  const free = !how.attach || how.alt || !attachRole(item.kind);
  return free ? null : planSnapAt(edit, hidden, item, at);
}

/** An icon dragged: whether it was pulled off its base, and the base it was let go on. */
export interface IconDrop {
  item: PlanIcon;
  pulled?: boolean | undefined;
  target?: string | null | undefined;
}

/**
 * What a gesture writes, with the snapping of decision 0104: `next` (the items as the gesture
 * left them), and for an icon dragged, detached when pulled off its base and attached when let go
 * on one. `icons` are the plan's icons as drawn. What sits on a written base settles in
 * writePlanItems, as for every write.
 */
export function dropWrites(
  icons: readonly PlanIcon[],
  drop: IconDrop | null,
  next: readonly PlanItem[],
): PlanItem[] {
  if (!drop) return [...next];
  const id = drop.item.id;
  const merge = (list: readonly PlanIcon[], by: readonly PlanItem[]) =>
    list.map((i) => (by.find((n) => n.id === i.id) as PlanIcon | undefined) ?? i);
  const out = new Map(next.map((i) => [i.id, i]));
  let all = merge(icons, next);
  const take = (changed: readonly PlanIcon[]) => {
    for (const i of changed) out.set(i.id, i);
    all = merge(all, changed);
  };
  if (drop.pulled) take(detachIcon(all, id));
  if (drop.target) take(attachIcon(all, id, drop.target));
  return [...out.values()];
}
