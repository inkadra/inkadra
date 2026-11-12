// SPDX-License-Identifier: MPL-2.0
import { type PlanIcon, type PlanShape, STROKE_GRID } from '@inkadra/doc-schema';
import type { Point, Rect } from './geometry.ts';
import { iconPoint, iconTransform, PLAN_VIEW_H, PLAN_VIEW_W } from './plan.ts';
import { DEFAULT_GLYPH_STROKE, type FlatPart, flattenPart, iconGlyph } from './plan-icons.ts';

/**
 * What a client needs to draw a set plan's icons and shapes as the board draws them (decision
 * 0116), in view units (the plan is PLAN_VIEW_W wide): no colours, fonts or device calls.
 */

/** Font sizes of a plan's texts, S, M and L, in view units. */
export const PLAN_TEXT_SIZES = { S: 14, M: 18, L: 26 } as const;

/** How dense a light's beam or glow is drawn: its intensity, 0.8 when not set. */
export function beamStrength(icon: Pick<PlanIcon, 'intensity'>): number {
  return 0.06 + 0.16 * (icon.intensity ?? 0.8);
}

/**
 * Stroke width of the glyph parts of an icon that have no width of their own, in glyph units:
 * it eases off as the icon grows, so a large icon is not drawn in heavy lines.
 */
export function glyphStroke(t: Pick<ReturnType<typeof iconTransform>, 'sx' | 'sy'>): number {
  return DEFAULT_GLYPH_STROKE * Math.min(1.6, 1.7 / Math.sqrt(t.sx * t.sy));
}

/** A part of an icon's glyph placed on the plan. */
export interface PlacedPart extends Omit<FlatPart, 'points'> {
  /** The polyline in view units, the icon's place, size and turn applied. */
  points: Point[];
  /** Stroke width in view units. */
  width: number;
  /** Dashes and gaps in view units. */
  dash?: number[];
}

/**
 * The parts of an icon's glyph on the plan, in view units and in the order they are drawn: each
 * is stroked, and filled first when it has a `fill` (`mix`: the icon's colour, or the part's own
 * `color`, mixed that far into the paper; `alpha`: that colour at that opacity; `hole`: the
 * paper). `opacity` is the stroke's; `butt` ends are square, the others round with round joins.
 * Curves come as polylines (shortcut: about 10 points per curve, as in exports; pass a finer
 * flattening when a client zooms in far enough to see the corners).
 */
export function placedGlyph(icon: PlanIcon): PlacedPart[] {
  const t = iconTransform(icon);
  // The board scales the glyph's strokes with the icon; across the two axes, their mean.
  const scale = Math.sqrt(t.sx * t.sy);
  const stroke = glyphStroke(t);
  const out: PlacedPart[] = [];
  for (const part of iconGlyph(icon)) {
    const width = (part.w ?? stroke) * scale;
    for (const flat of flattenPart(part)) {
      const points: Point[] = [];
      for (let i = 0; i + 1 < flat.points.length; i += 2)
        points.push(iconPoint(t, flat.points[i] as number, flat.points[i + 1] as number));
      out.push({
        ...flat,
        points,
        width,
        ...(flat.dash ? { dash: flat.dash.map((d) => d * scale) } : {}),
      });
    }
  }
  return out;
}

/**
 * Length of a measure in metres, "2,70 m": what was written on it (in `text`, a plain number), or
 * else what the scale says; '' on a plan without a scale.
 */
export function measureText(shape: PlanShape, scale: number | undefined, locale?: string): string {
  const written = shape.text ? Number(shape.text) : 0;
  if (!(written > 0) && !scale) return '';
  const dx = ((shape.x1 - shape.x0) / STROKE_GRID) * PLAN_VIEW_W;
  const dy = ((shape.y1 - shape.y0) / STROKE_GRID) * PLAN_VIEW_H;
  const m = written > 0 ? written : Math.hypot(dx, dy) / (scale as number);
  return `${m.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

/**
 * A plan shape as the board draws it, in view units. `lines` are ready to stroke, the shape's
 * turn applied; `box`, `text` and `chip` are level and are drawn turned by `angle` degrees
 * (clockwise) about `centre`, for a client that draws rectangles, ellipses and text as such.
 */
export interface PlanShapeOutline {
  /**
   * Polylines: a rect's or zone's four corners from (x0, y0) towards (x1, y0); an ellipse's
   * ring of 32 points; a line; an arrow's shaft, then its head (wing, tip, wing); a measure's
   * line, then the tick across each end. A text has none.
   */
  lines: Point[][];
  /** The first line is a ring: join its last point to its first. */
  closed: boolean;
  /** Stroke width; 0 for a text. */
  width: number;
  /** Dashes and gaps along the lines: a zone, a dashed measure. */
  dash?: number[];
  /** A zone is filled with its colour at this opacity. */
  fill?: number;
  angle: number;
  centre: Point;
  /** A rect's, zone's or ellipse's box, level: x and y its smaller corner. */
  box?: Rect;
  /**
   * Text on one line, level: a text shape's (from its baseline's start), a zone's name, a
   * measure's length (centred on `at`). `weight` is set where the board sets one.
   */
  text?: { at: Point; text: string; size: number; weight?: number; middle?: boolean };
  /** A measure's length sits on a patch of the paper with this box and corner radius, level. */
  chip?: Rect & { radius: number };
}

/** Arrow heads: their length, as a multiple of the line width (at least 12), and half-angle. */
const ARROW_HEAD = 4;
const ARROW_WING = 0.45;
/** Half the length of the ticks at a measure's ends. */
const MEASURE_TICK = 9;
/** Where a zone writes its name, from its corner. */
const ZONE_TEXT = { x: 10, y: PLAN_TEXT_SIZES.M };

/**
 * A plan shape in view units (decision 0116), as the board draws it: rects, ellipses, lines,
 * arrows and texts like a frame drawing's, turned by their rotation; zones (dashed, filled at
 * 10 %, their name in a corner) and measures (a line with ticks and, with a scale or a written
 * length, the length on a chip). Pass a measure through `measureEnds` first so it follows its
 * icons. `scale` and `locale` write a measure's length.
 */
export function planShapeOutline(
  shape: PlanShape,
  scale?: number,
  locale?: string,
): PlanShapeOutline {
  const x0 = (shape.x0 / STROKE_GRID) * PLAN_VIEW_W;
  const y0 = (shape.y0 / STROKE_GRID) * PLAN_VIEW_H;
  const x1 = (shape.x1 / STROKE_GRID) * PLAN_VIEW_W;
  const y1 = (shape.y1 / STROKE_GRID) * PLAN_VIEW_H;
  const centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const angle = shape.rotation ?? 0;
  const t = (angle * Math.PI) / 180;
  const turned = (p: Point): Point =>
    angle
      ? {
          x: centre.x + (p.x - centre.x) * Math.cos(t) - (p.y - centre.y) * Math.sin(t),
          y: centre.y + (p.x - centre.x) * Math.sin(t) + (p.y - centre.y) * Math.cos(t),
        }
      : p;
  const box = {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map(turned);
  const base = { closed: false, width: shape.width, angle, centre };
  switch (shape.kind) {
    case 'rect':
      return { ...base, lines: [corners], closed: true, box };
    case 'ellipse': {
      const ring: Point[] = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        ring.push(
          turned({
            x: centre.x + (box.w / 2) * Math.cos(a),
            y: centre.y + (box.h / 2) * Math.sin(a),
          }),
        );
      }
      return { ...base, lines: [ring], closed: true, box };
    }
    case 'line':
      return {
        ...base,
        lines: [
          [
            { x: x0, y: y0 },
            { x: x1, y: y1 },
          ].map(turned),
        ],
      };
    case 'arrow': {
      const a = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(12, shape.width * ARROW_HEAD);
      const wing = (side: number) => ({
        x: x1 - head * Math.cos(a + side * ARROW_WING),
        y: y1 - head * Math.sin(a + side * ARROW_WING),
      });
      const tip = { x: x1, y: y1 };
      return {
        ...base,
        lines: [[{ x: x0, y: y0 }, tip].map(turned), [wing(-1), tip, wing(1)].map(turned)],
      };
    }
    case 'text':
      return {
        ...base,
        lines: [],
        width: 0,
        text: { at: { x: x0, y: y0 }, text: shape.text ?? '', size: shape.width },
      };
    case 'zone':
      return {
        ...base,
        lines: [corners],
        closed: true,
        dash: [shape.width * 3, shape.width * 2.5],
        fill: 0.1,
        box,
        ...(shape.text
          ? {
              text: {
                at: { x: box.x + ZONE_TEXT.x, y: box.y + ZONE_TEXT.y },
                text: shape.text,
                size: PLAN_TEXT_SIZES.S,
              },
            }
          : {}),
      };
    case 'measure': {
      const a = Math.atan2(y1 - y0, x1 - x0);
      const tick = (x: number, y: number) =>
        [
          { x: x - MEASURE_TICK * Math.sin(a), y: y + MEASURE_TICK * Math.cos(a) },
          { x: x + MEASURE_TICK * Math.sin(a), y: y - MEASURE_TICK * Math.cos(a) },
        ].map(turned);
      const label = measureText(shape, scale, locale);
      // shortcut: the chip's width counts characters, not the font's widths, as the board does.
      const w = label.length * 11 + 16;
      return {
        ...base,
        lines: [
          [
            { x: x0, y: y0 },
            { x: x1, y: y1 },
          ].map(turned),
          tick(x0, y0),
          tick(x1, y1),
        ],
        width: 2,
        ...(shape.dashed ? { dash: [8, 6] } : {}),
        ...(label
          ? {
              text: {
                at: { x: centre.x, y: centre.y + 7 },
                text: label,
                size: PLAN_TEXT_SIZES.S,
                weight: 600,
                middle: true,
              },
              chip: { x: centre.x - w / 2, y: centre.y - 15, w, h: 30, radius: 6 },
            }
          : {}),
      };
    }
  }
}
