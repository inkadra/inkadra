// SPDX-License-Identifier: AGPL-3.0-only
import { type Rect, variantView } from '@inkadra/canvas-core';
import { type Element, type FrameShape, PLAN_ASPECT } from '@inkadra/doc-schema';
import {
  drawArrow,
  framedPlanOps,
  head,
  type Palette,
  type PlanDrawContext,
  strokeOp,
} from '@inkadra/print';
import type { AssetTrack } from '@inkadra/shared';
import { dark, light } from '@inkadra/ui/tokens';
import { croppedRotatedSize } from '../image-crop.ts';
import { videoEmbedUrl } from '../youtube.ts';
import type { Placed } from './board-model.ts';
import { type ImageInfo, imagePlacement, type Measure, type Op } from './pages.ts';
import { ellipsize, lineHeight, type TextStyle, textBlock, wrapText } from './text.ts';

// Moved to @inkadra/print (decision 0116); callers import them here.
export type { Palette } from '@inkadra/print';
export { framedPlanOps, planOps, transformOps } from '@inkadra/print';

/** A block of a note's rich text, flattened for print. */
export interface NoteBlock {
  kind: 'p' | 'h1' | 'h2' | 'h3' | 'li' | 'quote' | 'code';
  text: string;
  /** For list items: done or not in a task list, undefined in a bullet list. */
  checked?: boolean;
}

/** What a board export's drawing reads; a plan's drawing reads only its `PlanDrawContext` part. */
export interface CardContext extends PlanDrawContext {
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
  /** Role and age of a character, as on its card. */
  characterLine(card: Extract<Element, { type: 'character' }>): string;
  /** Actor or INT./EXT. and the scene count of a character or location, on one line. */
  storyMeta(card: Extract<Element, { type: 'character' | 'location' }>): string;
  /** `plan`: the name of a set plan, when no `planCard` gives its card's words. */
  words: { board: string; file: string; plan?: string };
  /**
   * The words of a plan's card as the board shows them under its drawing (decision 0119): its
   * name, its scenes ("Scene 2") and its counts ("3 setups", "2 cameras").
   */
  planCard?(el: Extract<Element, { type: 'plan' }>): {
    title: string;
    scenes: string;
    chips: readonly string[];
  };
  /** Another element of the board: the base of a plan variant, whose Set layer it shows. */
  element?(id: string): Element | undefined;
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
        (ctx.characterLine(el) ? lines(ctx.characterLine(el), SMALL, 1) : 0) +
        (ctx.storyMeta(el) ? lines(ctx.storyMeta(el), SMALL, 1) : 0);
      return Math.max(PORTRAIT, text + 4) + 20;
    }
    case 'table':
      return el.rows.length * TABLE_ROW;
    case 'plan':
      return w / PLAN_ASPECT + PLAN_FOOT;
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
  // A section heading has no card: large text, on its tint if it has one, as on the board.
  if (el.type === 'section') {
    const size = el.size ? { S: 20, M: 26, L: 34 }[el.size] : 20;
    const weight = el.bold === undefined ? 600 : el.bold ? 700 : 400;
    // Inkadra's white and black are pieces of a theme, on the board too.
    const surface = el.background === 'white' ? light : el.background === 'black' ? dark : null;
    const color = el.color ? (surface ?? light)[`tag-${el.color}`] : (surface ?? c)['text-primary'];
    const inset = el.background ? 12 : 2;
    const title = ellipsize(el.title, p.w - inset * 2, size, weight, ctx.measure);
    const width = ctx.measure(title, size, weight);
    const x =
      el.align === 'center'
        ? p.x + (p.w - width) / 2
        : el.align === 'right'
          ? p.x + p.w - width - inset
          : p.x + inset;
    const text: Op = { kind: 'text', x, y: p.y + size + 6, text: title, size, weight, color };
    if (!el.background) return [text];
    const box = { kind: 'rect', x: p.x, y: p.y, w: p.w, h: p.h, radius: RADIUS } as const;
    if (surface)
      return [
        { ...box, fill: surface['bg-canvas'], stroke: surface['border-default'], lineWidth: 1 },
        text,
      ];
    if (el.background === 'white' || el.background === 'black') return [text];
    return [{ ...box, fill: light[`tag-${el.background}-bg`] }, text];
  }
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

/** What is inside a card, without its box. */
export function body(p: Placed, ctx: CardContext): Op[] {
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
      if (img && el.strokes?.length) {
        const placement = imagePlacement(img.info, {
          ...pic,
          fit: 'cover',
          crop: el.crop,
          rotation: el.rotation,
        });
        const rad = (placement.rotation * Math.PI) / 180;
        const drawing = el.strokes.map((stroke): Op => {
          const points: number[] = [];
          for (let i = 0; i < stroke.points.length; i += 2) {
            const x = (stroke.points[i]! / 4096 - 0.5) * placement.drawW;
            const y = (stroke.points[i + 1]! / 4096 - 0.5) * placement.drawH;
            points.push(
              placement.cx + x * Math.cos(rad) - y * Math.sin(rad),
              placement.cy + x * Math.sin(rad) + y * Math.cos(rad),
            );
          }
          return {
            kind: 'polyline',
            points,
            color: stroke.color,
            width: (stroke.width / 1000) * placement.drawW,
            opacity: stroke.opacity,
          };
        });
        ops.push({ kind: 'clip', ...pic, ops: drawing });
      }
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
      if (img && (videoEmbedUrl(el.url) ? el.showPreview !== false : el.showInfo !== false)) {
        const h = Math.min(p.w * 0.52, (p.w * img.info.height) / img.info.width);
        ops.push(picture(img.key, { x: p.x, y: p.y, w: p.w, h }, 'cover', c));
        top = p.y + h + 10;
      }
      const host = hostOf(el.url);
      const title = text(
        el.showInfo === false ? el.url : el.title || host,
        top,
        TITLE,
        c['text-primary'],
        2,
      );
      ops.push(...title.ops);
      if (el.showInfo === false) return ops;
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
        [ctx.characterLine(el), c['text-secondary']],
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
      const base = el.variantOf ? ctx.element?.(el.variantOf) : undefined;
      // A setup's Set and title are its base's (decisions 0062 and 0117).
      const drawn = base?.type === 'plan' ? variantView(el, base) : el;
      // As the card on the board (decision 0119): the drawing, then its name, scenes and counts.
      const words = ctx.planCard?.(el) ?? {
        title:
          el.variantOf && el.variant
            ? [drawn.title || ctx.words.plan, el.variant].filter(Boolean).join(' · ')
            : [ctx.words.plan, drawn.title].filter(Boolean).join(' · '),
        scenes: '',
        chips: [],
      };
      const box = { x: p.x, y: p.y, w: p.w, h: p.w / PLAN_ASPECT };
      const foot = box.y + box.h;
      const sceneW = words.scenes ? m(words.scenes, 11, 600) : 0;
      const ops: Op[] = [
        ...framedPlanOps(drawn, box, ctx),
        {
          kind: 'line',
          x1: p.x,
          y1: foot,
          x2: p.x + p.w,
          y2: foot,
          color: c['border-default'],
          width: 1,
        },
        {
          kind: 'text',
          x,
          y: foot + 20,
          text: ellipsize(words.title, inner - (sceneW ? sceneW + 8 : 0), 12, 600, m),
          size: 12,
          weight: 600,
          color: c['text-primary'],
        },
      ];
      if (words.scenes)
        ops.push({
          kind: 'text',
          x: x + inner - sceneW,
          y: foot + 20,
          text: words.scenes,
          size: 11,
          weight: 600,
          color: c['tag-blue'],
        });
      if (words.chips.length)
        ops.push({
          kind: 'text',
          x,
          y: foot + 38,
          text: ellipsize(words.chips.join(' · '), inner, 11, 400, m),
          size: 11,
          weight: 400,
          color: c['text-secondary'],
        });
      return ops;
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

/** Height of a set plan card's foot in exports: its name and scenes, then its counts. */
const PLAN_FOOT = 48;
