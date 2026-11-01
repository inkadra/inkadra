// SPDX-License-Identifier: AGPL-3.0-only
import {
  arrowGeometry,
  arrowPolyline,
  blockingCurve,
  blockingPositions,
  curvePoints,
  decodeStroke,
  flattenGlyph,
  glyphOf,
  iconCone,
  iconPoint,
  iconTransform,
  labelAnchor,
  layerOf,
  PLAN_VIEW_W,
  type PlanItem,
  type Rect,
} from '@inkadra/canvas-core';
import {
  type Element,
  type FrameShape,
  PLAN_ASPECT,
  type PlanIcon,
  type PlanShape,
  type Stroke,
} from '@inkadra/doc-schema';
import type { AssetTrack } from '@inkadra/shared';
import { croppedRotatedSize } from '../image-crop.ts';
import { iconLabel, LABEL_SIZE, measureText, planToken } from '../plan/PlanDrawing.tsx';
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
  | 'tag-green-bg'
  | 'tag-yellow'
  | 'tag-red',
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
  /** The route of a GPX file, drawn over its map. */
  track?(assetId: string): AssetTrack | null;
  boardTitle(boardId: string): string;
  frameLabel(id: string): string;
  /** Width / height of a frame's picture. */
  frameAspect(frame: Extract<Element, { type: 'frame' }>): number;
  /** Shot size, angle, movement, lens and duration on one line. */
  frameMeta(frame: Extract<Element, { type: 'frame' }>): string;
  slugline(scene: Extract<Element, { type: 'scene' }>): string;
  /** Actor or INT./EXT. and the scene count of a character or location, on one line. */
  storyMeta(card: Extract<Element, { type: 'character' | 'location' }>): string;
  /** `plan`: the name of a set plan, in its header. */
  words: { board: string; file: string; plan?: string };
}

const PAD = 12;
/** Side of a character's portrait on its card. */
const PORTRAIT = 56;
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
      const dims = croppedRotatedSize(
        img?.info.width ?? 4,
        img?.info.height ?? 3,
        el.crop,
        el.rotation,
      );
      const pic = (w * dims.height) / dims.width;
      return pic + (el.caption ? lines(el.caption, SMALL, 3) + 12 : 0);
    }
    case 'frame':
      return w / ctx.frameAspect(el) + 52;
    case 'color':
      return w;
    case 'character': {
      const text =
        lines(el.name || ' ', TITLE, 1) +
        (el.role ? lines(el.role, SMALL, 1) : 0) +
        (ctx.storyMeta(el) ? lines(ctx.storyMeta(el), SMALL, 1) : 0);
      return Math.max(PORTRAIT, text + 4) + 20;
    }
    case 'table':
      return el.rows.length * TABLE_ROW;
    case 'plan':
      return PLAN_HEAD + w / PLAN_ASPECT;
    case 'map':
      return (ctx.image(el.imageAssetId) ? (w * 560) / 1024 : 0) + 52;
    case 'location': {
      const pic = ctx.image(el.assetId) ? (w * 9) / 16 : 0;
      return (
        pic +
        20 +
        lines(el.name || ' ', TITLE, 2) +
        (ctx.storyMeta(el) ? lines(ctx.storyMeta(el), SMALL, 1) : 0) +
        (el.light ? lines(el.light, SMALL, 2) + 2 : 0)
      );
    }
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
  // A section heading has no card: large text over a thin rule, as on the board.
  if (el.type === 'section')
    return [
      {
        kind: 'text',
        x: p.x + 2,
        y: p.y + 26,
        text: ellipsize(el.title, p.w - 4, 20, 600, ctx.measure),
        size: 20,
        weight: 600,
        color: c['text-primary'],
      },
      {
        kind: 'line',
        x1: p.x,
        y1: p.y + p.h - 1,
        x2: p.x + p.w,
        y2: p.y + p.h - 1,
        color: c['border-default'],
        width: 1,
      },
    ];
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
  // A column's accent: a bar on the title over a light tint of the header.
  if (el.type === 'column' && el.color)
    inner.unshift(
      { kind: 'rect', x: p.x, y: p.y, w: p.w, h: 40, fill: c[TINTS[el.color]] },
      { kind: 'rect', x: p.x, y: p.y, w: p.w, h: 3, fill: c[`tag-${el.color}`] },
    );
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
      const ops: Op[] = [
        picture(img?.key, pic, 'cover', c, { crop: el.crop, rotation: el.rotation }),
      ];
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
      const track = ctx.track?.(el.assetId) ?? null;
      const ops: Op[] = [];
      let top = p.y + 10;
      if (track) {
        const pic = { x: p.x, y: p.y, w: p.w, h: (p.w * 560) / 1024 };
        ops.push(
          img ? picture(img.key, pic, 'cover', c) : { kind: 'rect', ...pic, fill: c['surface-2'] },
          ...routeOps(track, pic, c),
        );
        top = p.y + pic.h + 10;
      } else if (img) {
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
      return [];
    case 'character': {
      // The face of the card only: contacts and notes stay in the app (decision 0044).
      const ops: Op[] = [];
      const top = p.y + 10;
      const img = ctx.image(el.assetId);
      const box = { x, y: top, w: PORTRAIT, h: PORTRAIT };
      ops.push(
        img
          ? { kind: 'clip', ...box, radius: 8, ops: [picture(img.key, box, 'cover', c)] }
          : { kind: 'rect', ...box, radius: 8, fill: c['surface-2'] },
      );
      const tx = x + PORTRAIT + 10;
      const tw = inner - PORTRAIT - 10;
      const line = (value: string, at: number, style: Omit<TextStyle, 'color'>, color: string) =>
        textBlock(wrapText(value, tw, style.size, style.weight, m, 1), tx, at, { ...style, color });
      const name = line(el.name, top + 4, TITLE, c['text-primary']);
      ops.push(...name.ops);
      let below = name.bottom;
      for (const [value, color] of [
        [el.role, c['text-secondary']],
        [ctx.storyMeta(el), c['text-muted']],
      ] as const) {
        if (!value) continue;
        const block = line(value, below, SMALL, color);
        ops.push(...block.ops);
        below = block.bottom;
      }
      return ops;
    }
    case 'location': {
      const ops: Op[] = [];
      let top = p.y + 10;
      const img = ctx.image(el.assetId);
      if (img) {
        const h = (p.w * 9) / 16;
        ops.push(picture(img.key, { x: p.x, y: p.y, w: p.w, h }, 'cover', c));
        top = p.y + h + 10;
      }
      const name = text(el.name, top, TITLE, c['text-primary'], 2);
      ops.push(...name.ops);
      let below = name.bottom;
      const meta = ctx.storyMeta(el);
      if (meta) {
        const block = text(meta, below, SMALL, c['text-muted'], 1);
        ops.push(...block.ops);
        below = block.bottom;
      }
      if (el.light) ops.push(...text(el.light, below + 2, SMALL, c['text-secondary'], 2).ops);
      return ops;
    }
    case 'section':
      // Drawn by drawCard without a card.
      return [];
    case 'table':
      return tableOps(el, p, c, m);
    case 'plan': {
      const title = [ctx.words.plan, el.title].filter(Boolean).join(' · ');
      const ops: Op[] = [
        {
          kind: 'text',
          x,
          y: p.y + 21,
          text: ellipsize(title, inner, 12, 500, m),
          size: 12,
          weight: 500,
          color: c['text-primary'],
        },
        {
          kind: 'line',
          x1: p.x,
          y1: p.y + PLAN_HEAD,
          x2: p.x + p.w,
          y2: p.y + PLAN_HEAD,
          color: c['border-default'],
          width: 1,
        },
      ];
      const box = { x: p.x, y: p.y + PLAN_HEAD, w: p.w, h: p.w / PLAN_ASPECT };
      return [...ops, ...planOps(el, box, ctx)];
    }
    case 'map': {
      const ops: Op[] = [];
      let top = p.y + 10;
      const img = ctx.image(el.imageAssetId);
      if (img) {
        const pic = { x: p.x, y: p.y, w: p.w, h: (p.w * 560) / 1024 };
        ops.push(
          picture(img.key, pic, 'cover', c),
          ...dot(pic.x + pic.w / 2, pic.y + pic.h / 2, 6, c['tag-red'], c['surface-1']),
        );
        top = p.y + pic.h + 10;
      }
      const name = text(el.name || el.address || '', top, TITLE, c['text-primary'], 1);
      ops.push(...name.ops);
      if (el.address && el.address !== el.name)
        ops.push(...text(el.address, name.bottom, SMALL, c['text-muted'], 1).ops);
      return ops;
    }
  }
}

/** A round dot with a ring, as the pins and route ends on the board. */
function dot(cx: number, cy: number, r: number, fill: string, ring?: string): Op[] {
  const ops: Op[] = [];
  if (ring)
    ops.push({
      kind: 'rect',
      x: cx - r - 2,
      y: cy - r - 2,
      w: 2 * r + 4,
      h: 2 * r + 4,
      radius: r + 2,
      fill: ring,
    });
  ops.push({ kind: 'rect', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, radius: r, fill });
  return ops;
}

/** A GPX route over its map picture: the line and its two ends. */
function routeOps(track: AssetTrack, pic: Rect, c: Palette): Op[] {
  const p = track.points;
  if (p.length < 4) return [];
  const points = p.map((v, i) => (i % 2 === 0 ? pic.x + v * pic.w : pic.y + v * pic.h));
  const [sx, sy] = [points[0] as number, points[1] as number];
  const [ex, ey] = [points[points.length - 2] as number, points[points.length - 1] as number];
  return [
    { kind: 'polyline', points, color: c['tag-green'], width: Math.max(1.5, pic.w / 150) },
    ...dot(sx, sy, 3.5, c['tag-green']),
    ...dot(ex, ey, 3.5, c['tag-red']),
  ];
}

/** Height of a table row in exports, as on the board. */
const TABLE_ROW = 30;

/** A table card: a grid of rows, the header row tinted, each cell on one line. */
function tableOps(
  el: Extract<Element, { type: 'table' }>,
  p: Placed,
  c: Palette,
  m: Measure,
): Op[] {
  const ops: Op[] = [];
  // Set widths keep their share of the card; the others split what is left.
  const set = el.columns.reduce((sum, col) => sum + (col.width ?? 0), 0);
  const free = el.columns.filter((col) => col.width === undefined).length;
  const share = free > 0 ? Math.max(80, (p.w - set) / free) : 0;
  const total = set + share * free;
  const widths = el.columns.map((col) => ((col.width ?? share) * p.w) / total);
  el.rows.forEach((row, r) => {
    const top = p.y + r * TABLE_ROW;
    const head = el.header === true && r === 0;
    if (head)
      ops.push({
        kind: 'rect',
        x: p.x,
        y: top,
        w: p.w,
        h: TABLE_ROW,
        fill: el.color ? c[TINTS[el.color]] : c['surface-2'],
      });
    else if (r > 0)
      ops.push({
        kind: 'line',
        x1: p.x,
        y1: top,
        x2: p.x + p.w,
        y2: top,
        color: c['border-default'],
        width: 1,
      });
    let left = p.x;
    el.columns.forEach((col, i) => {
      const w = widths[i] ?? 0;
      const value = (row.cells[col.id] ?? '').replace(/\s+/g, ' ');
      if (value)
        ops.push({
          kind: 'text',
          x: left + 9,
          y: top + 19,
          text: ellipsize(value, w - 18, head ? 11 : 11.5, head ? 600 : 400, m),
          size: head ? 11 : 11.5,
          weight: head ? 600 : 400,
          color: head
            ? el.color
              ? c[`tag-${el.color}`]
              : c['text-secondary']
            : i === 0
              ? c['text-primary']
              : c['text-secondary'],
        });
      left += w;
    });
  });
  return ops;
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
  transform?: {
    crop?: { x: number; y: number; w: number; h: number } | undefined;
    rotation?: number | undefined;
  },
): Op {
  if (!key) return { kind: 'rect', ...box, fill: c['surface-3'] };
  return {
    kind: 'clip',
    ...box,
    ops: [
      { kind: 'rect', ...box, fill: c['surface-2'] },
      {
        kind: 'image',
        key,
        ...box,
        fit,
        ...(transform?.crop ? { crop: transform.crop } : {}),
        ...(transform?.rotation !== undefined ? { rotation: transform.rotation } : {}),
      },
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

/** Height of a set plan's header, on the board and in exports. */
const PLAN_HEAD = 34;

/** `hex` mixed with `base` (both #RRGGBB), `t` of the way to `hex`; other colours stay. */
function mix(hex: string, base: string, t: number): string {
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

/**
 * A set plan's drawing as vectors, without the grid (decision 0062): strokes, shapes, then the
 * set icons with their labels, in the printed theme's colours.
 */
/** `moves`: blocking moves and numbers, on unless an export leaves them out (round 6, i). */
export function planOps(
  el: Extract<Element, { type: 'plan' }>,
  box: Rect,
  ctx: CardContext,
  moves = true,
): Op[] {
  const c = ctx.colors;
  const ink = (hex: string) => {
    const token = planToken(hex);
    return token ? c[token as keyof Palette] : hex;
  };
  const shown = <T extends PlanItem>(items: readonly T[] | undefined) =>
    (items ?? []).filter((item) => !el.hiddenLayers?.includes(layerOf(item)));
  const k = box.w / PLAN_VIEW_W;
  const at = (x: number, y: number) => ({ x: box.x + x * k, y: box.y + y * k });
  const inside: Op[] = [];
  for (const stroke of shown(el.strokes))
    inside.push(strokeOp({ ...stroke, color: ink(stroke.color) }, box));
  for (const shape of shown(el.shapes))
    inside.push(...planShapeOps(shape, box, ink(shape.color), el.scale, ctx));
  // Blocking: the moves, the veiled earlier positions and the numbers (round 6, d).
  for (const icon of moves ? shown(el.icons) : []) {
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
      if (icon.dashed) inside.push(...dashes(pts, 10 * k, 8 * k, color, w));
      else
        inside.push({ kind: 'polyline', points: pts.flatMap((p) => [p.x, p.y]), color, width: w });
      const end = pts.at(-1) as { x: number; y: number };
      const prev = pts.at(-2) as { x: number; y: number };
      inside.push(head(prev.x, prev.y, end.x, end.y, 14 * k, color));
    }
    for (const step of steps)
      inside.push(
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
      inside.push(
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
  for (const icon of shown(el.icons)) inside.push(...iconOps(icon, ink(icon.color), 1, true));
  return [{ kind: 'clip', ...box, ops: inside }];

  /** An icon: its cone or beam, its glyph and its label; `veil` fades a blocking copy. */
  function iconOps(icon: PlanIcon, base: string, veil: number, full: boolean): Op[] {
    const out: Op[] = [];
    const color = veil < 1 ? mix(base, c['surface-1'], veil) : base;
    const cone = full ? iconCone(icon, el.sensor) : null;
    if (cone) {
      const pts = cone.points.map((p) => at(p.x, p.y));
      const shade = cone.beam ? 0.06 + 0.16 * (icon.intensity ?? 0.8) : 0.14;
      out.push(
        {
          kind: 'polygon',
          points: pts.flatMap((p) => [p.x, p.y]),
          fill: mix(color, c['surface-1'], shade),
        },
        {
          kind: 'polyline',
          points: [...pts, pts[0] as { x: number; y: number }].flatMap((p) => [p.x, p.y]),
          color: mix(color, c['surface-1'], 0.5),
          width: 1.5 * k,
        },
      );
    }
    const t = iconTransform(icon);
    const place = (x: number, y: number) => {
      const q = iconPoint(t, x, y);
      return at(q.x, q.y);
    };
    const width = Math.min(1.6, 1.7 / Math.sqrt(t.sx * t.sy)) * Math.sqrt(t.sx * t.sy) * k;
    const wash = mix(color, c['surface-1'], 0.12);
    for (const part of flattenGlyph(glyphOf(icon.kind))) {
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i + 1 < part.points.length; i += 2)
        pts.push(place(part.points[i] as number, part.points[i + 1] as number));
      if (part.closed && pts[0]) {
        out.push({ kind: 'polygon', points: pts.flatMap((p) => [p.x, p.y]), fill: wash });
        pts.push(pts[0]);
      }
      const w = (width * part.width) / 1.5;
      const stroke = part.opacity !== undefined ? mix(color, c['surface-1'], part.opacity) : color;
      if (part.dash)
        out.push(
          ...dashes(
            pts,
            (part.dash[0] as number) * w,
            (part.dash[1] ?? (part.dash[0] as number)) * w,
            stroke,
            w,
          ),
        );
      else
        out.push({
          kind: 'polyline',
          points: pts.flatMap((p) => [p.x, p.y]),
          color: stroke,
          width: w,
        });
    }
    const label = iconLabel(icon);
    if (label && full) {
      const a = labelAnchor(icon);
      const size = LABEL_SIZE * k;
      out.push({
        kind: 'text',
        x: box.x + a.x * k - ctx.measure(label, size, 500) / 2,
        y: box.y + a.y * k,
        text: label,
        size,
        weight: 500,
        color,
      });
    }
    return out;
  }
}

/** A plan shape: zones and measures, and frame shapes turned by their rotation. */
function planShapeOps(
  shape: PlanShape,
  box: Rect,
  color: string,
  scale: number | undefined,
  ctx: CardContext,
): Op[] {
  const c = ctx.colors;
  const g = (v: number, size: number) => (v / 4096) * size;
  const x0 = box.x + g(shape.x0, box.w);
  const y0 = box.y + g(shape.y0, box.h);
  const x1 = box.x + g(shape.x1, box.w);
  const y1 = box.y + g(shape.y1, box.h);
  const width = (shape.width / 1000) * box.w;
  if (shape.kind === 'measure') {
    const label = measureText(shape, scale);
    const ops: Op[] = [
      { kind: 'line', x1: x0, y1: y0, x2: x1, y2: y1, color, width: (2 / 1000) * box.w },
    ];
    if (label) {
      const size = (18 / 1000) * box.w;
      const w = ctx.measure(label, size, 600);
      ops.push(
        {
          kind: 'rect',
          x: (x0 + x1) / 2 - w / 2 - 4,
          y: (y0 + y1) / 2 - size,
          w: w + 8,
          h: size * 1.6,
          radius: 3,
          fill: c['surface-1'],
          stroke: color,
          lineWidth: 0.75,
        },
        {
          kind: 'text',
          x: (x0 + x1) / 2 - w / 2,
          y: (y0 + y1) / 2 + size * 0.35,
          text: label,
          size,
          weight: 600,
          color: c['text-primary'],
        },
      );
    }
    return ops;
  }
  const turned = (ops: Op[]): Op[] => {
    if (!shape.rotation) return ops;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const t = (shape.rotation * Math.PI) / 180;
    const pts = (p: readonly number[]) =>
      p.map((v, i) =>
        i % 2 === 0
          ? cx + (v - cx) * Math.cos(t) - ((p[i + 1] as number) - cy) * Math.sin(t)
          : cy + ((p[i - 1] as number) - cx) * Math.sin(t) + (v - cy) * Math.cos(t),
      );
    return ops.map((op) => {
      if (op.kind === 'polyline' || op.kind === 'polygon') return { ...op, points: pts(op.points) };
      if (op.kind === 'ellipse') {
        const ring: number[] = [];
        for (let i = 0; i <= 32; i++) {
          const a = (i / 32) * Math.PI * 2;
          ring.push(op.cx + op.rx * Math.cos(a), op.cy + op.ry * Math.sin(a));
        }
        return { kind: 'polyline', points: pts(ring), color: op.stroke, width: op.width };
      }
      // shortcut: exported texts stay level; turned texts print unturned until text ops can turn.
      return op;
    });
  };
  if (shape.kind === 'zone') {
    const corners = [x0, y0, x1, y0, x1, y1, x0, y1];
    const ring = [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
    const edge: Array<{ x: number; y: number }> = [];
    const turnedRing = (
      turned([{ kind: 'polyline', points: ring, color, width }])[0] as { points: number[] }
    ).points;
    for (let i = 0; i + 1 < turnedRing.length; i += 2)
      edge.push({ x: turnedRing[i] as number, y: turnedRing[i + 1] as number });
    const ops: Op[] = [
      ...turned([{ kind: 'polygon', points: corners, fill: mix(color, c['surface-1'], 0.1) }]),
      ...dashes(edge, width * 3, width * 2.5, color, width),
    ];
    if (shape.text) {
      const size = (18 / 1000) * box.w;
      ops.push({
        kind: 'text',
        x: Math.min(x0, x1) + 0.01 * box.w,
        y: Math.min(y0, y1) + size * 1.3,
        text: shape.text,
        size,
        weight: 400,
        color,
      });
    }
    return ops;
  }
  return turned(shapeOps({ ...shape, kind: shape.kind, color }, box));
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
