// SPDX-License-Identifier: AGPL-3.0-only
import { arrowGeometry, arrowPolyline, decodeStroke, type Rect } from '@inkadra/canvas-core';
import type { Element, FrameShape, Stroke } from '@inkadra/doc-schema';
import type { Placed } from './board-model.ts';
import type { ImageInfo, Measure, Op } from './pages.ts';
import { ellipsize, lineHeight, type TextStyle, textBlock, wrapText } from './text.ts';

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
  | 'tag-green-bg',
  string
>;

/** A block of a note's rich text, flattened for print. */
export interface NoteBlock {
  kind: 'p' | 'h1' | 'h2' | 'h3' | 'li' | 'quote' | 'code';
  text: string;
  /** For list items: done or not in a task list, undefined in a bullet list. */
  checked?: boolean;
}

export interface CardContext {
  measure: Measure;
  colors: Palette;
  noteBlocks(id: string): NoteBlock[];
  image(assetId: string | undefined): { key: string; info: ImageInfo } | null;
  fileName(assetId: string): string;
  boardTitle(boardId: string): string;
  frameLabel(id: string): string;
  /** Width / height of a frame's picture. */
  frameAspect(frame: Extract<Element, { type: 'frame' }>): number;
  /** Shot size, angle, movement, lens and duration on one line. */
  frameMeta(frame: Extract<Element, { type: 'frame' }>): string;
  slugline(scene: Extract<Element, { type: 'scene' }>): string;
  words: { board: string; file: string };
}

const PAD = 12;
const RADIUS = 10;
const BODY: Omit<TextStyle, 'color'> = { size: 13, weight: 400, leading: 19.5 };
const SMALL: Omit<TextStyle, 'color'> = { size: 11, weight: 400, leading: 16 };
const TITLE: Omit<TextStyle, 'color'> = { size: 13, weight: 500, leading: 19.5 };

function noteStyle(kind: NoteBlock['kind']): Omit<TextStyle, 'color'> {
  if (kind === 'h1') return { size: 20, weight: 600, leading: 26 };
  if (kind === 'h2') return { size: 17, weight: 600, leading: 23 };
  if (kind === 'h3') return { size: 15, weight: 600, leading: 21 };
  return BODY;
}

/** Height a card needs at width `w`, for cards stacked in a column (not measured there). */
export function cardHeight(el: Element, w: number, ctx: CardContext): number | null {
  const inner = w - PAD * 2;
  const lines = (text: string, style: Omit<TextStyle, 'color'>, max?: number) =>
    wrapText(text, inner, style.size, style.weight, ctx.measure, max).length *
    lineHeight({ ...style, color: '' });
  switch (el.type) {
    case 'note': {
      const blocks = ctx.noteBlocks(el.id);
      const body = blocks.reduce((sum, b) => sum + lines(b.text || ' ', noteStyle(b.kind)), 0);
      return Math.max(44, body + 20);
    }
    case 'todo':
      return 20 + (el.title ? lineHeight({ ...TITLE, color: '' }) + 4 : 0) + el.items.length * 24;
    case 'image': {
      const img = ctx.image(el.assetId);
      const pic = img ? (w * img.info.height) / img.info.width : w * 0.75;
      return pic + (el.caption ? lines(el.caption, SMALL, 3) + 12 : 0);
    }
    case 'frame':
      return w / ctx.frameAspect(el) + 52;
    case 'color':
      return w;
    default:
      return null;
  }
}

/** Operations for the cards of a board, in board units (the caller scales them). */
export function drawBoard(items: readonly Placed[], ctx: CardContext): Op[] {
  const rects = new Map<string, Rect>();
  const collect = (p: Placed) => {
    rects.set(p.el.id, p);
    p.children?.forEach(collect);
  };
  items.forEach(collect);
  const ops: Op[] = [];
  for (const item of items) {
    if (item.el.type === 'arrow')
      ops.push(...drawArrow(item.el, (id) => rects.get(id) ?? null, ctx));
    else ops.push(...drawCard(item, ctx));
  }
  return ops;
}

export function drawCard(p: Placed, ctx: CardContext): Op[] {
  const { el } = p;
  const c = ctx.colors;
  const tint =
    el.type === 'note' && el.color && el.color in TINTS
      ? c[TINTS[el.color as keyof typeof TINTS]]
      : undefined;
  const container = el.type === 'column' || el.type === 'scene';
  const frame: Op = {
    kind: 'rect',
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    radius: RADIUS,
    fill: tint ?? (container ? c['surface-2'] : c['surface-1']),
    stroke: c['border-default'],
    lineWidth: 1,
  };
  const inner = body(p, ctx);
  return [frame, { kind: 'clip', x: p.x, y: p.y, w: p.w, h: p.h, radius: RADIUS, ops: inner }];
}

const TINTS = {
  blue: 'tag-blue-bg',
  orange: 'tag-orange-bg',
  purple: 'tag-purple-bg',
  green: 'tag-green-bg',
} as const;

function body(p: Placed, ctx: CardContext): Op[] {
  const { el } = p;
  const c = ctx.colors;
  const m = ctx.measure;
  const x = p.x + PAD;
  const inner = p.w - PAD * 2;
  const text = (
    value: string,
    top: number,
    style: Omit<TextStyle, 'color'>,
    color: string,
    max?: number,
  ) =>
    textBlock(wrapText(value, inner, style.size, style.weight, m, max), x, top, {
      ...style,
      color,
    });
  switch (el.type) {
    case 'note': {
      const ops: Op[] = [];
      let top = p.y + 10;
      for (const block of ctx.noteBlocks(el.id)) {
        const style = noteStyle(block.kind);
        const indent = block.kind === 'li' || block.kind === 'quote' ? 16 : 0;
        if (block.kind === 'li') {
          if (block.checked === undefined) {
            ops.push({
              kind: 'text',
              x,
              y: top + 14,
              text: '•',
              size: 13,
              weight: 400,
              color: c['text-secondary'],
            });
          } else {
            ops.push(...checkbox(x, top + 4.5, block.checked, c));
          }
        }
        if (block.kind === 'quote') {
          ops.push({
            kind: 'line',
            x1: x + 2,
            y1: top + 2,
            x2: x + 2,
            y2: top + 17,
            color: c['border-strong'],
            width: 2,
          });
        }
        const lines = wrapText(block.text, inner - indent, style.size, style.weight, m);
        const done = block.checked === true;
        const out = textBlock(lines.length ? lines : [''], x + indent, top, {
          ...style,
          color: done || block.kind === 'quote' ? c['text-secondary'] : c['text-primary'],
        });
        ops.push(...out.ops);
        top = out.bottom;
      }
      return ops;
    }
    case 'image': {
      const img = ctx.image(el.assetId);
      const captionLines = el.caption
        ? wrapText(el.caption, inner, SMALL.size, SMALL.weight, m, 3)
        : [];
      const captionH = captionLines.length ? captionLines.length * (SMALL.leading ?? 16) + 12 : 0;
      const pic = { x: p.x, y: p.y, w: p.w, h: Math.max(1, p.h - captionH) };
      const ops: Op[] = [picture(img?.key, pic, 'cover', c)];
      if (captionLines.length) {
        ops.push(
          ...textBlock(captionLines, x, pic.y + pic.h + 6, { ...SMALL, color: c['text-secondary'] })
            .ops,
        );
      }
      return ops;
    }
    case 'link': {
      const ops: Op[] = [];
      let top = p.y + 10;
      const img = ctx.image(el.imageAssetId);
      if (img) {
        const h = Math.min(p.w * 0.52, (p.w * img.info.height) / img.info.width);
        ops.push(picture(img.key, { x: p.x, y: p.y, w: p.w, h }, 'cover', c));
        top = p.y + h + 10;
      }
      const host = hostOf(el.url);
      const title = text(el.title || host, top, TITLE, c['text-primary'], 2);
      ops.push(...title.ops);
      const hostLine = text(host, title.bottom, SMALL, c['text-muted'], 1);
      ops.push(...hostLine.ops);
      if (el.description)
        ops.push(...text(el.description, hostLine.bottom + 2, SMALL, c['text-secondary'], 3).ops);
      return ops;
    }
    case 'file': {
      const name = ctx.fileName(el.assetId);
      const img = ctx.image(el.assetId);
      const ops: Op[] = [];
      let top = p.y + 10;
      if (img) {
        const h = Math.min(p.w * 0.6, (p.w * img.info.height) / img.info.width);
        ops.push(picture(img.key, { x: p.x, y: p.y, w: p.w, h }, 'cover', c));
        top = p.y + h + 10;
      } else {
        const ext = (name.split('.').pop() ?? '').slice(0, 4).toUpperCase() || ctx.words.file;
        ops.push({ kind: 'rect', x, y: top, w: 30, h: 30, radius: 6, fill: c['surface-2'] });
        ops.push({
          kind: 'text',
          x: x + 15 - m(ext, 8, 600) / 2,
          y: top + 18,
          text: ext,
          size: 8,
          weight: 600,
          color: c['text-secondary'],
        });
        top += 38;
      }
      const title = text(name, top, TITLE, c['text-primary'], 2);
      ops.push(...title.ops);
      if (el.caption)
        ops.push(...text(el.caption, title.bottom, SMALL, c['text-secondary'], 3).ops);
      return ops;
    }
    case 'todo': {
      const ops: Op[] = [];
      let top = p.y + 10;
      if (el.title) {
        const t = text(el.title, top, TITLE, c['text-primary'], 1);
        ops.push(...t.ops);
        top = t.bottom + 4;
      }
      for (const item of el.items) {
        ops.push(...checkbox(x, top + 4.5, item.done, c));
        const line = ellipsize(item.text, inner - 20, 13, 400, m);
        ops.push({
          kind: 'text',
          x: x + 20,
          y: top + 15,
          text: line,
          size: 13,
          weight: 400,
          color: item.done ? c['text-muted'] : c['text-primary'],
        });
        top += 24;
      }
      return ops;
    }
    case 'color': {
      // The swatch is the content: its colour is what the card means.
      const meta = 44;
      const ops: Op[] = [
        { kind: 'rect', x: p.x, y: p.y, w: p.w, h: Math.max(0, p.h - meta), fill: el.hex },
      ];
      const top = p.y + p.h - meta + 6;
      if (el.label)
        ops.push({
          kind: 'text',
          x,
          y: top + 14,
          text: ellipsize(el.label, inner, 13, 500, m),
          size: 13,
          weight: 500,
          color: c['text-primary'],
        });
      ops.push({
        kind: 'text',
        x,
        y: top + (el.label ? 30 : 20),
        text: el.hex,
        size: 11,
        weight: 400,
        color: c['text-secondary'],
      });
      return ops;
    }
    case 'board': {
      const ops: Op[] = [];
      ops.push({
        kind: 'rect',
        x,
        y: p.y + 12,
        w: 28,
        h: 28,
        radius: 6,
        fill: c['surface-2'],
        stroke: c['border-default'],
        lineWidth: 1,
      });
      ops.push(...text(ctx.boardTitle(el.boardId), p.y + 46, TITLE, c['text-primary'], 2).ops);
      ops.push({
        kind: 'text',
        x,
        y: p.y + p.h - 12,
        text: ctx.words.board,
        size: 11,
        weight: 400,
        color: c['text-muted'],
      });
      return ops;
    }
    case 'column':
    case 'scene': {
      const ops: Op[] = [];
      if (el.type === 'scene') {
        const slug = [el.number, ctx.slugline(el)].filter(Boolean).join('  ');
        ops.push({
          kind: 'text',
          x,
          y: p.y + 20,
          text: ellipsize(slug, inner, 11, 600, m),
          size: 11,
          weight: 600,
          color: c['text-secondary'],
        });
        ops.push({
          kind: 'text',
          x,
          y: p.y + 37,
          text: ellipsize(el.title, inner, 13, 500, m),
          size: 13,
          weight: 500,
          color: c['text-primary'],
        });
      } else {
        ops.push({
          kind: 'text',
          x,
          y: p.y + 24,
          text: ellipsize(el.title, inner, 13, 600, m),
          size: 13,
          weight: 600,
          color: c['text-primary'],
        });
      }
      for (const child of p.children ?? []) ops.push(...drawCard(child, ctx));
      return ops;
    }
    case 'frame': {
      const pic = { x: p.x + 6, y: p.y + 6, w: p.w - 12, h: (p.w - 12) / ctx.frameAspect(el) };
      const ops: Op[] = framePicture(el, pic, ctx);
      const top = pic.y + pic.h + 8;
      ops.push({
        kind: 'text',
        x: p.x + 8,
        y: top + 13,
        text: ctx.frameLabel(el.id),
        size: 13,
        weight: 600,
        color: c['text-primary'],
      });
      const meta = ctx.frameMeta(el);
      const action = el.action ?? '';
      ops.push(
        ...textBlock(wrapText(meta || action, p.w - 16, 11, 400, m, 2), p.x + 8, top + 18, {
          ...SMALL,
          color: c['text-secondary'],
        }).ops,
      );
      return ops;
    }
    case 'arrow':
    // Story bible cards are drawn by their implementation (decision 0044).
    case 'character':
    case 'location':
      return [];
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function checkbox(x: number, y: number, done: boolean, c: Palette): Op[] {
  const box: Op = {
    kind: 'rect',
    x,
    y,
    w: 12,
    h: 12,
    radius: 3,
    stroke: c['border-strong'],
    lineWidth: 1.2,
    fill: done ? c['text-secondary'] : c['surface-1'],
  };
  if (!done) return [box];
  return [
    box,
    {
      kind: 'polyline',
      points: [x + 3, y + 6.2, x + 5.2, y + 8.5, x + 9.2, y + 3.8],
      color: c['surface-1'],
      width: 1.5,
    },
  ];
}

/** A picture, or a quiet placeholder where it could not be loaded. */
export function picture(
  key: string | undefined,
  box: Rect,
  fit: 'cover' | 'contain',
  c: Palette,
): Op {
  if (!key) return { kind: 'rect', ...box, fill: c['surface-3'] };
  return {
    kind: 'clip',
    ...box,
    ops: [
      { kind: 'rect', ...box, fill: c['surface-2'] },
      { kind: 'image', key, ...box, fit },
    ],
  };
}

/** A frame's picture: the reference image, then the pen strokes, then the shapes. */
export function framePicture(
  frame: Extract<Element, { type: 'frame' }>,
  box: Rect,
  ctx: CardContext,
): Op[] {
  const c = ctx.colors;
  const inside: Op[] = [{ kind: 'rect', ...box, fill: c['surface-1'] }];
  const img = ctx.image(frame.assetId);
  if (img)
    inside.push({
      kind: 'image',
      key: img.key,
      ...box,
      fit: 'cover',
      opacity: frame.referenceOpacity ?? 1,
    });
  for (const stroke of frame.strokes ?? []) inside.push(strokeOp(stroke, box));
  for (const shape of frame.shapes ?? []) inside.push(...shapeOps(shape, box));
  return [
    { kind: 'clip', ...box, radius: 4, ops: inside },
    { kind: 'rect', ...box, radius: 4, stroke: c['border-default'], lineWidth: 0.75 },
  ];
}

function strokeOp(stroke: Stroke, box: Rect): Op {
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

function shapeOps(shape: FrameShape, box: Rect): Op[] {
  const g = (v: number, size: number) => (v / 4096) * size;
  const x0 = box.x + g(shape.x0, box.w);
  const y0 = box.y + g(shape.y0, box.h);
  const x1 = box.x + g(shape.x1, box.w);
  const y1 = box.y + g(shape.y1, box.h);
  const width = (shape.width / 1000) * box.w;
  switch (shape.kind) {
    case 'rect':
      return [
        {
          kind: 'polyline',
          points: [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0],
          color: shape.color,
          width,
        },
      ];
    case 'ellipse':
      return [
        {
          kind: 'ellipse',
          cx: (x0 + x1) / 2,
          cy: (y0 + y1) / 2,
          rx: Math.abs(x1 - x0) / 2,
          ry: Math.abs(y1 - y0) / 2,
          stroke: shape.color,
          width,
        },
      ];
    case 'line':
      return [{ kind: 'polyline', points: [x0, y0, x1, y1], color: shape.color, width }];
    case 'arrow':
      return [
        { kind: 'polyline', points: [x0, y0, x1, y1], color: shape.color, width },
        head(x0, y0, x1, y1, Math.max(width * 3, 6), shape.color),
      ];
    case 'text': {
      const size = width;
      const lines = (shape.text ?? '').split('\n');
      return lines.map(
        (text, i) =>
          ({
            kind: 'text',
            x: x0,
            y: y0 + size * (0.9 + i * 1.25),
            text,
            size,
            weight: 500,
            color: shape.color,
          }) satisfies Op,
      );
    }
  }
}

function head(x0: number, y0: number, x1: number, y1: number, size: number, color: string): Op {
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

function drawArrow(
  el: Extract<Element, { type: 'arrow' }>,
  rectOf: (id: string) => Rect | null,
  ctx: CardContext,
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
function dashes(
  points: readonly { x: number; y: number }[],
  on: number,
  off: number,
  color: string,
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
        ops.push({ kind: 'line', x1: p.x, y1: p.y, x2: next.x, y2: next.y, color, width: 1.5 });
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
