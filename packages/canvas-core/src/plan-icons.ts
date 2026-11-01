// SPDX-License-Identifier: MPL-2.0
import type { PlanIconKind, PlanLayer } from '@inkadra/doc-schema';

/**
 * The set icons of a plan (decision 0062): original line glyphs on a 32 grid with a 1.5 stroke,
 * the same drawing in the library and on the plan, and what each kind is: its category, the
 * colour family it starts in, the layer it goes to, whether it scales to real size.
 */

/**
 * A part of a glyph: a path (`d`), a circle (`c`: cx, cy, r) or a rectangle (`r`: x, y, w, h,
 * rx, optionally turned by `rot`: angle, cx, cy). `w` is a stroke width other than 1.5, `dash`
 * a dash pattern, `o` an opacity.
 */
export interface GlyphPart {
  d?: string;
  c?: number[];
  r?: number[];
  rot?: number[];
  w?: number;
  dash?: number[];
  o?: number;
}
export type GlyphName = keyof typeof GLYPHS;

export const GLYPHS = {
  fresnel: [{ c: [12, 16, 6] }, { d: 'M18 11.5l3-2.5v14l-3-2.5' }, { d: 'M21 9l6-3M21 23l6 3' }],
  led: [
    { r: [6, 9, 20, 14, 2] },
    { d: 'M11 13.5h.01M16 13.5h.01M21 13.5h.01M11 18.5h.01M16 18.5h.01M21 18.5h.01', w: 2.4 },
  ],
  tube: [{ r: [4, 13, 24, 6, 3] }, { d: 'M8 16h16', dash: [1.5, 2.5] }],
  softbox: [
    { d: 'M8 8h16l-4 7h-8z' },
    { d: 'M6 8h20' },
    { r: [13, 15, 6, 5, 1] },
    { d: 'M16 20v7' },
  ],
  lantern: [{ c: [16, 17, 9] }, { d: 'M8 13.5h16M7 17h18M8 20.5h16M16 8V4' }],
  para: [
    { d: 'M16 5l8 4 3 7-3 7-8 4-8-4-3-7 3-7z' },
    { d: 'M16 5v22M5 16h22M8 9l16 14M24 9L8 23', w: 1, o: 0.7 },
  ],
  practical: [{ d: 'M11 7h10l3 9H8z' }, { d: 'M16 16v9M11 26h10' }],
  sun: [
    { c: [16, 13, 4.5] },
    {
      d: 'M16 4v2M16 20v2M7 13h2M23 13h2M9.6 6.6l1.4 1.4M21 18l1.4 1.4M22.4 6.6L21 8M11 18l-1.4 1.4',
    },
    { d: 'M5 27h22M8 24v3M24 24v3' },
  ],
  cstand: [
    { c: [12, 20, 1.8] },
    { d: 'M12 20L5 26M12 20l7 6M12 20V9' },
    { d: 'M12 9h15' },
    { d: 'M27 7v4' },
  ],
  flag: [
    { r: [7, 7, 18, 12, 1] },
    { d: 'M7 11l4-4M7 16l9-9M11 19l12-12M17 19l8-8M22 19l3-3', w: 1 },
    { d: 'M16 19v8' },
  ],
  frame: [{ r: [6, 6, 20, 20, 1] }, { d: 'M6 6l20 20M26 6L6 26', w: 1, dash: [2, 2.5] }],
  bounce: [{ r: [7, 7, 18, 18, 1.5] }, { d: 'M7 25L25 7' }, { d: 'M10 25h15V10', w: 1, o: 0.6 }],
  gel: [{ d: 'M7 6h13l5 5v15H7z' }, { d: 'M20 6v5h5' }, { d: 'M11 21c3-4 7-4 10-8', w: 1 }],
  camera: [{ r: [4, 11, 16, 11, 2] }, { d: 'M20 14.5l7-3.5v11l-7-3.5' }],
  tripod: [
    { r: [9, 5, 12, 8, 1.5] },
    { d: 'M21 7.5l4-2v7l-4-2' },
    { d: 'M15 13v4M15 17l-7 10M15 17v10M15 17l7 10' },
  ],
  gimbal: [
    { r: [10, 12, 12, 8, 1.5] },
    { d: 'M22 14.5l3-1.5v6l-3-1.5' },
    { d: 'M7 16a9 9 0 0 1 9-9M16 7v5' },
    { d: 'M7 16v11' },
  ],
  dolly: [
    { r: [6, 9, 20, 14, 2] },
    { c: [9, 26, 1.8] },
    { c: [23, 26, 1.8] },
    { c: [9, 6, 1.8] },
    { c: [23, 6, 1.8] },
    { r: [12, 13, 7, 6, 1] },
    { d: 'M19 15l3-1.5v5L19 17' },
  ],
  track: [{ d: 'M3 12h26M3 20h26M7 12v8M12 12v8M17 12v8M22 12v8M27 12v8' }],
  slider: [{ d: 'M4 16h24' }, { d: 'M4 13v6M28 13v6' }, { r: [11, 12, 8, 8, 1.5] }],
  jib: [
    { d: 'M5 22L27 8' },
    { r: [2.5, 20, 6, 5, 1] },
    { c: [12, 17.5, 1.8] },
    { d: 'M12 19.5l-4 7M12 19.5l4 7' },
    { r: [23, 7, 6, 5, 1] },
  ],
  drone: [
    { r: [13, 13, 6, 6, 1.5] },
    { d: 'M13 13L9 9M19 13l4-4M13 19l-4 4M19 19l4 4' },
    { c: [8, 8, 3.5] },
    { c: [24, 8, 3.5] },
    { c: [8, 24, 3.5] },
    { c: [24, 24, 3.5] },
  ],
  carrig: [
    { r: [9, 7, 14, 22, 4] },
    { d: 'M11 13h10M11 23h10' },
    { r: [13, 1, 6, 4, 1] },
    { d: 'M16 5v2' },
  ],
  actor: [{ c: [16, 14, 6] }, { d: 'M12 21.5l4 5 4-5' }],
  group: [{ c: [10, 12, 4] }, { c: [22, 12, 4] }, { c: [16, 22, 4] }],
  crew: [
    { c: [16, 16, 6], dash: [2.5, 2] },
    { d: 'M10 10a8.5 8.5 0 0 1 12 0' },
    { r: [8, 9, 3, 5, 1] },
    { r: [21, 9, 3, 5, 1] },
  ],
  boom: [{ d: 'M5 26L22 9' }, { r: [21, 4, 5, 10, 2.5], rot: [45, 23.5, 9] }, { c: [6, 26, 2] }],
  monitor: [{ r: [5, 6, 22, 14, 2] }, { d: 'M16 20v4M10 27h12' }, { d: 'M9 10h6', w: 1 }],
  recorder: [
    { r: [5, 9, 22, 15, 2] },
    { c: [11, 18, 2.5] },
    { c: [20, 18, 2.5] },
    { d: 'M10 13h12' },
  ],
  table: [{ r: [5, 9, 22, 14, 2] }],
  chair: [{ r: [10, 12, 12, 11, 2] }, { d: 'M10 9h12' }],
  sofa: [{ r: [4, 10, 24, 13, 3] }, { d: 'M4 15h24M8 15v8M24 15v8' }],
  bed: [{ r: [7, 4, 18, 24, 2] }, { r: [10, 7, 12, 5, 2] }, { d: 'M7 16h18' }],
  wardrobe: [
    { r: [5, 10, 22, 9, 1] },
    { d: 'M5 19l7 6M27 19l-7 6', w: 1, dash: [2, 2] },
    { d: 'M16 10v9' },
  ],
  desk: [{ r: [4, 9, 24, 10, 1.5] }, { r: [13, 21, 7, 6, 1.5] }, { d: 'M9 12h6', w: 1 }],
  stairs: [
    { r: [9, 4, 14, 24, 1] },
    { d: 'M9 9h14M9 13h14M9 17h14M9 21h14M9 25h14', w: 1 },
    { d: 'M16 26V7M13.5 9.5L16 7l2.5 2.5' },
  ],
  door: [{ d: 'M5 26h4M23 26h4M9 26V10' }, { d: 'M9 10a16 16 0 0 1 14 16', dash: [2.5, 2.5] }],
  window: [{ r: [3, 13, 26, 6, 0] }, { d: 'M3 16h26' }],
  wall: [{ r: [3, 13, 26, 6, 0] }, { d: 'M7 19l6-6M13 19l6-6M19 19l6-6', w: 1 }],
  column: [{ r: [9, 9, 14, 14, 1] }, { d: 'M9 9l14 14M23 9L9 23', w: 1 }],
  tree: [
    {
      d: 'M16 4c4 0 5 3 7 3.5 3 1 4 4 3 6.5 1.5 2.5.5 6-2.5 7-1 3-4.5 4.5-7.5 3.5-3 1-6.5-.5-7.5-3.5-3-1-4-4.5-2.5-7-1-2.5 0-5.5 3-6.5C11 7 12 4 16 4z',
    },
    { c: [16, 16, 2] },
  ],
  car: [{ r: [9, 3, 14, 26, 5] }, { d: 'M11 10h10M11 21h10' }, { d: 'M9 13H7M23 13h2', w: 1 }],
  road: [{ d: 'M4 9h24M4 23h24' }, { d: 'M4 16h24', dash: [3, 3] }, { d: 'M4 5h24', w: 1, o: 0.6 }],
  arrow: [{ d: 'M6 24C10 12 18 9 26 9' }, { d: 'M21 5l5 4-4 5' }],
  text: [{ d: 'M8 8h16M16 8v17M12 25h8' }],
  measure: [
    { d: 'M5 16h22M5 12v8M27 12v8' },
    { d: 'M9 16l2-2M9 16l2 2M23 16l-2-2M23 16l-2 2', w: 1 },
  ],
  zone: [
    { d: 'M6 8l18-2 3 15-17 5z', dash: [3, 2.5] },
    { d: 'M12 15h8', w: 1 },
  ],
} satisfies Record<string, GlyphPart[]>;

/** What an icon is, for its colour, its layer and how it resizes. */
export type PlanFamily = 'light' | 'camera' | 'person' | 'ink';

export interface PlanCategory {
  id: 'lights' | 'grip' | 'camera' | 'people' | 'av' | 'furniture' | 'exterior';
  family: PlanFamily;
  layer: PlanLayer;
  /** Furniture and exteriors take a free width and depth; the rest scale S, M or L. */
  sized: boolean;
  kinds: readonly PlanIconKind[];
}

/** The library, in its order (the annotation tools follow it in the panel). */
export const PLAN_CATEGORIES: readonly PlanCategory[] = [
  {
    id: 'lights',
    family: 'light',
    layer: 'lights',
    sized: false,
    kinds: ['fresnel', 'led', 'tube', 'softbox', 'lantern', 'para', 'practical', 'sun'],
  },
  {
    id: 'grip',
    family: 'ink',
    layer: 'lights',
    sized: false,
    kinds: ['cstand', 'flag', 'frame', 'bounce', 'gel'],
  },
  {
    id: 'camera',
    family: 'camera',
    layer: 'camera',
    sized: false,
    kinds: ['camera', 'tripod', 'gimbal', 'dolly', 'track', 'slider', 'jib', 'drone', 'carrig'],
  },
  {
    id: 'people',
    family: 'person',
    layer: 'actors',
    sized: false,
    kinds: ['actor', 'group', 'crew'],
  },
  {
    id: 'av',
    family: 'ink',
    layer: 'camera',
    sized: false,
    kinds: ['boom', 'monitor', 'recorder'],
  },
  {
    id: 'furniture',
    family: 'ink',
    layer: 'set',
    sized: true,
    kinds: [
      'table',
      'chair',
      'sofa',
      'bed',
      'wardrobe',
      'desk',
      'stairs',
      'door',
      'window',
      'wall',
      'column',
    ],
  },
  { id: 'exterior', family: 'ink', layer: 'set', sized: true, kinds: ['tree', 'car', 'road'] },
];

/** Annotation tools listed with the icons; they draw shapes, not icons. */
export const PLAN_NOTE_TOOLS = ['arrow', 'text', 'measure', 'zone'] as const;
export type PlanNoteTool = (typeof PLAN_NOTE_TOOLS)[number];

const CATEGORY_OF = new Map<PlanIconKind, PlanCategory>();
for (const c of PLAN_CATEGORIES) for (const k of c.kinds) CATEGORY_OF.set(k, c);
// The light of version 14 plans: a Fresnel by another name.
CATEGORY_OF.set('light', PLAN_CATEGORIES[0] as PlanCategory);

export function categoryOf(kind: PlanIconKind): PlanCategory {
  return CATEGORY_OF.get(kind) ?? (PLAN_CATEGORIES[0] as PlanCategory);
}

/**
 * Kinds that take a free width and depth: furniture, exteriors, and the dolly track and the
 * diffusion frame, whose length is what the crew needs ("Binario 3 m", "Diffusore 1,2 m").
 */
export function isSized(kind: PlanIconKind): boolean {
  return categoryOf(kind).sized || kind === 'track' || kind === 'frame';
}

export function glyphOf(kind: PlanIconKind | PlanNoteTool): GlyphPart[] {
  return GLYPHS[(kind === 'light' ? 'fresnel' : kind) as GlyphName];
}

/** Kinds whose light falls in a beam; cameras have a view cone instead. */
export const BEAM_KINDS: ReadonlySet<PlanIconKind> = new Set([
  'light',
  'fresnel',
  'led',
  'tube',
  'softbox',
  'para',
  'sun',
]);

/**
 * Angle each glyph faces in its drawing, in degrees clockwise from right: an icon's `rotation`
 * is where it faces, so the glyph turns by the difference.
 */
export const GLYPH_FACING: Partial<Record<PlanIconKind, number>> = { actor: 90 };

// Flattening ---------------------------------------------------------------------

/** A glyph part as a polyline in glyph units, for exports, hit tests and boxes. */
export interface FlatPart {
  points: number[];
  closed: boolean;
  width: number;
  dash?: number[];
  opacity?: number;
}

function arcPoints(
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  large: boolean,
  sweep: boolean,
  x1: number,
  y1: number,
): number[] {
  // Endpoint to centre parameterisation (SVG 1.1, F.6.5), without x-axis rotation.
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const den = rx * rx * dy * dy + ry * ry * dx * dx;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx = (k * rx * dy) / ry + (x0 + x1) / 2;
  const cy = (-k * ry * dx) / rx + (y0 + y1) / 2;
  const a0 = Math.atan2((y0 - cy) / ry, (x0 - cx) / rx);
  let a1 = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx);
  if (sweep && a1 < a0) a1 += Math.PI * 2;
  if (!sweep && a1 > a0) a1 -= Math.PI * 2;
  const out: number[] = [];
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return out;
}

/** The subpaths of an SVG path of M, L, H, V, C, A and Z commands, absolute or relative. */
export function flattenPath(d: string): Array<{ points: number[]; closed: boolean }> {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Array<{ points: number[]; closed: boolean }> = [];
  let current: { points: number[]; closed: boolean } | null = null;
  let x = 0;
  let y = 0;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i] as string)) cmd = tokens[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toLowerCase()) {
      case 'm':
        x = ox + num();
        y = oy + num();
        current = { points: [x, y], closed: false };
        out.push(current);
        // Pairs after a move are lines.
        cmd = rel ? 'l' : 'L';
        break;
      case 'l':
        x = ox + num();
        y = oy + num();
        current?.points.push(x, y);
        break;
      case 'h':
        x = ox + num();
        current?.points.push(x, y);
        break;
      case 'v':
        y = oy + num();
        current?.points.push(x, y);
        break;
      case 'c': {
        const [c1x, c1y, c2x, c2y, ex, ey] = [num(), num(), num(), num(), num(), num()].map(
          (v, n) => v + (n % 2 === 0 ? ox : oy),
        ) as [number, number, number, number, number, number];
        for (let t = 1; t <= 10; t++) {
          const s = t / 10;
          const u = 1 - s;
          current?.points.push(
            u * u * u * x + 3 * u * u * s * c1x + 3 * u * s * s * c2x + s * s * s * ex,
            u * u * u * y + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s * s * s * ey,
          );
        }
        x = ex;
        y = ey;
        break;
      }
      case 'a': {
        const rx = num();
        const ry = num();
        num();
        const large = num() === 1;
        const sweep = num() === 1;
        const ex = ox + num();
        const ey = oy + num();
        current?.points.push(...arcPoints(x, y, rx, ry, large, sweep, ex, ey));
        x = ex;
        y = ey;
        break;
      }
      case 'z':
        if (current) {
          current.closed = true;
          x = current.points[0] as number;
          y = current.points[1] as number;
        }
        break;
      default:
        i++;
    }
  }
  return out;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return out;
}

function rectPoints(r: number[], rot?: number[]): number[] {
  const [x, y, w, h, rx = 0] = r as [number, number, number, number, number?];
  const c = Math.min(rx, w / 2, h / 2);
  const pts: number[] = [];
  const corner = (cx: number, cy: number, from: number) => {
    if (c === 0) pts.push(cx + c * Math.cos(from), cy + c * Math.sin(from));
    else
      for (let i = 0; i <= 3; i++) {
        const a = from + (i / 3) * (Math.PI / 2);
        pts.push(cx + c * Math.cos(a), cy + c * Math.sin(a));
      }
  };
  corner(x + w - c, y + c, -Math.PI / 2);
  corner(x + w - c, y + h - c, 0);
  corner(x + c, y + h - c, Math.PI / 2);
  corner(x + c, y + c, Math.PI);
  if (!rot) return pts;
  const [deg, ox, oy] = rot as [number, number, number];
  const t = (deg * Math.PI) / 180;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const px = (pts[i] as number) - ox;
    const py = (pts[i + 1] as number) - oy;
    pts[i] = ox + px * Math.cos(t) - py * Math.sin(t);
    pts[i + 1] = oy + px * Math.sin(t) + py * Math.cos(t);
  }
  return pts;
}

const flatCache = new Map<GlyphPart[], FlatPart[]>();

/** A glyph as polylines in its 32 grid. */
export function flattenGlyph(glyph: GlyphPart[]): FlatPart[] {
  const hit = flatCache.get(glyph);
  if (hit) return hit;
  const out: FlatPart[] = [];
  for (const part of glyph) {
    const style = {
      width: part.w ?? 1.5,
      ...(part.dash ? { dash: part.dash } : {}),
      ...(part.o !== undefined ? { opacity: part.o } : {}),
    };
    if (part.c) {
      const [cx, cy, r] = part.c as [number, number, number];
      out.push({ points: ellipsePoints(cx, cy, r, r), closed: true, ...style });
    } else if (part.r) out.push({ points: rectPoints(part.r, part.rot), closed: true, ...style });
    else if (part.d) for (const sub of flattenPath(part.d)) out.push({ ...sub, ...style });
  }
  flatCache.set(glyph, out);
  return out;
}

/** The drawn box of a glyph, in its 32 grid. */
export function glyphBox(glyph: GlyphPart[]): { x: number; y: number; w: number; h: number } {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const part of flattenGlyph(glyph))
    for (let i = 0; i + 1 < part.points.length; i += 2) {
      x0 = Math.min(x0, part.points[i] as number);
      x1 = Math.max(x1, part.points[i] as number);
      y0 = Math.min(y0, part.points[i + 1] as number);
      y1 = Math.max(y1, part.points[i + 1] as number);
    }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
