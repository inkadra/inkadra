// SPDX-License-Identifier: MPL-2.0
import { type PlanIcon, STROKE_GRID } from '@inkadra/doc-schema';
import type { Point } from './geometry.ts';
import {
  iconCentre,
  iconTransform,
  normalizeRotation,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanItem,
  rotateItem,
  withAttached,
  withoutOn,
} from './plan.ts';
import {
  attachRole,
  canAttach,
  catalogueKind,
  glyphBox,
  iconGlyph,
  MODIFIER_RANK,
  SEAT_FACING,
  SEATS,
} from './plan-icons.ts';

/**
 * Icons that snap together (decision 0104): a modifier clips to the front of a light, a person
 * sits on a seat, a light or a camera stands on a support, a dolly runs on its track, a flag
 * hangs on a C-stand. An attached icon keeps `on`, the id of its base, and its own x, y and
 * rotation, which these functions keep where the base says: moving or turning the base takes
 * what is on it along, pulling an icon away detaches it. Pure functions over the plan's icons;
 * the editor writes what they return with updatePlanItems.
 */

/** How near (view units) a drop must land to a base's body to snap to it. */
export const SNAP_RADIUS = 24;
/** How far (view units) an attached icon is pulled from where it sits before it detaches. */
export const DETACH_DISTANCE = 40;

/** Base points other than the glyph's middle where what is mounted sits: the end of an arm. */
const MOUNT_POINT: Readonly<Partial<Record<PlanIcon['kind'], Point>>> = {
  boomarm: { x: 13, y: 0 },
  jib: { x: 11, y: 0 },
  techno: { x: 15, y: 0 },
  carrig: { x: 10.5, y: 0 },
};
/** The point of a flag that goes on the C-stand's post: the stand drawn in its glyph. */
const RIG_POINT: Readonly<Partial<Record<PlanIcon['kind'], Point>>> = {
  flag: { x: -9, y: 10 },
  floppy: { x: -9, y: 10 },
  net: { x: -9, y: 10 },
  cuco: { x: -9, y: 10 },
  cutter: { x: -8, y: 12 },
  dot: { x: -8, y: 13 },
  frame: { x: 0, y: 16 },
};

const toView = (p: { x: number; y: number }): Point => ({
  x: (p.x / STROKE_GRID) * PLAN_VIEW_W,
  y: (p.y / STROKE_GRID) * PLAN_VIEW_H,
});
const toGrid = (p: Point) => ({
  x: Math.round(Math.max(0, Math.min(STROKE_GRID, (p.x / PLAN_VIEW_W) * STROKE_GRID))),
  y: Math.round(Math.max(0, Math.min(STROKE_GRID, (p.y / PLAN_VIEW_H) * STROKE_GRID))),
});

function turn(p: Point, degrees: number): Point {
  const t = (degrees * Math.PI) / 180;
  return { x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) };
}

/** A glyph point of an icon, in view units. */
export function glyphPointOf(icon: PlanIcon, g: Point): Point {
  const t = iconTransform(icon);
  const q = turn({ x: (g.x - t.origin.x) * t.sx, y: (g.y - t.origin.y) * t.sy }, t.angle);
  return { x: t.centre.x + q.x, y: t.centre.y + q.y };
}

/** A view point in the glyph units of an icon: the inverse of glyphPointOf. */
export function glyphLocalOf(icon: PlanIcon, p: Point): Point {
  const t = iconTransform(icon);
  const q = turn({ x: p.x - t.centre.x, y: p.y - t.centre.y }, -t.angle);
  return { x: q.x / t.sx + t.origin.x, y: q.y / t.sy + t.origin.y };
}

/** An icon where attachedPlacement puts it. */
function applyPlace(
  icon: PlanIcon,
  place: Pick<PlanIcon, 'x' | 'y' | 'rotation' | 'pose'>,
): PlanIcon {
  const next: PlanIcon = { ...icon, x: place.x, y: place.y };
  if (place.rotation) next.rotation = place.rotation;
  else delete next.rotation;
  if (place.pose) next.pose = place.pose;
  return next;
}

/** The icon turned to `rotation` and moved so that its glyph point `g` lands on `at`. */
function placedWith(icon: PlanIcon, g: Point, at: Point, rotation: number): PlanIcon {
  const r = normalizeRotation(rotation);
  const turned = { ...icon, rotation: r };
  const t = iconTransform(turned);
  const off = turn({ x: (g.x - t.origin.x) * t.sx, y: (g.y - t.origin.y) * t.sy }, t.angle);
  const next: PlanIcon = { ...turned, ...toGrid({ x: at.x - off.x, y: at.y - off.y }) };
  if (r === 0) delete next.rotation;
  return next;
}

/** The glyph's front and back on its facing axis, in glyph units. */
function axis(icon: PlanIcon): { front: number; back: number } {
  const box = glyphBox(iconGlyph(icon));
  return { front: box.x + box.w, back: box.x };
}

/** The modifiers on a light, from the light outwards (MODIFIER_RANK, then the plan's order). */
export function modifiersOn(light: PlanIcon, icons: readonly PlanIcon[]): PlanIcon[] {
  return icons
    .map((icon, index) => ({ icon, index }))
    .filter(({ icon }) => icon.on === light.id && attachRole(icon.kind) === 'modifier')
    .sort(
      (a, b) =>
        (MODIFIER_RANK[catalogueKind(a.icon.kind)] ?? 9) -
          (MODIFIER_RANK[catalogueKind(b.icon.kind)] ?? 9) || a.index - b.index,
    )
    .map((e) => e.icon);
}

/** Where people sit on a seat, in its glyph units: along its long side, or rows in a vehicle. */
export function seatSlots(seat: PlanIcon): Point[] {
  const kind = catalogueKind(seat.kind);
  const n = SEATS[kind] ?? 0;
  const box = glyphBox(iconGlyph(seat));
  const at = (fx: number, fy: number) => ({ x: box.x + box.w * fx, y: box.y + box.h * fy });
  if (kind === 'car') return [at(0.6, 0.28), at(0.6, 0.72), at(0.32, 0.28), at(0.32, 0.72)];
  if (kind === 'truck') return [at(0.78, 0.3), at(0.78, 0.7)];
  if (kind === 'moto') return [at(0.5, 0.5), at(0.3, 0.5)];
  const alongX = box.w > box.h;
  return Array.from({ length: n }, (_, i) => {
    const f = (i + 0.5) / n;
    return alongX ? at(f, 0.5) : at(0.5, f);
  });
}

/**
 * Where `item` sits on `base`, given the other icons of the plan (other modifiers on the same
 * light stack in a row, other people take the other seats): its x, y and rotation, and for people
 * the pose the seat gives. The item's own rotation stays for what is mounted or rigged (a light on
 * a stand still aims anywhere). Null when it may not attach to that base.
 */
export function attachedPlacement(
  item: PlanIcon,
  base: PlanIcon,
  icons: readonly PlanIcon[],
): Pick<PlanIcon, 'x' | 'y' | 'rotation' | 'pose'> | null {
  if (!canAttach(item.kind, base.kind)) return null;
  const role = attachRole(item.kind);
  const kind = catalogueKind(base.kind);
  const pick = (icon: PlanIcon) => {
    const out: Pick<PlanIcon, 'x' | 'y' | 'rotation' | 'pose'> = { x: icon.x, y: icon.y };
    if (icon.rotation) out.rotation = icon.rotation;
    if (icon.pose) out.pose = icon.pose;
    return out;
  };
  if (role === 'modifier') {
    // Each sits at the front of the one before it, the first at the front of the light.
    const row = modifiersOn(base, icons).filter((m) => m.id !== item.id);
    const order = [...row];
    const at = order.findIndex(
      (m) =>
        (MODIFIER_RANK[catalogueKind(m.kind)] ?? 9) >
        (MODIFIER_RANK[catalogueKind(item.kind)] ?? 9),
    );
    order.splice(at < 0 ? order.length : at, 0, item);
    let front = glyphPointOf(base, { x: axis(base).front, y: 0 });
    const rotation = base.rotation ?? 0;
    for (const m of order) {
      const placed = placedWith(m, { x: axis(m).back, y: 0 }, front, rotation);
      if (m.id === item.id) return pick(placed);
      front = glyphPointOf(placed, { x: axis(placed).front, y: 0 });
    }
    return null;
  }
  if (role === 'seated') {
    const slots = seatSlots(base).map((g) => glyphPointOf(base, g));
    // Earlier people keep their seats; this one takes the free seat nearest to where it is.
    const taken = new Set<number>();
    const nearest = (p: Point) => {
      let best = -1;
      for (let i = 0; i < slots.length; i++) {
        if (taken.has(i)) continue;
        const s = slots[i] as Point;
        const b = slots[best] as Point | undefined;
        if (!b || Math.hypot(s.x - p.x, s.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y)) best = i;
      }
      return best;
    };
    for (const other of icons)
      if (other.id !== item.id && other.on === base.id && attachRole(other.kind) === 'seated')
        taken.add(nearest(iconCentre(other)));
    const slot = nearest(iconCentre(item));
    const where = slots[slot < 0 ? 0 : slot] as Point;
    const rotation = (base.rotation ?? 0) + (SEAT_FACING[kind] ?? 0);
    const placed = placedWith(item, { x: 0, y: 0 }, where, rotation);
    const pose = kind === 'bed' ? 'lying' : 'seated';
    const posed = ['actor', 'support', 'extra', 'stunt', 'child'].includes(item.kind);
    return { ...pick(placed), ...(posed ? { pose } : {}) };
  }
  if (role === 'mounted') {
    const at = glyphPointOf(base, MOUNT_POINT[kind] ?? { x: 0, y: 0 });
    return pick(placedWith(item, { x: 0, y: 0 }, at, item.rotation ?? 0));
  }
  if (role === 'rigged') {
    const at = glyphPointOf(base, { x: 0, y: 0 });
    const g = RIG_POINT[catalogueKind(item.kind)] ?? { x: 0, y: 0 };
    return pick(placedWith(item, g, at, item.rotation ?? 0));
  }
  if (role === 'dolly') {
    // Along the track only: the nearest point of its axis, turned along it.
    const local = glyphLocalOf(base, iconCentre(item));
    let g: Point;
    let along = 0;
    if (kind === 'curve') {
      // The middle of the two rails: a quarter circle round (14, 14) of radius 24.
      const c = { x: 14, y: 14 };
      let a = Math.atan2(local.y - c.y, local.x - c.x);
      if (a > 0) a = a > Math.PI / 2 ? Math.PI : -Math.PI / 2;
      a = Math.max(-Math.PI, Math.min(-Math.PI / 2, a));
      g = { x: c.x + 24 * Math.cos(a), y: c.y + 24 * Math.sin(a) };
      along = (a * 180) / Math.PI + 90;
    } else {
      const { front, back } = axis(base);
      g = { x: Math.max(back, Math.min(front, local.x)), y: 0 };
    }
    const rotation = (base.rotation ?? 0) + along;
    return pick(placedWith(item, { x: 0, y: 0 }, glyphPointOf(base, g), rotation));
  }
  return null;
}

/**
 * The base `item` snaps to when dropped at `at` (view units): the icon whose body is nearest,
 * within SNAP_RADIUS of it, that it may attach to; on a tie the one drawn on top (later in the
 * plan). Itself, what is attached to it and icons locked on their own (decision 0114) are never
 * targets. Null: it lands free.
 */
export function snapTarget(
  item: Pick<PlanIcon, 'kind'> & Partial<Pick<PlanIcon, 'id'>>,
  at: Point,
  icons: readonly PlanIcon[],
  radius = SNAP_RADIUS,
): PlanIcon | null {
  const own = item.id ? withAttached(icons, [item.id]) : new Set<string>();
  let best: PlanIcon | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const icon of icons) {
    if (own.has(icon.id) || icon.locked || !canAttach(item.kind, icon.kind)) continue;
    const local = glyphLocalOf(icon, at);
    const box = glyphBox(iconGlyph(icon));
    const t = iconTransform(icon);
    // Distance from the body's box, in view units.
    const dx = Math.max(box.x - local.x, 0, local.x - (box.x + box.w)) * t.sx;
    const dy = Math.max(box.y - local.y, 0, local.y - (box.y + box.h)) * t.sy;
    const d = Math.hypot(dx, dy);
    if (d <= radius && d <= bestDistance) {
      best = icon;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * The icons to write when `itemId` attaches to `baseId`: the item placed on it with `on` set,
 * and the other modifiers or people on that base placed again. Empty when it may not attach.
 */
export function attachIcon(icons: readonly PlanIcon[], itemId: string, baseId: string): PlanIcon[] {
  const item = icons.find((i) => i.id === itemId);
  const base = icons.find((i) => i.id === baseId);
  if (!item || !base || withAttached(icons, [itemId]).has(baseId)) return [];
  const attached = { ...item, on: baseId };
  const place = attachedPlacement(attached, base, icons);
  if (!place) return [];
  const placed = applyPlace(attached, place);
  const changed = new Map(
    settleAttached(
      icons.map((i) => (i.id === itemId ? placed : i)),
      baseId,
    ).map((i) => [i.id, i]),
  );
  if (!changed.has(itemId)) changed.set(itemId, placed);
  return [...changed.values()];
}

/** The item standing free where it is: `on` dropped. Empty when it was not attached. */
export function detachIcon(icons: readonly PlanIcon[], itemId: string): PlanIcon[] {
  const item = icons.find((i) => i.id === itemId);
  if (!item?.on) return [];
  const { on: _on, ...free } = item;
  const base = icons.find((i) => i.id === item.on);
  // The rest of the row closes up behind it.
  const rest = base
    ? settleAttached(
        icons.map((i) => (i.id === itemId ? free : i)),
        base.id,
      )
    : [];
  return [free, ...rest.filter((i) => i.id !== itemId)];
}

/** True when an attached icon dragged to `at` (view units) is pulled away from where it sits. */
export function pulledAway(item: PlanIcon, at: Point, icons: readonly PlanIcon[]): boolean {
  const base = item.on ? icons.find((i) => i.id === item.on) : undefined;
  if (!base) return false;
  const place = attachedPlacement(item, base, icons);
  if (!place) return true;
  const sits = toView(place);
  return Math.hypot(at.x - sits.x, at.y - sits.y) > DETACH_DISTANCE;
}

/**
 * What is attached to `baseId` (and to what is on it) placed again where the base says, after
 * the base was moved, turned or resized. Returns the icons that changed.
 */
export function settleAttached(icons: readonly PlanIcon[], baseId: string): PlanIcon[] {
  const byId = new Map(icons.map((i) => [i.id, i]));
  const changed = new Map<string, PlanIcon>();
  const visit = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    const base = byId.get(id);
    if (!base) return;
    const list = [...byId.values()];
    for (const child of list) {
      if (child.on !== id) continue;
      const place = attachedPlacement(child, base, [...byId.values()]);
      if (!place) continue;
      const next = applyPlace(child, place);
      if (next.x !== child.x || next.y !== child.y || next.rotation !== child.rotation) {
        byId.set(child.id, next);
        changed.set(child.id, next);
      }
      visit(child.id, seen);
    }
  };
  visit(baseId, new Set());
  return [...changed.values()];
}

/**
 * Icons moved by `d` view units with everything attached to them (decision 0104). An attached
 * icon moved without its base is not moved here: the editor detaches it first (pulledAway).
 * Returns the icons that changed.
 */
export function moveWithAttached(
  icons: readonly PlanIcon[],
  ids: Iterable<string>,
  d: Point,
): PlanIcon[] {
  const all = withAttached(icons, ids);
  const gx = (d.x / PLAN_VIEW_W) * STROKE_GRID;
  const gy = (d.y / PLAN_VIEW_H) * STROKE_GRID;
  const clamp = (n: number) => Math.round(Math.max(0, Math.min(STROKE_GRID, n)));
  return icons
    .filter((i) => all.has(i.id))
    .map((i) => ({ ...i, x: clamp(i.x + gx), y: clamp(i.y + gy) }));
}

/**
 * An icon turned by `degrees` around its centre, with everything attached to it turning round
 * the same centre as one piece. Returns the icons that changed.
 */
export function rotateWithAttached(
  icons: readonly PlanIcon[],
  id: string,
  degrees: number,
): PlanIcon[] {
  const base = icons.find((i) => i.id === id);
  if (!base) return [];
  const pivot = iconCentre(base);
  const all = withAttached(icons, [id]);
  return icons
    .filter((i) => all.has(i.id))
    .map((i) => {
      const c = iconCentre(i);
      const q = turn({ x: c.x - pivot.x, y: c.y - pivot.y }, degrees);
      const rotation = normalizeRotation((i.rotation ?? 0) + degrees);
      const next: PlanIcon = {
        ...i,
        ...toGrid({ x: pivot.x + q.x, y: pivot.y + q.y }),
        rotation,
      };
      if (rotation === 0) delete next.rotation;
      return next;
    });
}

const isIconItem = (item: PlanItem): item is PlanIcon => 'x' in item;

/**
 * Several items turned by `degrees` round `centre` as one piece, with every icon attached to the
 * icons among them (decision 0104), as moveWithAttached carries them. Returns what changed.
 */
export function rotateManyWithAttached(
  icons: readonly PlanIcon[],
  items: readonly PlanItem[],
  degrees: number,
  centre: Point,
): PlanItem[] {
  const ids = new Set(items.map((i) => i.id));
  const carried = withAttached(
    icons,
    items.filter(isIconItem).map((i) => i.id),
  );
  const extra = icons.filter((i) => carried.has(i.id) && !ids.has(i.id));
  return [...items, ...extra].map((i) => rotateItem(i, degrees, centre));
}

/**
 * What a write of `items` stores, by the attachment rules (decision 0104), whatever made it (a
 * drag, a handle, a field of Properties, a key): an `on` whose base is gone is dropped, and what
 * sits on a written base is placed again where the base now says. `icons` are the plan's icons
 * as drawn (a setup's with its base's Set). Items written explicitly keep what they say.
 */
export function settleWrite(icons: readonly PlanIcon[], items: readonly PlanItem[]): PlanItem[] {
  const out = new Map<string, PlanItem>(items.map((i) => [i.id, i]));
  const present = new Set(icons.map((i) => i.id));
  for (const item of items)
    if (isIconItem(item) && item.on && !present.has(item.on)) out.set(item.id, withoutOn(item));
  let all = icons.map((i) => (out.get(i.id) as PlanIcon | undefined) ?? i);
  for (const item of items) {
    if (!isIconItem(item) || !all.some((i) => i.on === item.id)) continue;
    const moved = settleAttached(all, item.id).filter((i) => !items.some((n) => n.id === i.id));
    for (const m of moved) out.set(m.id, m);
    all = all.map((i) => moved.find((m) => m.id === i.id) ?? i);
  }
  return [...out.values()];
}
