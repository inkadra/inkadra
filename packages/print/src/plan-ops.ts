// SPDX-License-Identifier: MPL-2.0
/**
 * A set plan's drawing on a printed page (decisions 0062, 0104, 0116): the plan as drawing
 * operations in the printed theme's colours, with the arrows, dashes and heads the pages share.
 */
import {
  arrowGeometry,
  arrowPolyline,
  beamOpacity,
  beamStrength,
  beamWarmth,
  blockingCurve,
  blockingPositions,
  type CardsById,
  CHARACTER_COLOURS,
  curvePoints,
  DEFAULT_GLYPH_STROKE,
  decodeStroke,
  glyphStrokeFactor,
  iconCone,
  iconGlow,
  iconLabel,
  iconSubLabel,
  iconTransform,
  PLAN_LABEL_SIZE as LABEL_SIZE,
  labelAnchor,
  linkedPlan,
  measureEnds,
  openingLines,
  PLAN_DRAW_ORDER,
  PLAN_INK,
  PLAN_ROOM_SIZE_GAP,
  PLAN_ROOM_SIZE_TEXT,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanDrawLayer,
  type PlanStackEntry,
  type Point,
  pieceOutline,
  placedGlyph,
  planFrame,
  planRoomDims,
  planShapeOutline,
  planStack,
  planToken,
  type Rect,
  type RoomSizeWords,
  roomMetres,
  PLAN_SUB_LABEL_SIZE as SUB_LABEL_SIZE,
  shownOpenings,
  wallPieces,
  wallPoints,
} from '@inkadra/canvas-core';
import type { Element, PlanIcon, PlanShape, Stroke } from '@inkadra/doc-schema';
import type { Measure, Op } from './ops.ts';

/** Colours of a printed page: the light theme tokens of packages/ui. */
export type Palette = Record<
  | 'surface-1'
  | 'surface-2'
  | 'surface-3'
  | 'border-default'
  | 'border-strong'
  | 'text-primary'
  | 'text-secondary'
  | 'text-muted'
  | 'bg-canvas'
  | 'tag-blue'
  | 'tag-orange'
  | 'tag-purple'
  | 'tag-green'
  | 'tag-blue-bg'
  | 'tag-orange-bg'
  | 'tag-purple-bg'
  | 'tag-green-bg'
  | 'tag-yellow'
  | 'tag-red'
  | 'tag-teal'
  | 'tag-pink',
  string
>;

/**
 * What a plan's drawing reads besides the plan: only these, so the drawing cannot reach the rest
 * of a board export's context (the web's `CardContext` extends it).
 */
export interface PlanDrawContext {
  measure: Measure;
  colors: Palette;
  /**
   * A room's size as the app writes it, in its language (decision 0119): "8.0 m", or "8.0 m
   * overall" for a room that is not a rectangle. The engine gives it; without it, English.
   */
  roomSize?(length: number, scale: number, overall: boolean): string;
  /** The app's language, which writes a measure's length ("2,70 m" in Italian). */
  language: string;
  /** The cards this export's audience may see, which set plans' links resolve against. */
  cards?: CardsById;
}

/** A pen stroke of a frame or a plan, in `box`. */
export function strokeOp(stroke: Stroke, box: Rect): Op {
  const points = decodeStroke(stroke.points).flatMap((p) => [
    box.x + p.x * box.w,
    box.y + p.y * box.h,
  ]);
  const opacity = stroke.opacity ?? (stroke.tool === 'marker' ? 0.5 : 1);
  return {
    kind: 'polyline',
    points,
    color: stroke.color,
    width: (stroke.width / 1000) * box.w,
    opacity,
  };
}

/** `hex` mixed with `base` (both #RRGGBB), `t` of the way to `hex`; other colours stay. */
export function mix(hex: string, base: string, t: number): string {
  const rgb = (h: string) =>
    /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) : null;
  const a = rgb(hex);
  const b = rgb(base);
  if (!a || !b) return hex;
  return `#${a
    .map((v, i) =>
      Math.round((b[i] as number) + (v - (b[i] as number)) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** A room's size as an export writes it: in the engine's words, English without them. */
export const exportRoomSize =
  (ctx: Pick<PlanDrawContext, 'roomSize'>): RoomSizeWords =>
  (length, scale, overall) =>
    ctx.roomSize?.(length, scale, overall) ?? roomMetres(length, scale, 'en');

/**
 * A plan framed in `box` (decision 0118): what is drawn on it (planFrame), centred, in the plan's
 * shape; what lies beyond the frame is cut.
 */
export function framedPlanOps(
  stored: Extract<Element, { type: 'plan' }>,
  box: Rect,
  ctx: PlanDrawContext,
  moves = true,
): Op[] {
  const f = planFrame(stored, exportRoomSize(ctx), false);
  const k = Math.min(box.w / f.w, box.h / f.h);
  const whole = {
    x: box.x + (box.w - f.w * k) / 2 - f.x * k,
    y: box.y + (box.h - f.h * k) / 2 - f.y * k,
    w: PLAN_VIEW_W * k,
    h: PLAN_VIEW_H * k,
  };
  return planOps(stored, whole, ctx, moves, true, box);
}

/** The discs of a printed glow, as shares of its radius, outermost first. */
const GLOW_RINGS = [1, 0.75, 0.5, 0.28];

/** How much of the ink tints the floor of a closed room over the paper (audit L1). */
const FLOOR_TINT = 0.04;

/**
 * A set plan's drawing as vectors, without the grid (decisions 0062 and 0104), in the printed
 * theme's colours and the stacking order of the board: walls, tiers 0 and 1, beams and blocking
 * moves, tiers 2 to 5, blocking numbers, labels. `moves`: blocking moves and numbers, on unless
 * an export leaves them out (round 6, i).
 */
export function planOps(
  stored: Extract<Element, { type: 'plan' }>,
  box: Rect,
  ctx: PlanDrawContext,
  moves = true,
  /** Beams, cones and labels; a legend's glyph leaves them out (its row writes the name). */
  beams = true,
  /** Where the drawing is cut; `box` (the plan's extent) without one. */
  clipTo?: Rect,
  /** The rooms' sizes, with a scale (decision 0119); a sheet without "Scale and sizes" leaves them out. */
  sizes = true,
): Op[] {
  // Links read from the cards the audience may see; without them, the text the icons hold.
  const el = ctx.cards ? linkedPlan(stored, ctx.cards, { palette: CHARACTER_COLOURS }) : stored;
  const c = ctx.colors;
  const ink = (hex: string) => {
    const token = planToken(hex);
    return token ? c[token as keyof Palette] : hex;
  };
  const stack = planStack(el, el.hiddenLayers);
  const shownIcons = stack.filter((e) => e.ref.kind === 'icons').map((e) => e.item as PlanIcon);
  const k = box.w / PLAN_VIEW_W;
  const at = (x: number, y: number) => ({ x: box.x + x * k, y: box.y + y * k });
  const flat = (pts: ReadonlyArray<{ x: number; y: number }>) =>
    pts.flatMap((p) => [box.x + p.x * k, box.y + p.y * k]);
  // The layers in canvas-core's order (decision 0116); exports print the rooms' sizes with the
  // labels, after the numbers, and draw no background or grid.
  const layers: Record<PlanDrawLayer, Op[]> = {
    background: [],
    grid: [],
    walls: [],
    roomSizes: [],
    low: [],
    beams: [],
    moves: [],
    high: [],
    numbers: [],
    labels: [],
  };
  const labels = layers.labels;
  // Walls and their openings, on the Set layer (decision 0104).
  if (!el.hiddenLayers?.includes('set')) {
    const wallInk = ink(PLAN_INK);
    const openings = shownOpenings(el);
    const walls = new Map((el.walls ?? []).map((w) => [w.id, w]));
    // A closed room's floor, tinted under everything (audit L1).
    for (const wall of el.walls ?? [])
      if (wall.closed)
        layers.walls.push({
          kind: 'polygon',
          points: flat(wallPoints(wall)),
          fill: mix(c['text-primary'], c['surface-1'], FLOOR_TINT),
        });
    for (const wall of el.walls ?? [])
      for (const piece of wallPieces(wall, openings))
        layers.walls.push({
          kind: 'polygon',
          points: flat(pieceOutline(piece, wall.thickness)),
          fill: wallInk,
        });
    // The rooms' sizes outside their walls, "8.0 m" over the top and "6.3 m" on the left.
    for (const d of sizes && el.scale ? planRoomDims(el) : []) {
      const a = at(d.a.x, d.a.y);
      const b = at(d.b.x, d.b.y);
      const color = c['text-muted'];
      const w = 0.75;
      const t = 5 * k;
      const across = a.y === b.y ? { x: 0, y: t } : { x: t, y: 0 };
      labels.push(
        { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, width: w },
        ...[a, b].map(
          (p): Op => ({
            kind: 'line',
            x1: p.x - across.x,
            y1: p.y - across.y,
            x2: p.x + across.x,
            y2: p.y + across.y,
            color,
            width: w,
          }),
        ),
      );
      const text = exportRoomSize(ctx)(d.length, el.scale as number, d.overall);
      const size = PLAN_ROOM_SIZE_TEXT * k;
      const tw = ctx.measure(text, size, 400);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // shortcut: the left side's size is written level, not turned as on screen; turn it when
      // the export ops can rotate text.
      labels.push({
        kind: 'text',
        x: a.y === b.y ? mid.x - tw / 2 : mid.x - tw - PLAN_ROOM_SIZE_GAP * k,
        y: a.y === b.y ? mid.y - PLAN_ROOM_SIZE_GAP * k : mid.y + size * 0.35,
        text,
        size,
        weight: 400,
        color: c['text-secondary'],
      });
    }
    for (const o of openings) {
      const wall = walls.get(o.wall);
      if (!wall) continue;
      for (const line of openingLines(wall, o)) {
        const pts = line.points.map((p) => at(p.x, p.y));
        const w = (line.leaf ? 2.9 : 1.6) * k;
        if (line.dashed) layers.walls.push(...dashes(pts, 4 * k, 4 * k, wallInk, w));
        else
          layers.walls.push({
            kind: 'polyline',
            points: pts.flatMap((p) => [p.x, p.y]),
            color: wallInk,
            width: w,
          });
      }
    }
  }
  const itemOps = (e: PlanStackEntry): Op[] => {
    if (e.ref.kind === 'strokes') {
      const stroke = e.item as Stroke;
      return [strokeOp({ ...stroke, color: ink(stroke.color) }, box)];
    }
    if (e.ref.kind === 'shapes') {
      const shape = e.item as PlanShape;
      return planShapeOps(measureEnds(shape, el.icons), box, ink(shape.color), el.scale, ctx);
    }
    const icon = e.item as PlanIcon;
    return iconOps(icon, ink(icon.color), 1, true);
  };
  for (const e of stack) if (e.tier < 2) layers.low.push(...itemOps(e));
  for (const icon of beams ? shownIcons : []) layers.beams.push(...beamOps(icon));
  // Blocking: the moves, the veiled earlier positions and the numbers (round 6, d).
  const numbers = layers.numbers;
  for (const icon of moves ? shownIcons : []) {
    const steps = icon.steps ?? [];
    if (steps.length === 0) continue;
    const color = ink(icon.color);
    const at = blockingPositions(icon);
    for (let i = 0; i + 1 < at.length; i++) {
      const a = at[i] as { x: number; y: number };
      const b = at[i + 1] as { x: number; y: number };
      const { control } = blockingCurve(a, b, steps[i]?.bend);
      const pts = curvePoints(a, control, b).map((p) => ({
        x: box.x + p.x * k,
        y: box.y + p.y * k,
      }));
      // Stop short of the icon so the head shows.
      while (
        pts.length > 2 &&
        Math.hypot((pts.at(-1)?.x ?? 0) - b.x * k - box.x, (pts.at(-1)?.y ?? 0) - b.y * k - box.y) <
          26 * k
      )
        pts.pop();
      const w = 2.5 * k;
      if (icon.dashed) layers.moves.push(...dashes(pts, 10 * k, 8 * k, color, w));
      else
        layers.moves.push({
          kind: 'polyline',
          points: pts.flatMap((p) => [p.x, p.y]),
          color,
          width: w,
        });
      const end = pts.at(-1) as { x: number; y: number };
      const prev = pts.at(-2) as { x: number; y: number };
      layers.moves.push(head(prev.x, prev.y, end.x, end.y, 14 * k, color));
    }
    for (const step of steps)
      layers.moves.push(
        ...iconOps(
          { ...icon, x: step.x, y: step.y, rotation: step.rotation ?? 0 },
          color,
          0.4,
          false,
        ),
      );
    at.forEach((p, i) => {
      const cx = box.x + (p.x - 24) * k;
      const cy = box.y + (p.y - 24) * k;
      const ring: number[] = [];
      for (let j = 0; j < 20; j++)
        ring.push(
          cx + 11 * k * Math.cos((j / 20) * Math.PI * 2),
          cy + 11 * k * Math.sin((j / 20) * Math.PI * 2),
        );
      const label = String(i + 1);
      numbers.push(
        { kind: 'polygon', points: ring, fill: color },
        {
          kind: 'text',
          x: cx - ctx.measure(label, 13 * k, 600) / 2,
          y: cy + 4.5 * k,
          text: label,
          size: 13 * k,
          weight: 600,
          color: c['surface-1'],
        },
      );
    });
  }
  for (const e of stack) if (e.tier >= 2) layers.high.push(...itemOps(e));
  if (!beams) layers.labels = [];
  const inside = PLAN_DRAW_ORDER.flatMap((layer) => layers[layer]);
  return [{ kind: 'clip', ...(clipTo ?? box), ops: inside }];

  /**
   * A camera's cone, a light's beam tinted by its colour temperature, or the glow of a light
   * that shines all round (decision 0104), as flat shades of the printed page.
   */
  function beamOps(icon: PlanIcon): Op[] {
    const cone = iconCone(icon, el.sensor);
    const glow = cone ? null : iconGlow(icon);
    const warmth = icon.kind === 'camera' ? null : beamWarmth(icon.kelvin);
    const color = warmth === null ? ink(icon.color) : mix(c['tag-orange'], c['tag-blue'], warmth);
    const shade = beamStrength(icon);
    const opacity = beamOpacity(icon, cone?.beam ?? false);
    if (glow) {
      // A soft glow, as the screen's radial one (audit SH3): discs stacked from the rim inwards,
      // each faint, so the shade falls off towards the edge.
      return GLOW_RINGS.map((share): Op => {
        const ring: number[] = [];
        for (let j = 0; j < 32; j++) {
          const a = (j / 32) * Math.PI * 2;
          const p = at(
            glow.centre.x + glow.radius * share * Math.cos(a),
            glow.centre.y + glow.radius * share * Math.sin(a),
          );
          ring.push(p.x, p.y);
        }
        return { kind: 'polygon', points: ring, fill: color, opacity: shade / 2.5 };
      });
    }
    if (!cone) return [];
    const pts = cone.points.map((p) => at(p.x, p.y));
    return [
      {
        kind: 'polygon',
        points: pts.flatMap((p) => [p.x, p.y]),
        fill: color,
        opacity: opacity.fill,
      },
      {
        kind: 'polyline',
        points: [...pts, pts[0] as { x: number; y: number }].flatMap((p) => [p.x, p.y]),
        color: mix(color, c['surface-1'], opacity.stroke),
        width: 1.5 * k,
      },
    ];
  }

  /** An icon: its glyph and its label; `veil` fades a blocking copy. */
  function iconOps(icon: PlanIcon, base: string, veil: number, full: boolean): Op[] {
    const out: Op[] = [];
    const color = veil < 1 ? mix(base, c['surface-1'], veil) : base;
    const t = iconTransform(icon);
    const scale = Math.sqrt(t.sx * t.sy);
    const paper = c['surface-1'];
    // The glyph's parts placed by canvas-core (decision 0116), at the board's widths and dashes.
    // shortcut: exports print them thinner, as they always have: a part without a width of its
    // own at 1 / DEFAULT_GLYPH_STROKE of the board's, one with its own at glyphStrokeFactor /
    // DEFAULT_GLYPH_STROKE; their dashes in widths of that stroke. Print the board's widths
    // (`part.width * k`, `part.dash`) when exports are made to match the board.
    for (const part of placedGlyph(icon)) {
      const w =
        (part.width * k * (part.eased ? 1 : glyphStrokeFactor(scale))) / DEFAULT_GLYPH_STROKE;
      const dash = part.dash?.map((d) => (d / scale) * w);
      const pts = part.points.map((p) => at(p.x, p.y));
      const own = part.color ? ink(part.color) : color;
      // Opaque parts mix their colour into the paper; see-through ones only tint it (0104).
      const fill = part.fill?.hole
        ? paper
        : part.fill?.mix !== undefined
          ? mix(own, paper, part.fill.mix)
          : part.fill?.alpha !== undefined
            ? own
            : null;
      const alpha =
        part.fill?.alpha !== undefined && part.fill.alpha < 1 ? part.fill.alpha : undefined;
      if (fill && pts[0])
        out.push({
          kind: 'polygon',
          points: pts.flatMap((p) => [p.x, p.y]),
          fill,
          ...(alpha !== undefined ? { opacity: alpha * veil } : {}),
        });
      if (part.closed && pts[0]) pts.push(pts[0]);
      const stroke = part.opacity !== undefined ? mix(own, paper, part.opacity) : own;
      if (dash)
        out.push(...dashes(pts, dash[0] as number, dash[1] ?? (dash[0] as number), stroke, w));
      else
        out.push({
          kind: 'polyline',
          points: pts.flatMap((p) => [p.x, p.y]),
          color: stroke,
          width: w,
        });
    }
    const label = iconLabel(icon, ctx.language);
    if (label && full) {
      // Labels go last, on a patch of the card's colour: the halo of the board.
      const a = labelAnchor(icon);
      const size = LABEL_SIZE * k;
      const w = ctx.measure(label, size, 500);
      const x = box.x + a.x * k - w / 2;
      const y = box.y + a.y * k;
      labels.push(
        {
          kind: 'rect',
          x: x - 2 * k,
          y: y - size,
          w: w + 4 * k,
          h: size * 1.3,
          fill: c['surface-1'],
        },
        { kind: 'text', x, y, text: label, size, weight: 500, color },
      );
      // A named light's colour temperature and level, dim, under its label (audit M4).
      const sub = iconSubLabel(icon);
      if (sub) {
        const small = SUB_LABEL_SIZE * k;
        const sw = ctx.measure(sub, small, 400);
        const sx = box.x + a.x * k - sw / 2;
        const sy = y + (LABEL_SIZE + 2) * k;
        labels.push(
          {
            kind: 'rect',
            x: sx - 2 * k,
            y: sy - small,
            w: sw + 4 * k,
            h: small * 1.3,
            fill: c['surface-1'],
          },
          {
            kind: 'text',
            x: sx,
            y: sy,
            text: sub,
            size: small,
            weight: 400,
            color: c['text-secondary'],
          },
        );
      }
    }
    return out;
  }
}

/**
 * A plan shape from its outline in canvas-core (decision 0116). Exports differ from the board in
 * three ways, kept as they were: an arrow's head is filled and shorter; texts, a zone's name and a
 * measure's length are printed level, in sizes of their own; a measure ignores a rotation.
 */
function planShapeOps(
  shape: PlanShape,
  box: Rect,
  color: string,
  scale: number | undefined,
  ctx: PlanDrawContext,
): Op[] {
  const c = ctx.colors;
  const k = box.w / PLAN_VIEW_W;
  const at = (p: Point) => ({ x: box.x + p.x * k, y: box.y + p.y * k });
  const flat = (pts: readonly Point[]) => pts.flatMap((p) => [box.x + p.x * k, box.y + p.y * k]);
  const o = planShapeOutline(
    shape.kind === 'measure' ? { ...shape, rotation: undefined } : shape,
    scale,
    ctx.language,
  );
  const width = o.width * k;
  const [first = [], ...rest] = o.lines;
  const ring = o.closed && first[0] ? [...first, first[0]] : first;
  if (shape.kind === 'measure') {
    const [a, b] = first.map(at) as [Point, Point];
    const mid = at(o.centre);
    const label = o.text?.lines[0]?.text ?? '';
    const ops: Op[] = [{ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, width }];
    if (label) {
      const size = (18 / 1000) * box.w;
      const w = ctx.measure(label, size, 600);
      ops.push(
        {
          kind: 'rect',
          x: mid.x - w / 2 - 4,
          y: mid.y - size,
          w: w + 8,
          h: size * 1.6,
          radius: 3,
          fill: c['surface-1'],
          stroke: color,
          lineWidth: 0.75,
        },
        {
          kind: 'text',
          x: mid.x - w / 2,
          y: mid.y + size * 0.35,
          text: label,
          size,
          weight: 600,
          color: c['text-primary'],
        },
      );
    }
    return ops;
  }
  if (shape.kind === 'zone') {
    const ops: Op[] = [
      { kind: 'polygon', points: flat(first), fill: mix(color, c['surface-1'], o.fill ?? 0.1) },
      ...dashes(ring.map(at), (o.dash?.[0] ?? 0) * k, (o.dash?.[1] ?? 0) * k, color, width),
    ];
    if (shape.text && o.box) {
      const size = (18 / 1000) * box.w;
      const corner = at(o.box);
      ops.push({
        kind: 'text',
        x: corner.x + 0.01 * box.w,
        y: corner.y + size * 1.3,
        text: shape.text,
        size,
        weight: 400,
        color,
      });
    }
    return ops;
  }
  if (shape.kind === 'text' && o.text) {
    // Level, from the top of the first line: each baseline 0.9 of the size below its anchor.
    const size = o.text.size * k;
    return o.text.lines.map(
      (line): Op => ({
        kind: 'text',
        x: at(line.at).x,
        y: at(line.at).y + size * 0.9,
        text: line.text,
        size,
        weight: 500,
        color,
      }),
    );
  }
  if (shape.kind === 'ellipse' && !o.angle && o.box) {
    const mid = at(o.centre);
    return [
      {
        kind: 'ellipse',
        cx: mid.x,
        cy: mid.y,
        rx: (o.box.w / 2) * k,
        ry: (o.box.h / 2) * k,
        stroke: color,
        width,
      },
    ];
  }
  const ops: Op[] = [{ kind: 'polyline', points: flat(ring), color, width }];
  // shortcut: the head is the export's filled one, not the board's open wings (`rest`).
  if (shape.kind === 'arrow' && rest.length > 0) {
    const [a, b] = first.map(at) as [Point, Point];
    ops.push(head(a.x, a.y, b.x, b.y, Math.max(width * 3, 6), color));
  }
  return ops;
}

export function head(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: string,
): Op {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const a = angle + Math.PI - 0.45;
  const b = angle + Math.PI + 0.45;
  return {
    kind: 'polygon',
    points: [
      x1,
      y1,
      x1 + Math.cos(a) * size,
      y1 + Math.sin(a) * size,
      x1 + Math.cos(b) * size,
      y1 + Math.sin(b) * size,
    ],
    fill: color,
  };
}

export function drawArrow(
  el: Extract<Element, { type: 'arrow' }>,
  rectOf: (id: string) => Rect | null,
  ctx: PlanDrawContext,
): Op[] {
  const c = ctx.colors;
  const g = arrowGeometry(el, rectOf);
  const { a, b } = g;
  const color = c['text-secondary'];
  const dashed = el.line === 'dashed';
  const ops: Op[] = [];
  if (!g.c) {
    ops.push({
      kind: 'line',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      color,
      width: 1.5,
      ...(dashed ? { dash: [6, 5] } : {}),
    });
  } else if (!dashed) {
    ops.push({
      kind: 'polyline',
      points: arrowPolyline(g).flatMap((p) => [p.x, p.y]),
      color,
      width: 1.5,
    });
  } else {
    ops.push(...dashes(arrowPolyline(g, 48), 6, 5, color));
  }
  // Heads point along the path: on a curve, from the control point.
  const ta = g.c ?? b;
  const tb = g.c ?? a;
  const heads = el.heads ?? 'end';
  if (heads !== 'none') ops.push(head(tb.x, tb.y, b.x, b.y, 9, color));
  if (heads === 'both') ops.push(head(ta.x, ta.y, a.x, a.y, 9, color));
  if (el.label) {
    const w = ctx.measure(el.label, 11, 500);
    const mx = g.mid.x;
    const my = g.mid.y;
    ops.push({
      kind: 'rect',
      x: mx - w / 2 - 6,
      y: my - 9,
      w: w + 12,
      h: 18,
      radius: 9,
      fill: c['surface-1'],
      stroke: c['border-default'],
      lineWidth: 1,
    });
    ops.push({
      kind: 'text',
      x: mx - w / 2,
      y: my + 4,
      text: el.label,
      size: 11,
      weight: 500,
      color: c['text-primary'],
    });
  }
  return ops;
}

/** Dashes along a polyline, as lines `on` long with gaps `off` long. */
export function dashes(
  points: readonly { x: number; y: number }[],
  on: number,
  off: number,
  color: string,
  width = 1.5,
): Op[] {
  const ops: Op[] = [];
  let drawing = true;
  let left = on;
  for (const [i, q] of points.entries()) {
    const start = points[i - 1];
    if (!start) continue;
    let p: { x: number; y: number } = start;
    let len = Math.hypot(q.x - p.x, q.y - p.y);
    while (len > 0) {
      const step = Math.min(left, len);
      const t = step / len;
      const next: { x: number; y: number } = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      if (drawing)
        ops.push({ kind: 'line', x1: p.x, y1: p.y, x2: next.x, y2: next.y, color, width });
      p = next;
      len -= step;
      left -= step;
      if (left <= 1e-6) {
        drawing = !drawing;
        left = drawing ? on : off;
      }
    }
  }
  return ops;
}

/** The same operations, scaled by `s` and moved by (dx, dy): board units to page points. */
export function transformOps(ops: readonly Op[], s: number, dx: number, dy: number): Op[] {
  return ops.map((op) => transformOp(op, s, dx, dy));
}

function transformOp(op: Op, s: number, dx: number, dy: number): Op {
  const tx = (v: number) => v * s + dx;
  const ty = (v: number) => v * s + dy;
  const pts = (p: readonly number[]) => p.map((v, i) => (i % 2 === 0 ? tx(v) : ty(v)));
  const dash = (d: number[] | undefined) => (d ? { dash: d.map((v) => v * s) } : {});
  switch (op.kind) {
    case 'rect':
      return {
        ...op,
        x: tx(op.x),
        y: ty(op.y),
        w: op.w * s,
        h: op.h * s,
        ...(op.radius ? { radius: op.radius * s } : {}),
        ...(op.lineWidth ? { lineWidth: op.lineWidth * s } : {}),
        ...dash(op.dash),
      };
    case 'line':
      return {
        ...op,
        x1: tx(op.x1),
        y1: ty(op.y1),
        x2: tx(op.x2),
        y2: ty(op.y2),
        width: op.width * s,
        ...dash(op.dash),
      };
    case 'text':
      return { ...op, x: tx(op.x), y: ty(op.y), size: op.size * s };
    case 'image':
      return { ...op, x: tx(op.x), y: ty(op.y), w: op.w * s, h: op.h * s };
    case 'polyline':
      return { ...op, points: pts(op.points), width: op.width * s };
    case 'polygon':
      return { ...op, points: pts(op.points) };
    case 'ellipse':
      return {
        ...op,
        cx: tx(op.cx),
        cy: ty(op.cy),
        rx: op.rx * s,
        ry: op.ry * s,
        width: op.width * s,
      };
    case 'clip':
      return {
        ...op,
        x: tx(op.x),
        y: ty(op.y),
        w: op.w * s,
        h: op.h * s,
        ...(op.radius ? { radius: op.radius * s } : {}),
        ops: transformOps(op.ops, s, dx, dy),
      };
  }
}
