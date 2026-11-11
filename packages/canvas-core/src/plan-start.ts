// SPDX-License-Identifier: MPL-2.0
import type { PlanWall } from '@inkadra/doc-schema';
import type * as Y from 'yjs';
import type { Point } from './geometry.ts';
import {
  duplicatePlanItems,
  layerOf,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  type PlanItemRef,
  planItems,
} from './plan.ts';
import { NOMINAL_SCALE } from './plan-icons.ts';
import type { CardsById } from './plan-links.ts';
import { copyPlanWalls, DEFAULT_WALL_METRES, metresToView, toWallPoints } from './plan-walls.ts';

/**
 * Starting a set plan (decision 0110): the ready rooms of the start dialog, the plans whose Set
 * layer an empty plan may reuse, and where a background picture lies.
 */

export const ROOM_PRESETS = ['rect', 'l', 'u', 'studio', 'exterior'] as const;
export type RoomPreset = (typeof ROOM_PRESETS)[number];
/** Sizes a ready room may have, in metres. */
export const ROOM_MIN_METRES = 1;
export const ROOM_MAX_METRES = 200;
/** Share of the drawing a ready room may fill at most. */
const ROOM_FILL = 0.8;

/** The corners of a ready room `w` by `d` (0 to 1 of its width and depth), and if it closes. */
const SHAPES: Record<Exclude<RoomPreset, 'exterior'>, { corners: number[][]; closed: boolean }> = {
  rect: {
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    closed: true,
  },
  l: {
    corners: [
      [0, 0],
      [0.55, 0],
      [0.55, 0.5],
      [1, 0.5],
      [1, 1],
      [0, 1],
    ],
    closed: true,
  },
  u: {
    corners: [
      [0, 0],
      [0.3, 0],
      [0.3, 0.5],
      [0.7, 0.5],
      [0.7, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    closed: true,
  },
  // A studio set: three walls, the fourth side open to the camera.
  studio: {
    corners: [
      [0, 1],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    closed: false,
  },
};

/**
 * The scale a ready room `widthM` by `depthM` metres is drawn at: the plan's own, or, on a plan
 * without one, NOMINAL_SCALE made smaller until the room fills at most 80 % of the drawing.
 * Null when the plan's scale makes it too big for the drawing.
 */
export function roomScale(widthM: number, depthM: number, scale?: number): number | null {
  const fits = (s: number) =>
    widthM * s <= PLAN_VIEW_W * ROOM_FILL + 1e-6 && depthM * s <= PLAN_VIEW_H * ROOM_FILL + 1e-6;
  if (scale) return fits(scale) ? scale : null;
  const s = Math.min(
    NOMINAL_SCALE,
    (PLAN_VIEW_W * ROOM_FILL) / widthM,
    (PLAN_VIEW_H * ROOM_FILL) / depthM,
  );
  return Math.floor(s * 100) / 100;
}

/**
 * The walls of a ready room `widthM` by `depthM` metres at `scale` view units per metre, in the
 * middle of the drawing, 15 cm thick: a rectangle, an L, a U, three walls of a studio set, or
 * none for an exterior.
 */
export function roomWalls(
  preset: RoomPreset,
  widthM: number,
  depthM: number,
  scale: number,
): Array<Omit<PlanWall, 'id'>> {
  if (preset === 'exterior') return [];
  const { corners, closed } = SHAPES[preset];
  const w = widthM * scale;
  const d = depthM * scale;
  const left = (PLAN_VIEW_W - w) / 2;
  const top = (PLAN_VIEW_H - d) / 2;
  const points = toWallPoints(
    corners.map(([x, y]) => ({ x: left + (x as number) * w, y: top + (y as number) * d })),
  );
  return [
    {
      points,
      thickness: Math.round(metresToView(DEFAULT_WALL_METRES, scale) * 100) / 100,
      ...(closed ? { closed: true } : {}),
    },
  ];
}

// Reusing the set of another plan ---------------------------------------------------------

const key = (name: string | undefined) => name?.trim().toLocaleLowerCase() || null;

/**
 * The name of the place a plan is set in, to compare: its location card's, else the location
 * written on the first of its scenes that names one. Null for none.
 */
export function planPlace(plan: Pick<PlanElement, 'locationId' | 'sceneIds'>, cards: CardsById) {
  const location = plan.locationId ? cards.get(plan.locationId) : undefined;
  if (location?.type === 'location') return key(location.name);
  for (const id of plan.sceneIds ?? []) {
    const scene = cards.get(id);
    if (scene?.type === 'scene' && key(scene.location)) return key(scene.location);
  }
  return null;
}

/** True when the plan has something on its Set layer: walls or items of that layer. */
export function hasSet(plan: Pick<PlanElement, 'walls' | 'strokes' | 'shapes' | 'icons'>) {
  return (
    (plan.walls?.length ?? 0) > 0 || planItems(plan).some(({ item }) => layerOf(item) === 'set')
  );
}

/**
 * The plans whose Set layer `plan` may reuse (decision 0110): the other plans of the same
 * location, by the location card both link to, or by the place's name when one of them links to
 * none; never the plan's own setups or base, never a setup (its Set is its base's), only plans
 * with a Set to give. `plans` are the plans the person can read.
 */
export function setSources(
  plan: PlanElement,
  plans: readonly PlanElement[],
  cards: CardsById,
): PlanElement[] {
  const place = planPlace(plan, cards);
  return plans.filter((other) => {
    if (other.id === plan.id || other.variantOf || other.id === plan.variantOf) return false;
    if (!hasSet(other)) return false;
    if (plan.locationId && other.locationId) return plan.locationId === other.locationId;
    return !!place && planPlace(other, cards) === place;
  });
}

/**
 * Copies the Set layer of `source` onto plan `targetId` (decision 0110): its walls and openings
 * and the items on its Set layer, with new ids; lights, cameras, actors and notes stay behind.
 * Returns the refs of the items copied. Call it inside one change, for one undo step.
 */
export function copySetLayer(
  doc: Y.Doc,
  source: PlanElement,
  targetId: string,
  origin?: unknown,
): PlanItemRef[] {
  copyPlanWalls(doc, source, targetId, origin);
  const refs = planItems(source).flatMap(({ ref, item }) => (layerOf(item) === 'set' ? [ref] : []));
  // Only the Set: a person seated on a Set sofa, a light on a Set support stay behind, and a copy
  // whose base is not copied stands free.
  return duplicatePlanItems(doc, source, refs, { x: 0, y: 0 }, origin, {
    target: targetId,
    attached: false,
  });
}

// The background picture ----------------------------------------------------------------------

type Background = NonNullable<PlanElement['background']>;
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a plan's background picture lies, in view units: where it was placed, else the drawing. */
export function backgroundBox(background: Background): Box {
  const { x, y, w, h } = background;
  return x !== undefined && y !== undefined && w && h
    ? { x, y, w, h }
    : { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
}

/** A picture `width` by `height` pixels fitted in the middle of the drawing, its shape kept. */
export function fitBackground(width: number, height: number): Box {
  if (!(width > 0 && height > 0)) return { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
  const k = Math.min(PLAN_VIEW_W / width, PLAN_VIEW_H / height);
  const w = width * k;
  const h = height * k;
  return { x: (PLAN_VIEW_W - w) / 2, y: (PLAN_VIEW_H - h) / 2, w, h };
}

/**
 * A background box scaled from its corner opposite to `corner` (0 top left, 1 top right, 2
 * bottom right, 3 bottom left) so that corner follows `p`, its shape kept, at least 20 units.
 */
export function scaleBackground(box: Box, corner: 0 | 1 | 2 | 3, p: Point): Box {
  const right = corner === 1 || corner === 2;
  const bottom = corner === 2 || corner === 3;
  const fixed = { x: right ? box.x : box.x + box.w, y: bottom ? box.y : box.y + box.h };
  const k = Math.max(
    20 / Math.min(box.w, box.h),
    Math.max(Math.abs(p.x - fixed.x) / box.w, Math.abs(p.y - fixed.y) / box.h),
  );
  const w = box.w * k;
  const h = box.h * k;
  return { x: right ? fixed.x : fixed.x - w, y: bottom ? fixed.y : fixed.y - h, w, h };
}
