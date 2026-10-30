// SPDX-License-Identifier: AGPL-3.0-only
import type { Rect, SceneGroup } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { Placed } from './board-model.ts';
import {
  type CardContext,
  drawBoard,
  framePicture,
  picture,
  transformOps,
} from './board-render.ts';
import {
  type Box,
  chunk,
  contentBox,
  FOOTER,
  type FramesPerPage,
  fitRegion,
  HEADER,
  MARGIN,
  type Orientation,
  type PaperSize,
  pageSize,
  paginateRows,
  storyboardCells,
  storyboardGrid,
} from './layout.ts';
import type { FontWeight, Op, Page } from './pages.ts';
import { ellipsize, textBlock, wrapText } from './text.ts';

type Frame = Extract<Element, { type: 'frame' }>;

/** Board kinds with a colour of their own (packages/ui kind-color.ts); others stay neutral. */
export type ExportKind = 'board' | 'storyboard' | 'shotlist';

export interface DocInfo {
  projectName: string;
  boardTitle: string;
  /** Already formatted for the reader's language. */
  date: string;
  kind: ExportKind;
  kindLabel: string;
  /** One line under the title, e.g. "12 shots · 3 scenes · 1:05". */
  summary: string;
  /** Key of the logo picture, when one is printed. */
  logo?: { key: string; width: number; height: number } | undefined;
}

export interface Words {
  pageOf(n: number, total: number): string;
  madeWith: string;
  scene: string;
  noFrames: string;
  comments: string;
  onBoard: string;
  onCard(label: string): string;
  removedCard: string;
  dialogue: string;
  notes: string;
  /** Headings of the shot list table, by column key. */
  columns: Record<ShotColumn, string>;
}

export interface Shot {
  frame: Frame;
  label: string;
  scene: SceneGroup['scene'];
  /** Translated preset values. */
  size: string;
  angle: string;
  movement: string;
  duration: string;
  status?: string | undefined;
}

export interface CommentEntry {
  target: string;
  author: string;
  date: string;
  body: string;
  replies: Array<{ author: string; date: string; body: string }>;
}

export interface PageSetup {
  paper: PaperSize;
  orientation: Orientation;
}

/** Light theme tokens used by the printed page; see Palette. */
type Colors = CardContext['colors'];

const KIND_COLORS: Record<ExportKind, { fg: keyof Colors; bg: keyof Colors } | null> = {
  storyboard: { fg: 'tag-purple', bg: 'tag-purple-bg' },
  shotlist: { fg: 'tag-green', bg: 'tag-green-bg' },
  board: null,
};

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  weight: FontWeight,
  color: string,
): Op {
  return { kind: 'text', x, y, text: value, size, weight, color };
}

/** Running header and footer of a content page. */
function chrome(
  page: Page,
  info: DocInfo,
  ctx: CardContext,
  n: number,
  total: number,
  words: Words,
) {
  const c = ctx.colors;
  const m = ctx.measure;
  const right = page.width - MARGIN;
  const top = MARGIN;
  const logoW = info.logo ? Math.min(90, (16 * info.logo.width) / info.logo.height) : 0;
  const titleW = page.width - MARGIN * 2 - logoW - 16;
  const project = ellipsize(info.projectName, titleW * 0.5, 9, 600, m);
  const projectW = m(project, 9, 600);
  page.ops.push(text(project, MARGIN, top + 11, 9, 600, c['text-primary']));
  // The root board carries the project's name: say it once.
  if (info.boardTitle && info.boardTitle !== info.projectName) {
    page.ops.push(
      text(
        ellipsize(info.boardTitle, titleW - projectW - 14, 9, 400, m),
        MARGIN + projectW + 10,
        top + 11,
        9,
        400,
        c['text-secondary'],
      ),
    );
  }
  if (info.logo) {
    page.ops.push({
      kind: 'image',
      key: info.logo.key,
      x: right - logoW,
      y: top,
      w: logoW,
      h: 16,
      fit: 'contain',
    });
  }
  page.ops.push({
    kind: 'line',
    x1: MARGIN,
    y1: top + HEADER - 8,
    x2: right,
    y2: top + HEADER - 8,
    color: c['border-default'],
    width: 0.75,
  });
  const base = page.height - MARGIN;
  page.ops.push(text(`${info.date} · ${words.madeWith}`, MARGIN, base, 7.5, 400, c['text-muted']));
  const label = words.pageOf(n, total);
  page.ops.push(text(label, right - m(label, 7.5, 400), base, 7.5, 400, c['text-muted']));
}

export function titlePage(setup: PageSetup, info: DocInfo, ctx: CardContext, words: Words): Page {
  const { width, height } = pageSize(setup.paper, setup.orientation);
  const page: Page = { width, height, ops: [] };
  const c = ctx.colors;
  const m = ctx.measure;
  const inner = width - MARGIN * 2 - 24;
  const x = MARGIN + 12;
  if (info.logo) {
    const h = Math.min(44, info.logo.height);
    const w = Math.min(180, (h * info.logo.width) / info.logo.height);
    page.ops.push({ kind: 'image', key: info.logo.key, x, y: MARGIN + 12, w, h, fit: 'contain' });
  }
  let top = height * (setup.orientation === 'portrait' ? 0.36 : 0.3);
  const kind = KIND_COLORS[info.kind];
  const chip = info.kindLabel.toUpperCase();
  const chipW = m(chip, 8, 600) + 16;
  page.ops.push({
    kind: 'rect',
    x,
    y: top,
    w: chipW,
    h: 18,
    radius: 9,
    fill: kind ? c[kind.bg] : c['surface-2'],
  });
  page.ops.push(text(chip, x + 8, top + 12.3, 8, 600, kind ? c[kind.fg] : c['text-secondary']));
  top += 34;
  const title = textBlock(
    wrapText(info.boardTitle || info.projectName, inner, 30, 600, m, 3),
    x,
    top,
    { size: 30, weight: 600, leading: 36, color: c['text-primary'] },
  );
  page.ops.push(...title.ops);
  top = title.bottom + 6;
  if (info.boardTitle && info.boardTitle !== info.projectName) {
    page.ops.push(
      text(
        ellipsize(info.projectName, inner, 14, 400, m),
        x,
        top + 14,
        14,
        400,
        c['text-secondary'],
      ),
    );
  }
  top += 40;
  page.ops.push({
    kind: 'line',
    x1: x,
    y1: top,
    x2: x + inner,
    y2: top,
    color: c['border-default'],
    width: 0.75,
  });
  top += 22;
  page.ops.push(text(info.date, x, top, 10, 500, c['text-primary']));
  if (info.summary)
    page.ops.push(
      text(ellipsize(info.summary, inner, 10, 400, m), x, top + 16, 10, 400, c['text-secondary']),
    );
  page.ops.push(text(words.madeWith, x, height - MARGIN - 4, 7.5, 400, c['text-muted']));
  return page;
}

/** The cards of a board region fitted on one page, on a quiet canvas-coloured ground. */
export function boardPage(
  setup: PageSetup | 'fit',
  items: readonly Placed[],
  region: Rect,
  ctx: CardContext,
): Page {
  const { width, height } =
    setup === 'fit'
      ? // A picture of the board: one board unit is one point, plus the page frame.
        { width: region.w + MARGIN * 2, height: region.h + MARGIN * 2 + HEADER + FOOTER }
      : pageSize(setup.paper, setup.orientation);
  const page: Page = { width, height, ops: [] };
  const box = contentBox(width, height);
  page.ops.push({
    kind: 'rect',
    ...box,
    radius: 8,
    fill: ctx.colors['bg-canvas'],
    stroke: ctx.colors['border-default'],
    lineWidth: 0.75,
  });
  const inner: Box = { x: box.x + 12, y: box.y + 12, w: box.w - 24, h: box.h - 24 };
  const fit = fitRegion(region, inner, setup === 'fit' ? 1 : 1.25);
  page.ops.push({
    kind: 'clip',
    ...box,
    radius: 8,
    ops: transformOps(drawBoard(items, ctx), fit.scale, fit.dx, fit.dy),
  });
  return page;
}

export function storyboardPages(
  setup: PageSetup,
  shots: readonly Shot[],
  perPage: FramesPerPage,
  ctx: CardContext,
  words: Words,
  showNotes: boolean,
): Page[] {
  const { width, height } = pageSize(setup.paper, setup.orientation);
  const grid = storyboardGrid(perPage, setup.orientation);
  return chunk(shots, perPage).map((group) => {
    const page: Page = { width, height, ops: [] };
    const box = contentBox(width, height);
    const f = perPage <= 2 ? 1.15 : 1;
    // Room under each picture for label, shot data and a few lines of action.
    const textRoom = perPage === 1 ? box.h * 0.3 : 84 * f;
    const narrowest = Math.min(...group.map((s) => ctx.frameAspect(s.frame)), 16 / 9);
    const cells = storyboardCells(box, grid.cols, grid.rows, narrowest, textRoom);
    if (group.length === 0) {
      page.ops.push(text(words.noFrames, box.x, box.y + 20, 11, 400, ctx.colors['text-muted']));
    }
    group.forEach((shot, i) => {
      const cell = cells[i];
      if (cell) page.ops.push(...storyboardCell(shot, cell, perPage, ctx, words, showNotes));
    });
    return page;
  });
}

function storyboardCell(
  shot: Shot,
  cell: Box,
  perPage: FramesPerPage,
  ctx: CardContext,
  words: Words,
  showNotes: boolean,
): Op[] {
  const c = ctx.colors;
  const m = ctx.measure;
  const f = perPage <= 2 ? 1.15 : 1;
  // The picture fills the column; the text below lines up with it.
  const pic = { x: cell.x, y: cell.y, w: cell.w, h: cell.w / ctx.frameAspect(shot.frame) };
  const ops: Op[] = framePicture(shot.frame, pic, ctx);
  let top = pic.y + pic.h + 8 * f;
  const labelSize = 11 * f;
  ops.push(text(shot.label, cell.x, top + labelSize, labelSize, 600, c['text-primary']));
  const labelW = m(shot.label, labelSize, 600);
  if (shot.scene) {
    const slug = [`${words.scene} ${shot.scene.number}`, ctx.slugline(shot.scene)]
      .filter(Boolean)
      .join(' · ');
    ops.push(
      text(
        ellipsize(slug, pic.w - labelW - 12, 8 * f, 500, m),
        cell.x + labelW + 10,
        top + labelSize,
        8 * f,
        500,
        c['text-muted'],
      ),
    );
  }
  if (shot.status) {
    const sw = m(shot.status, 7.5 * f, 500);
    ops.push(
      text(shot.status, cell.x + pic.w - sw, top + labelSize, 7.5 * f, 500, c['text-secondary']),
    );
  }
  top += labelSize + 6 * f;
  const meta = [shot.size, shot.angle, shot.movement, shot.frame.lens, shot.duration]
    .filter(Boolean)
    .join(' · ');
  const width = pic.w;
  const bottom = cell.y + cell.h;
  const block = (value: string, size: number, weight: FontWeight, color: string) => {
    const leading = size * 1.4;
    const room = Math.floor((bottom - top) / leading);
    if (!value || room < 1) return;
    const out = textBlock(wrapText(value, width, size, weight, m, room), cell.x, top, {
      size,
      weight,
      leading,
      color,
    });
    ops.push(...out.ops);
    top = out.bottom + 3 * f;
  };
  block(meta, 8 * f, 500, c['text-secondary']);
  block(shot.frame.action ?? '', 9 * f, 400, c['text-primary']);
  if (shot.frame.dialogue)
    block(`${words.dialogue}: “${shot.frame.dialogue}”`, 8.5 * f, 400, c['text-secondary']);
  if (showNotes && shot.frame.notes)
    block(`${words.notes}: ${shot.frame.notes}`, 8 * f, 400, c['text-muted']);
  return ops;
}

export const SHOT_COLUMNS = [
  'shot',
  'picture',
  'size',
  'angle',
  'movement',
  'lens',
  'duration',
  'action',
  'location',
  'cast',
  'status',
] as const;
export type ShotColumn = (typeof SHOT_COLUMNS)[number];

const COLUMN_WEIGHT: Record<ShotColumn, number> = {
  shot: 0.55,
  picture: 1.35,
  size: 0.85,
  angle: 0.85,
  movement: 0.85,
  lens: 0.6,
  duration: 0.55,
  action: 3,
  location: 1.1,
  cast: 1.1,
  status: 0.8,
};

/** Columns of the shot list table and their widths across `width`. */
export function shotColumns(width: number, withStatus: boolean) {
  const keys = SHOT_COLUMNS.filter((k) => withStatus || k !== 'status');
  const total = keys.reduce((s, k) => s + COLUMN_WEIGHT[k], 0);
  let x = 0;
  return keys.map((key) => {
    const w = (COLUMN_WEIGHT[key] / total) * width;
    const col = { key, x, w };
    x += w;
    return col;
  });
}

const CELL_PAD = 5;
const ROW_TEXT = 8;
const ROW_LEADING = 11;
const HEAD_H = 20;
const SCENE_H = 22;

type Row = { kind: 'scene'; scene: NonNullable<Shot['scene']> } | { kind: 'shot'; shot: Shot };

function cellText(shot: Shot, key: ShotColumn, words: Words): string {
  const f = shot.frame;
  switch (key) {
    case 'shot':
      return shot.label;
    case 'size':
      return shot.size;
    case 'angle':
      return shot.angle;
    case 'movement':
      return shot.movement;
    case 'lens':
      return f.lens ?? '';
    case 'duration':
      return shot.duration;
    case 'action':
      return [f.action, f.dialogue && `${words.dialogue}: “${f.dialogue}”`]
        .filter(Boolean)
        .join('\n');
    case 'location':
      return f.location ?? '';
    case 'cast':
      return (f.cast ?? []).join(', ');
    case 'status':
      return shot.status ?? '';
    case 'picture':
      return '';
  }
}

export function shotListPages(
  setup: PageSetup,
  shots: readonly Shot[],
  ctx: CardContext,
  words: Words,
  withStatus: boolean,
): Page[] {
  const { width, height } = pageSize(setup.paper, setup.orientation);
  const box = contentBox(width, height);
  const cols = shotColumns(box.w, withStatus);
  const c = ctx.colors;
  const m = ctx.measure;
  const rows: Row[] = [];
  let scene: Shot['scene'] | undefined;
  for (const shot of shots) {
    if (shot.scene && shot.scene !== scene) rows.push({ kind: 'scene', scene: shot.scene });
    scene = shot.scene;
    rows.push({ kind: 'shot', shot });
  }
  const layout = rows.map((row) => {
    if (row.kind === 'scene') return { row, h: SCENE_H, cells: new Map<ShotColumn, string[]>() };
    const cells = new Map<ShotColumn, string[]>();
    let lines = 1;
    for (const col of cols) {
      if (col.key === 'picture') continue;
      const value = cellText(row.shot, col.key, words);
      const wrapped = wrapText(
        value,
        col.w - CELL_PAD * 2,
        ROW_TEXT,
        col.key === 'shot' ? 600 : 400,
        m,
        col.key === 'action' ? 7 : 3,
      );
      cells.set(col.key, wrapped);
      lines = Math.max(lines, wrapped.length);
    }
    const picCol = cols.find((col) => col.key === 'picture');
    const picH = picCol ? (picCol.w - CELL_PAD * 2) / ctx.frameAspect(row.shot.frame) : 0;
    return { row, h: Math.max(lines * ROW_LEADING, picH) + CELL_PAD * 2, cells };
  });
  const pages = paginateRows(
    layout.map((l) => l.h),
    box.h - HEAD_H,
  );
  return pages.map((indexes) => {
    const page: Page = { width, height, ops: [] };
    // Table head, repeated on every page.
    for (const col of cols) {
      page.ops.push(
        text(
          ellipsize(words.columns[col.key], col.w - CELL_PAD * 2, 7.5, 600, m),
          box.x + col.x + CELL_PAD,
          box.y + 12,
          7.5,
          600,
          c['text-muted'],
        ),
      );
    }
    page.ops.push({
      kind: 'line',
      x1: box.x,
      y1: box.y + HEAD_H - 2,
      x2: box.x + box.w,
      y2: box.y + HEAD_H - 2,
      color: c['border-strong'],
      width: 0.75,
    });
    if (indexes.length === 0) {
      page.ops.push(text(words.noFrames, box.x, box.y + HEAD_H + 18, 10, 400, c['text-muted']));
    }
    let y = box.y + HEAD_H;
    for (const i of indexes) {
      const item = layout[i];
      if (!item) continue;
      const { row, h } = item;
      if (row.kind === 'scene') {
        page.ops.push({
          kind: 'rect',
          x: box.x,
          y: y + 2,
          w: box.w,
          h: h - 4,
          radius: 4,
          fill: c['surface-2'],
        });
        const slug = [row.scene.number, ctx.slugline(row.scene), row.scene.title]
          .filter(Boolean)
          .join('  ·  ');
        page.ops.push(
          text(
            ellipsize(slug, box.w - 16, 8.5, 600, m),
            box.x + 8,
            y + 14.5,
            8.5,
            600,
            c['text-primary'],
          ),
        );
      } else {
        const cellOps: Op[] = [];
        for (const col of cols) {
          const cx = box.x + col.x + CELL_PAD;
          if (col.key === 'picture') {
            const pw = col.w - CELL_PAD * 2;
            const ph = pw / ctx.frameAspect(row.shot.frame);
            const has =
              row.shot.frame.assetId ||
              row.shot.frame.strokes?.length ||
              row.shot.frame.shapes?.length;
            cellOps.push(
              ...(has
                ? framePicture(row.shot.frame, { x: cx, y: y + CELL_PAD, w: pw, h: ph }, ctx)
                : [picture(undefined, { x: cx, y: y + CELL_PAD, w: pw, h: ph }, 'cover', c)]),
            );
            continue;
          }
          const lines = item.cells.get(col.key) ?? [];
          const weight = col.key === 'shot' ? 600 : 400;
          const color =
            col.key === 'shot' || col.key === 'action' ? c['text-primary'] : c['text-secondary'];
          cellOps.push(
            ...textBlock(lines, cx, y + CELL_PAD - 1.5, {
              size: ROW_TEXT,
              weight,
              leading: ROW_LEADING,
              color,
            }).ops,
          );
        }
        page.ops.push({ kind: 'clip', x: box.x, y, w: box.w, h, ops: cellOps });
        page.ops.push({
          kind: 'line',
          x1: box.x,
          y1: y + h,
          x2: box.x + box.w,
          y2: y + h,
          color: c['border-default'],
          width: 0.5,
        });
      }
      y += h;
    }
    return page;
  });
}

export function commentPages(
  setup: PageSetup,
  entries: readonly CommentEntry[],
  ctx: CardContext,
  words: Words,
): Page[] {
  const { width, height } = pageSize(setup.paper, setup.orientation);
  const box = contentBox(width, height);
  const c = ctx.colors;
  const m = ctx.measure;
  type Block = { h: number; draw: (top: number) => Op[] };
  const blocks: Block[] = [];
  const comment = (author: string, date: string, body: string, indent: number): Block => {
    const lines = wrapText(body, box.w - indent, 9, 400, m, 40);
    const h = 14 + lines.length * 12.6 + 6;
    return {
      h,
      draw: (top) => {
        const authorW = m(author, 9, 600);
        return [
          text(author, box.x + indent, top + 10, 9, 600, c['text-primary']),
          text(date, box.x + indent + authorW + 8, top + 10, 8, 400, c['text-muted']),
          ...textBlock(lines, box.x + indent, top + 14, {
            size: 9,
            weight: 400,
            leading: 12.6,
            color: c['text-primary'],
          }).ops,
        ];
      },
    };
  };
  for (const entry of entries) {
    blocks.push({
      h: 22,
      draw: (top) => [
        {
          kind: 'line',
          x1: box.x,
          y1: top + 4,
          x2: box.x + box.w,
          y2: top + 4,
          color: c['border-default'],
          width: 0.5,
        },
        text(ellipsize(entry.target, box.w, 8, 500, m), box.x, top + 17, 8, 500, c['text-muted']),
      ],
    });
    blocks.push(comment(entry.author, entry.date, entry.body, 0));
    for (const reply of entry.replies)
      blocks.push(comment(reply.author, reply.date, reply.body, 16));
  }
  const heading = 30;
  const pages = paginateRows(
    blocks.map((b) => b.h),
    box.h - heading,
  );
  return pages.map((indexes, n) => {
    const page: Page = { width, height, ops: [] };
    if (n === 0) page.ops.push(text(words.comments, box.x, box.y + 16, 16, 600, c['text-primary']));
    let top = box.y + (n === 0 ? heading : 0);
    for (const i of indexes) {
      const block = blocks[i];
      if (!block) continue;
      page.ops.push(...block.draw(top));
      top += block.h;
    }
    return page;
  });
}

/**
 * Adds the running header and footer. Page numbers count every page, the title page included,
 * which carries neither.
 */
export function finish(
  pages: Page[],
  info: DocInfo,
  ctx: CardContext,
  words: Words,
  hasTitle: boolean,
) {
  pages.forEach((page, i) => {
    if (hasTitle && i === 0) return;
    chrome(page, info, ctx, i + 1, pages.length, words);
  });
  return pages;
}
