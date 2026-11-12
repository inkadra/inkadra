// SPDX-License-Identifier: MPL-2.0
import { PLAN_ICON_KINDS, type PlanIcon, type PlanShape } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import type { Point } from './geometry.ts';
import { beamOpacity, beamStrength, iconPoint, iconTransform } from './plan.ts';
import {
  glyphStroke,
  glyphStrokeFactor,
  measureText,
  PLAN_DRAW_ORDER,
  placedGlyph,
  planShapeOutline,
} from './plan-draw.ts';
import { DEFAULT_GLYPH_STROKE, flattenGlyph, iconGlyph } from './plan-icons.ts';

const icon = (fields: Partial<PlanIcon>): PlanIcon =>
  ({
    id: 'iconAAAAAAAAA',
    kind: 'fresnel',
    color: '#EDD963',
    x: 2048,
    y: 2048,
    ...fields,
  }) as PlanIcon;
const shape = (fields: Partial<PlanShape>): PlanShape =>
  ({
    id: 'shapeAAAAAAAA',
    kind: 'rect',
    color: '#7AD689',
    width: 4,
    x0: 0,
    y0: 0,
    x1: 4096,
    y1: 4096,
    ...fields,
  }) as PlanShape;
const near = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};
const finite = (v: unknown): boolean =>
  typeof v === 'number'
    ? Number.isFinite(v)
    : Array.isArray(v)
      ? v.every(finite)
      : v && typeof v === 'object'
        ? Object.values(v).every(finite)
        : true;

describe('placedGlyph', () => {
  it('places every kind of the catalogue, turned and sized, in finite numbers', () => {
    for (const kind of PLAN_ICON_KINDS)
      for (const fields of [{}, { rotation: 137, percent: 260 }, { w: 300, h: 40, rotation: 90 }]) {
        const placed = placedGlyph(icon({ kind, ...fields }));
        expect(placed.length, kind).toBe(flattenGlyph(iconGlyph({ kind })).length);
        expect(placed.length, kind).toBeGreaterThan(0);
        expect(finite(placed), kind).toBe(true);
        for (const part of placed) {
          expect(part.points.length, kind).toBeGreaterThan(1);
          expect(part.width, kind).toBeGreaterThan(0);
        }
      }
  });

  it('puts each point where iconPoint puts it', () => {
    const turned = icon({ kind: 'camera', rotation: 30, percent: 150, x: 1000, y: 3000 });
    const t = iconTransform(turned);
    const glyph = flattenGlyph(iconGlyph(turned));
    placedGlyph(turned).forEach((part, n) => {
      const flat = glyph[n]?.points ?? [];
      expect(part.points.length).toBe(flat.length / 2);
      part.points.forEach((p, i) => {
        near(p, iconPoint(t, flat[2 * i] as number, flat[2 * i + 1] as number));
      });
    });
  });

  it('strokes as the board does: the eased width, or the part’s own, times the icon’s scale', () => {
    const big = icon({ kind: 'cuco', percent: 400 });
    const t = iconTransform(big);
    const scale = Math.sqrt(t.sx * t.sy);
    const [own] = placedGlyph(big);
    // The cucoloris' first part is 4 wide, butt-ended.
    expect(own?.width).toBeCloseTo(4 * scale);
    expect(own?.butt).toBe(true);
    const plain = placedGlyph(big).at(-1);
    expect(plain?.width).toBeCloseTo(glyphStroke(t) * scale);
    expect(glyphStroke(t)).toBeLessThan(DEFAULT_GLYPH_STROKE * 1.6);
  });

  it('scales dashes and keeps fills, opacities and own colours', () => {
    const butterfly = icon({ kind: 'butterfly', percent: 200 });
    const t = iconTransform(butterfly);
    const scale = Math.sqrt(t.sx * t.sy);
    const [frame] = placedGlyph(butterfly);
    expect(frame?.dash).toEqual([3 * scale, 3 * scale]);
    expect(frame?.fill).toEqual({ alpha: 0.1 });
    expect(placedGlyph(icon({ kind: 'gel' }))[0]).toMatchObject({
      color: '#F79B54',
      fill: { alpha: 0.7 },
      closed: true,
    });
    expect(placedGlyph(icon({ kind: 'ring' }))[1]?.fill).toEqual({ hole: true });
    expect(placedGlyph(icon({ kind: 'lantern' }))[1]?.opacity).toBe(0.5);
  });

  it('draws a seated actor with the seated glyph', () => {
    const seated = placedGlyph(icon({ kind: 'actor', pose: 'seated' }));
    expect(seated.length).toBe(flattenGlyph(iconGlyph({ kind: 'actor', pose: 'seated' })).length);
  });
});

describe('glyphStrokeFactor', () => {
  it('widens a small icon’s strokes 1.6 times, then less as it grows', () => {
    expect(glyphStrokeFactor(0.5)).toBe(1.6);
    expect(glyphStrokeFactor(1.0625)).toBeCloseTo(1.6);
    expect(glyphStrokeFactor(2)).toBe(0.85);
    expect(glyphStrokeFactor(4) * 4).toBeCloseTo(1.7);
    expect(glyphStroke({ sx: 2, sy: 2 })).toBeCloseTo(DEFAULT_GLYPH_STROKE * 0.85);
  });
});

describe('beam opacities', () => {
  it('reads the intensity, 0.8 when not set', () => {
    expect(beamStrength({})).toBeCloseTo(0.188);
    expect(beamStrength({ intensity: 0 })).toBeCloseTo(0.06);
    expect(beamStrength({ intensity: 1 })).toBeCloseTo(0.22);
  });

  it('fills a beam by its intensity and a camera’s cone at 0.14, edged at 0.35 and 0.5', () => {
    expect(beamOpacity({ intensity: 0.5 }, true)).toEqual({
      fill: beamStrength({ intensity: 0.5 }),
      stroke: 0.35,
    });
    expect(beamOpacity({ intensity: 0.5 }, false)).toEqual({ fill: 0.14, stroke: 0.5 });
  });
});

describe('PLAN_DRAW_ORDER', () => {
  it('draws walls first, beams between the low and the high items, labels last', () => {
    expect(PLAN_DRAW_ORDER).toEqual([
      'background',
      'grid',
      'walls',
      'roomSizes',
      'low',
      'beams',
      'moves',
      'high',
      'numbers',
      'labels',
    ]);
  });
});

describe('planShapeOutline', () => {
  it('gives a rect its corners from (x0, y0), and its box level', () => {
    const o = planShapeOutline(shape({ x0: 4096, y0: 2048, x1: 0, y1: 0 }));
    expect(o.closed).toBe(true);
    expect(o.width).toBe(4);
    expect(o.lines[0]).toEqual([
      { x: 1000, y: 1000 / 3 },
      { x: 0, y: 1000 / 3 },
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ]);
    expect(o.box).toEqual({ x: 0, y: 0, w: 1000, h: 1000 / 3 });
    expect(o.centre).toEqual({ x: 500, y: 500 / 3 });
  });

  it('turns a rect about its middle, its box left level', () => {
    const o = planShapeOutline(shape({ x0: 1024, y0: 1024, x1: 3072, y1: 2048, rotation: 90 }));
    const c = o.centre;
    expect(o.angle).toBe(90);
    // The corner left and above the middle goes right and above it.
    near(o.lines[0]?.[0] as Point, { x: c.x + (o.box?.h ?? 0) / 2, y: c.y - (o.box?.w ?? 0) / 2 });
    expect(o.box).toEqual({ x: 250, y: 1000 / 6, w: 500, h: 1000 / 6 });
  });

  it('rings an ellipse in 32 points, turned', () => {
    const o = planShapeOutline(
      shape({ kind: 'ellipse', x0: 0, y0: 0, x1: 2048, y1: 1024, rotation: 90 }),
    );
    expect(o.lines[0]).toHaveLength(32);
    // Its first point, at the right end of the level ellipse, turns to the bottom.
    near(o.lines[0]?.[0] as Point, { x: o.centre.x, y: o.centre.y + 250 });
    for (const p of o.lines[0] ?? []) {
      const dx = (p.x - o.centre.x) / ((o.box?.h ?? 1) / 2);
      const dy = (p.y - o.centre.y) / ((o.box?.w ?? 1) / 2);
      expect(dx * dx + dy * dy).toBeCloseTo(1);
    }
  });

  it('draws an arrow as a shaft and a head of two wings through the tip', () => {
    const thin = planShapeOutline(
      shape({ kind: 'arrow', x0: 0, y0: 0, x1: 4096, y1: 0, width: 2 }),
    );
    expect(thin.closed).toBe(false);
    const [shaft, head] = thin.lines as [Point[], Point[]];
    expect(shaft).toEqual([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ]);
    expect(head[1]).toEqual({ x: 1000, y: 0 });
    // Heads are 4 line widths long, at least 12, at ±0.45 rad.
    near(head[0] as Point, { x: 1000 - 12 * Math.cos(0.45), y: 12 * Math.sin(0.45) });
    near(head[2] as Point, { x: 1000 - 12 * Math.cos(0.45), y: -12 * Math.sin(0.45) });
    const fat = planShapeOutline(
      shape({ kind: 'arrow', x0: 0, y0: 0, x1: 4096, y1: 0, width: 10 }),
    );
    expect(1000 - (fat.lines[1]?.[0]?.x ?? 0)).toBeCloseTo(40 * Math.cos(0.45));
  });

  it('turns an arrow, its head too', () => {
    const o = planShapeOutline(
      shape({ kind: 'arrow', x0: 1024, y0: 2048, x1: 3072, y1: 2048, rotation: 90 }),
    );
    near(o.lines[0]?.[1] as Point, { x: 500, y: 1000 / 3 + 250 });
    const head = o.lines[1] as Point[];
    near(head[1] as Point, o.lines[0]?.[1] as Point);
    expect(head[0]?.y).toBeLessThan(head[1]?.y ?? 0);
  });

  it('draws a line, and a text as its words on one baseline', () => {
    const line = planShapeOutline(shape({ kind: 'line', x1: 2048, y1: 0 }));
    expect(line.lines).toEqual([
      [
        { x: 0, y: 0 },
        { x: 500, y: 0 },
      ],
    ]);
    const text = planShapeOutline(
      shape({ kind: 'text', x0: 2048, y0: 1024, width: 26, text: 'Entra', rotation: 340 }),
    );
    expect(text.lines).toEqual([]);
    expect(text.width).toBe(0);
    expect(text.angle).toBe(340);
    expect(text.text).toEqual({ at: { x: 500, y: 500 / 3 }, text: 'Entra', size: 26 });
  });

  it('dashes and fills a zone, its name in the corner', () => {
    const o = planShapeOutline(
      shape({ kind: 'zone', x0: 2048, y0: 2048, x1: 1024, y1: 1024, width: 4, text: 'Video' }),
    );
    expect(o.dash).toEqual([12, 10]);
    expect(o.fill).toBe(0.1);
    expect(o.closed).toBe(true);
    expect(o.text).toEqual({ at: { x: 260, y: 1000 / 6 + 18 }, text: 'Video', size: 14 });
    expect(planShapeOutline(shape({ kind: 'zone' })).text).toBeUndefined();
  });

  it('draws a measure with ticks across its ends and its length on a chip', () => {
    const o = planShapeOutline(
      shape({ kind: 'measure', x0: 0, y0: 2048, x1: 4096, y1: 2048 }),
      100,
      'en',
    );
    expect(o.width).toBe(2);
    expect(o.dash).toBeUndefined();
    const [line, start, end] = o.lines as [Point[], Point[], Point[]];
    expect(line).toEqual([
      { x: 0, y: 1000 / 3 },
      { x: 1000, y: 1000 / 3 },
    ]);
    near(start[0] as Point, { x: 0, y: 1000 / 3 + 9 });
    near(start[1] as Point, { x: 0, y: 1000 / 3 - 9 });
    near(end[0] as Point, { x: 1000, y: 1000 / 3 + 9 });
    expect(o.text).toEqual({
      at: { x: 500, y: 1000 / 3 + 7 },
      text: '10.00 m',
      size: 14,
      weight: 600,
      middle: true,
    });
    expect(o.chip).toEqual({ x: 500 - 46.5, y: 1000 / 3 - 15, w: 93, h: 30, radius: 6 });
  });

  it('writes a measure’s written length, dashes it when asked, and leaves it bare without a scale', () => {
    const written = planShapeOutline(
      shape({ kind: 'measure', text: '2.7', dashed: true }),
      undefined,
      'it',
    );
    expect(written.text?.text).toBe('2,70 m');
    expect(written.dash).toEqual([8, 6]);
    const bare = planShapeOutline(shape({ kind: 'measure' }));
    expect(bare.text).toBeUndefined();
    expect(bare.chip).toBeUndefined();
    expect(bare.lines).toHaveLength(3);
  });

  it('gives finite numbers for every kind, level and turned', () => {
    for (const kind of ['rect', 'ellipse', 'line', 'arrow', 'text', 'zone', 'measure'] as const)
      for (const rotation of [undefined, 45, 300]) {
        const o = planShapeOutline(
          shape({ kind, rotation, x0: 300, y0: 3900, x1: 3700, y1: 100, text: 'A' }),
          80,
        );
        expect(finite(o), kind).toBe(true);
      }
  });
});

describe('measureText', () => {
  it('writes the length the scale gives, or nothing without one', () => {
    expect(measureText(shape({ kind: 'measure', x1: 4096, y1: 0 }), 50, 'en')).toBe('20.00 m');
    expect(measureText(shape({ kind: 'measure' }), undefined)).toBe('');
  });
});
