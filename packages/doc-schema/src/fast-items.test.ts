// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { PLAN_LAYERS, PlanStroke, Stroke } from './elements.ts';
import { fastCheckOf, UNSURE } from './fast-items.ts';

/** mulberry32: the same items on every run. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = prng(103);
const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
const ID_CHARS = 'abcXYZ019_-';
const str = (chars: string, n: number) =>
  Array.from({ length: n }, () => chars[int(0, chars.length - 1)]).join('');

/** Values around every limit of the schemas, of every type. */
const ODD: unknown[] = [
  undefined,
  null,
  true,
  0,
  -0,
  1,
  -1,
  0.04,
  0.05,
  0.5,
  1,
  1.0000001,
  2,
  199,
  200,
  201,
  1.5,
  4096,
  4097,
  // A plan's reach (decision 0118): its points may lie beyond the extent, a frame's may not.
  -1,
  -16384,
  -16385,
  20480,
  20481,
  2 ** 53,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '1',
  '',
  'pencil',
  'Pencil',
  'set',
  'other',
  '#00FF00',
  '#00ff00',
  '#00FF0',
  '#00FF00\n',
  'abcdefgh',
  'abcdefg',
  'abc defgh',
  'a'.repeat(64),
  'a'.repeat(65),
  'abcdefgh\n',
  'ąbcdefgh',
  [],
  [0, 0],
  {},
  new Date(0),
  // Values a crafted or corrupted item could hold: near the limits, boxed, typed, inherited.
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  0.049999999999,
  1e-7,
  4096.0000001,
  Number.MAX_SAFE_INTEGER,
  -0.0,
  '#0000FF ',
  ' pencil',
  // biome-ignore lint/style/useConsistentBuiltinInstantiation: a boxed value, on purpose
  new Number(5),
  // biome-ignore lint/style/useConsistentBuiltinInstantiation: a boxed value, on purpose
  new String('pencil'),
  new Int32Array([1, 2]),
  new Float64Array([1, 2, 3, 4]),
  Object.create({ x: 1 }),
  JSON.parse('{"__proto__": {"id": "abcdefgh"}}'),
];

function validStroke(plan: boolean): Record<string, unknown> {
  const n = pick([1, 2, 3, 30, 1024]);
  const s: Record<string, unknown> = {
    id: str(ID_CHARS, int(8, 64)),
    tool: pick(['pencil', 'brush', 'marker']),
    color: `#${str('0123456789ABCDEF', 6)}`,
    width: int(1, 200),
  };
  if (random() < 0.4) s.opacity = pick([0.05, 0.3, 1, undefined]);
  s.points = Array.from({ length: n * 2 }, () => pick([0, 4096, int(0, 4096)]));
  if (plan && random() < 0.5) s.layer = pick([...PLAN_LAYERS, undefined]);
  if (plan && random() < 0.3) s.group = pick([str(ID_CHARS, 21), undefined]);
  if (plan && random() < 0.3) s.locked = pick([true, false, undefined]);
  return s;
}

const KEYS = [
  'id',
  'tool',
  'color',
  'width',
  'opacity',
  'points',
  'layer',
  'group',
  'locked',
  'extra',
];

/** A valid stroke with one to five changes: a field set to an odd value, removed, reordered… */
function mutated(plan: boolean): unknown {
  const s = validStroke(plan);
  for (let k = int(1, 5); k > 0; k--) {
    const roll = random();
    const key = pick(KEYS);
    if (roll < 0.45) s[key] = pick(ODD);
    else if (roll < 0.6) delete s[key];
    else if (roll < 0.7) {
      const points = Array.isArray(s.points) ? [...s.points] : [0, 0];
      points[int(0, points.length)] = pick(ODD);
      s.points = points;
    } else if (roll < 0.75)
      s.points = new Array(4); // holes
    else if (roll < 0.8) s.points = new Array(2050).fill(1);
    else if (roll < 0.85) s.points = [1, 2, 3];
    else if (roll < 0.9) {
      // Same fields, another key order.
      const entries = Object.entries(s).reverse();
      return Object.fromEntries(entries);
    } else if (roll < 0.93) return Object.assign(Object.create(null), s);
    else if (roll < 0.96)
      // Every field inherited rather than own: Zod reads them with `in`, the check refuses.
      return Object.create(s);
    else if (roll < 0.98)
      // As it would come out of JSON with an own `__proto__` key.
      return JSON.parse(`{"__proto__":{"width":1},${JSON.stringify(s).slice(1)}`);
    else return pick([null, 'stroke', [s], 3]);
  }
  return s;
}

/**
 * The check against Zod with and without its compiled path: whatever the check accepts, the
 * schema accepts and returns deeply the same, key order and present-undefined keys included.
 */
function compare(schema: z.ZodType, value: unknown) {
  const fast = fastCheckOf(schema)!(value);
  let success = false;
  for (const jitless of [false, true]) {
    const parsed = schema.safeParse(value, { jitless });
    success = parsed.success;
    if (fast === UNSURE) continue;
    expect(parsed.success).toBe(true);
    expect(fast).toStrictEqual(parsed.data);
    expect(Object.keys(fast as object)).toEqual(Object.keys(parsed.data as object));
    expect(JSON.stringify(fast)).toBe(JSON.stringify(parsed.data));
  }
  return { fast, success };
}

/** Pin of Stroke and PlanStroke as fast-items.ts checks them (see the test). */
const STROKE_SCHEMAS_PIN = 'ea65a468bdf0e1eb 70dfab3aa5b857e';

/** A description of a Zod schema's definition, functions by their source, then a hash of it. */
function pin(schema: z.ZodType): string {
  const seen = new Set<unknown>();
  const describe = (value: unknown): unknown => {
    if (typeof value === 'function') return `fn ${String(value).replace(/\s+/g, ' ')}`;
    if (value instanceof RegExp) return `re ${value.source}/${value.flags}`;
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return 'cycle';
    seen.add(value);
    const zod = (value as { _zod?: { def: object } })._zod;
    if (zod) return describe(zod.def);
    if (Array.isArray(value)) return value.map(describe);
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, describe((value as Record<string, unknown>)[key])]),
    );
  };
  const text = JSON.stringify(describe(schema));
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b + text.charCodeAt(i), 0x5bd1e995) ^ (b >>> 15);
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

describe('fast stroke checks', () => {
  for (const [name, schema, plan] of [
    ['Stroke', Stroke, false],
    ['PlanStroke', PlanStroke, true],
  ] as const) {
    // Each item is parsed three times (both Zod paths, both checks): seconds on a CI runner.
    it(`accept every valid ${name} as the schema returns it`, { timeout: 30_000 }, () => {
      for (let i = 0; i < 1500; i++) {
        const value = validStroke(plan);
        expect(compare(schema, value).fast).not.toBe(UNSURE);
      }
    });

    it(`never accept a ${name} the schema refuses, nor return anything else`, {
      timeout: 30_000,
    }, () => {
      let refused = 0;
      let accepted = 0;
      for (let i = 0; i < 8000; i++) {
        const { fast, success } = compare(schema, mutated(plan));
        if (!success) refused++;
        if (fast !== UNSURE) accepted++;
      }
      // The mutations reach both sides of the schema.
      expect(refused).toBeGreaterThan(2000);
      expect(accepted).toBeGreaterThan(800);
    });
  }

  it('knows every field of the schemas: a new one must be checked here too', () => {
    expect(Object.keys(Stroke.shape)).toEqual([
      'id',
      'tool',
      'color',
      'width',
      'opacity',
      'points',
    ]);
    expect(Object.keys(PlanStroke.shape)).toEqual([
      ...Object.keys(Stroke.shape),
      'layer',
      'group',
      'locked',
    ]);
  });

  it('matches the stroke schemas it was written for', () => {
    // Every type, check, limit, pattern and refine of both schemas, refine bodies included.
    expect(
      `${pin(Stroke)} ${pin(PlanStroke)}`,
      'Stroke or PlanStroke changed: change fast-items.ts the same way (and its tests), then ' +
        'update this pin with the value received.',
    ).toBe(STROKE_SCHEMAS_PIN);
  });

  it('copies the points, so the stored item is never handed out', () => {
    const value = validStroke(false);
    const fast = fastCheckOf(Stroke)!(value) as { points: number[] };
    expect(fast.points).not.toBe(value.points);
    expect(fast).not.toBe(value);
  });

  it('keeps an extra key out, as the schema strips it', () => {
    const value = { ...validStroke(true), extra: 1 };
    expect(compare(PlanStroke, value).fast).not.toHaveProperty('extra');
  });
});
