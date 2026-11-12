// SPDX-License-Identifier: MPL-2.0
import type { z } from 'zod';
import {
  MAX_STROKE_POINTS,
  PLAN_COORD_MAX,
  PLAN_COORD_MIN,
  PLAN_LAYERS,
  PlanStroke,
  STROKE_GRID,
  Stroke,
} from './elements.ts';

/**
 * Hand-written checks of pen strokes, the items that make the first read of a board slow
 * (decision 0104): without a JIT, Zod costs tens of microseconds per stroke and a medium board
 * holds tens of thousands. Each check accepts only what its Zod schema accepts and returns what
 * the schema returns (same keys, same order, a copy of the points). Anything it does not accept
 * gets UNSURE and the caller runs the Zod schema, which stays the authority: a failure, an
 * unusual object or an item past these checks always goes through Zod. `fast-items.test.ts`
 * compares both on random and mutated items, with and without Zod's compiled path.
 */

/** The check cannot vouch for the item: run the schema. */
export const UNSURE: unique symbol = Symbol('unsure');

// The patterns of ElementId and of a stroke colour (elements.ts); the test feeds both the
// same strings.
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const COLOR = /^#[0-9A-F]{6}$/;
const LAYERS: ReadonlySet<unknown> = new Set(PLAN_LAYERS);

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** A stroke's points, within the frame's grid, or with `plan` within a plan's reach (0118). */
function points(value: unknown, plan: boolean): number[] | null {
  const min = plan ? PLAN_COORD_MIN : 0;
  const max = plan ? PLAN_COORD_MAX : STROKE_GRID;
  if (!Array.isArray(value)) return null;
  const n = value.length;
  if (n < 2 || n > MAX_STROKE_POINTS * 2 || n % 2 !== 0) return null;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const p = value[i];
    if (!Number.isSafeInteger(p) || p < min || p > max) return null;
    out[i] = p;
  }
  return out;
}

/** Stroke and, with `plan`, PlanStroke: the fields in schema order, unknown keys left out. */
function stroke(value: unknown, plan: boolean): unknown {
  if (!isPlain(value)) return UNSURE;
  const { id, tool, color, width } = value;
  if (typeof id !== 'string' || !ID.test(id)) return UNSURE;
  if (tool !== 'pencil' && tool !== 'brush' && tool !== 'marker') return UNSURE;
  if (typeof color !== 'string' || !COLOR.test(color)) return UNSURE;
  if (!Number.isSafeInteger(width) || (width as number) < 1 || (width as number) > 200)
    return UNSURE;
  const out: Record<string, unknown> = { id, tool, color, width };
  if ('opacity' in value) {
    const o = value.opacity;
    if (o !== undefined && (typeof o !== 'number' || !Number.isFinite(o) || o < 0.05 || o > 1))
      return UNSURE;
    out.opacity = o;
  }
  const p = points(value.points, plan);
  if (!p) return UNSURE;
  out.points = p;
  if (!plan) return out;
  if ('layer' in value) {
    if (value.layer !== undefined && !LAYERS.has(value.layer)) return UNSURE;
    out.layer = value.layer;
  }
  if ('group' in value) {
    const g = value.group;
    if (g !== undefined && (typeof g !== 'string' || !ID.test(g))) return UNSURE;
    out.group = g;
  }
  if ('locked' in value) {
    const l = value.locked;
    if (l !== undefined && typeof l !== 'boolean') return UNSURE;
    out.locked = l;
  }
  return out;
}

const CHECKS = new Map<z.ZodType, (value: unknown) => unknown>([
  [Stroke, (value) => stroke(value, false)],
  [PlanStroke, (value) => stroke(value, true)],
]);

/** The fast check of an item schema, if it has one. */
export function fastCheckOf(schema: z.ZodType): ((value: unknown) => unknown) | undefined {
  return CHECKS.get(schema);
}
