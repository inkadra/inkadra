// SPDX-License-Identifier: AGPL-3.0-only
import {
  attachRole,
  catalogueKind,
  categoryOf,
  gridStep,
  iconCentre,
  iconSize,
  isLight,
  layerOf,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
} from '@inkadra/canvas-core';
import { type PlanIcon, STROKE_GRID } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { itemSummary } from '../plan/elements.ts';
import { KIT_GROUPS, kitList, powerLines } from '../plan/kit.ts';
import { type CardContext, planOps } from './board-render.ts';
import { pageSize } from './layout.ts';
import type { Op, Page } from './pages.ts';
import { ellipsize, textBlock, wrapText } from './text.ts';

/** What the sheet of a set plan prints, as the export dialog's boxes say (decision 0111). */
export interface PlanSheetInclude {
  legend: boolean;
  kit: boolean;
  power: boolean;
  notes: boolean;
  scale: boolean;
  background: boolean;
  dateScene: boolean;
  grid: boolean;
}

export const PLAN_SHEET_INCLUDE: PlanSheetInclude = {
  legend: true,
  kit: true,
  power: true,
  notes: true,
  scale: true,
  background: false,
  dateScene: true,
  grid: false,
};

/** One setup on its page: the plan as it is drawn (its links resolved, over its base's Set). */
export interface PlanSheetSetup {
  plan: PlanElement;
  /** "Setup 1 · Master". */
  name: string;
  /** Labels of the frames its cameras shoot. */
  shots: string[];
}

export interface PlanSheetInput {
  setups: readonly PlanSheetSetup[];
  /** "Scene 2 · INT. Rosa's diner, night"; empty without a scene or without "Date and scene". */
  scene: string;
  /** "Rosa's diner · Day 3": the foot of the page. */
  place: string;
  /** The part of the drawing to print, in view units; null: all of it. */
  area: { x: number; y: number; w: number; h: number } | null;
  include: PlanSheetInclude;
  t: TFunction;
  locale: string;
}

/** A4 landscape, as the mockup's sheet. */
const PAPER = pageSize('a4', 'landscape');
const PAD = 24;
const PLAN_W = 480;
const GAP = 21;
const CAP = 8.25;
const TEXT = 9.75;
const ROW = 15;

/** The legend's line of a camera, a light or a person: the item's summary, as in Elements. */
function line(icon: PlanIcon, icons: readonly PlanIcon[], t: TFunction): string {
  const name = icon.label || t(`board.plan.icons.${icon.kind}`);
  const summary = itemSummary(icon, icons, t);
  return summary ? `${name} · ${summary}` : name;
}

/** The value at the right of a legend line: a camera's lens, a light's temperature and level. */
function value(icon: PlanIcon): string {
  if (catalogueKind(icon.kind) === 'camera') return `${icon.lens ?? 35} mm`;
  if (!isLight(icon.kind)) return '';
  return [
    icon.kelvin ? `${icon.kelvin} K` : '',
    icon.intensity !== undefined ? `${Math.round(icon.intensity * 100)}%` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Width and depth of the walls' outline in metres, "8.0 × 6.3 m"; null without walls or scale. */
export function roomSize(plan: PlanElement, locale: string): string | null {
  const points = (plan.walls ?? []).flatMap((w) => w.points);
  if (!plan.scale || points.length < 4) return null;
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  // Wall points are in STROKE_GRID units of the drawing's width and height.
  const w = ((Math.max(...xs) - Math.min(...xs)) / STROKE_GRID) * PLAN_VIEW_W;
  const h = ((Math.max(...ys) - Math.min(...ys)) / STROKE_GRID) * PLAN_VIEW_H;
  const m = (v: number) =>
    (v / (plan.scale as number)).toLocaleString(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  return `${m(w)} × ${m(h)} m`;
}

/**
 * The PDF sheet of a set plan (decision 0111, the mockup's Sheet): A4 landscape in the light
 * theme, one page per setup. The title block (scene, setup, shots, scale, room), the drawing as
 * vectors, and beside it the legend of cameras, lights and cast with their glyphs, the kit, the
 * power per circuit and the notes; the place and the page at the foot.
 */
export function planSheetPages(input: PlanSheetInput, ctx: CardContext): Page[] {
  const { t, locale, include } = input;
  const c = ctx.colors;
  const m = ctx.measure;
  const total = input.setups.length;
  return input.setups.map((setup, index) => {
    const { plan } = setup;
    const ops: Op[] = [];
    const right = PAPER.width - PAD;
    const text = (
      x: number,
      y: number,
      s: string,
      size: number,
      weight: 400 | 500 | 600 | 700,
      color: string,
    ) => ops.push({ kind: 'text', x, y, text: s, size, weight, color });
    const cap = (x: number, y: number, s: string) =>
      text(x, y, s.toLocaleUpperCase(locale), CAP, 600, c['text-muted']);

    // Title block.
    const heading = [t('board.plan.name'), include.dateScene ? input.scene : '']
      .filter(Boolean)
      .join(' · ');
    cap(PAD, PAD + 8, heading);
    text(PAD, PAD + 30, setup.name, 18, 700, c['text-primary']);
    const facts: Array<[string, string]> = [];
    const shots = setup.shots.filter(Boolean);
    if (shots.length) facts.push([t('board.plan.sheet.shots'), shots.join(', ')]);
    if (include.scale && plan.scale) {
      facts.push([
        t('board.plan.sheet.scale'),
        t('board.plan.scaleGrid', { grid: Number(plan.grid ?? '0.5').toLocaleString(locale) }),
      ]);
      const room = roomSize(plan, locale);
      if (room) facts.push([t('board.plan.sheet.room'), room]);
    }
    let fx = right;
    for (const [label, val] of [...facts].reverse()) {
      const w = Math.max(m(label.toLocaleUpperCase(locale), CAP, 600), m(val, 10.5, 600));
      fx -= w;
      cap(fx, PAD + 16, label);
      text(fx, PAD + 30, val, 10.5, 600, c['text-primary']);
      fx -= 21;
    }
    const lineY = PAD + 40;
    ops.push({
      kind: 'line',
      x1: PAD,
      y1: lineY,
      x2: right,
      y2: lineY,
      color: c['text-primary'],
      width: 1.5,
    });

    // The drawing.
    const top = lineY + 12;
    const bottom = PAPER.height - PAD - 18;
    const frame = { x: PAD, y: top, w: PLAN_W, h: bottom - top };
    ops.push({
      kind: 'rect',
      ...frame,
      radius: 6,
      fill: c['surface-1'],
      stroke: c['border-default'],
      lineWidth: 0.75,
    });
    const area = input.area ?? { x: 0, y: 0, w: PLAN_VIEW_W, h: PLAN_VIEW_H };
    const k = Math.min((frame.w - 16) / area.w, (frame.h - 16) / area.h);
    const shown = { w: area.w * k, h: area.h * k };
    const view = {
      x: frame.x + (frame.w - shown.w) / 2,
      y: frame.y + (frame.h - shown.h) / 2,
      ...shown,
    };
    const whole = {
      x: view.x - area.x * k,
      y: view.y - area.y * k,
      w: PLAN_VIEW_W * k,
      h: PLAN_VIEW_H * k,
    };
    const inside: Op[] = [];
    if (include.background && plan.background) {
      inside.push({
        kind: 'image',
        key: plan.background.assetId,
        ...whole,
        fit: 'cover',
        ...(plan.background.opacity !== undefined ? { opacity: plan.background.opacity } : {}),
      });
    }
    if (include.grid) {
      const step = gridStep(plan) * k;
      for (let x = whole.x; x <= whole.x + whole.w + 0.1; x += step)
        inside.push({
          kind: 'line',
          x1: x,
          y1: whole.y,
          x2: x,
          y2: whole.y + whole.h,
          color: c['border-default'],
          width: 0.3,
        });
      for (let y = whole.y; y <= whole.y + whole.h + 0.1; y += step)
        inside.push({
          kind: 'line',
          x1: whole.x,
          y1: y,
          x2: whole.x + whole.w,
          y2: y,
          color: c['border-default'],
          width: 0.3,
        });
    }
    inside.push(...planOps(plan, whole, ctx));
    ops.push({ kind: 'clip', ...view, ops: inside });

    // The side column.
    const sx = frame.x + frame.w + GAP;
    const sw = right - sx;
    const limit = bottom;
    let y = top + 4;
    const icons = (plan.icons ?? []).filter((i) => !plan.hiddenLayers?.includes(layerOf(i)));
    /** A glyph of `icon`, `size` points wide, centred at (x, y), without its beam or label. */
    const glyph = (icon: PlanIcon, x: number, cy: number, size = 12) => {
      const alone: PlanIcon = { ...icon, rotation: 0, steps: undefined, label: undefined };
      delete alone.on;
      const centre = iconCentre(alone);
      const long = Math.max(iconSize(alone).w, iconSize(alone).h) || 1;
      const s = size / long;
      const box = {
        x: x - centre.x * s,
        y: cy - centre.y * s,
        w: PLAN_VIEW_W * s,
        h: PLAN_VIEW_H * s,
      };
      ops.push(
        ...planOps(
          { ...plan, icons: [alone], shapes: [], strokes: [], walls: [] },
          box,
          ctx,
          false,
          false,
        ),
      );
    };
    const fits = (h: number) => y + h <= limit;
    const section = (title: string, border = false) => {
      if (!fits(ROW * 2)) return false;
      if (border) {
        y += 4;
        ops.push({
          kind: 'line',
          x1: sx,
          y1: y,
          x2: right,
          y2: y,
          color: c['border-default'],
          width: 0.75,
        });
        y += 8;
      }
      cap(sx, y + 8, title);
      y += 14;
      return true;
    };
    const row = (label: string, val: string, icon?: PlanIcon) => {
      if (!fits(ROW)) return;
      const tx = icon ? sx + 18 : sx;
      const vw = val ? m(val, TEXT, 600) + 8 : 0;
      if (icon) glyph(icon, sx + 6, y + ROW / 2 - 1);
      text(
        tx,
        y + 10.5,
        ellipsize(label, right - tx - vw, TEXT, 400, m),
        TEXT,
        400,
        c['text-primary'],
      );
      if (val) text(right - vw + 8, y + 10.5, val, TEXT, 600, c['text-primary']);
      y += ROW;
    };
    const more = (left: number) => {
      if (left > 0 && fits(ROW)) row(t('board.plan.sheet.more', { count: left }), '');
    };

    if (include.legend) {
      const cameras = icons.filter((i) => catalogueKind(i.kind) === 'camera');
      const lights = icons.filter((i) => isLight(i.kind) && !i.on);
      const cast = icons.filter(
        (i) => categoryOf(i.kind).id === 'people' && attachRole(i.kind) === 'seated',
      );
      for (const [title, list] of [
        [t('board.plan.sheet.cameras'), cameras],
        [t('board.plan.sheet.lights'), lights],
      ] as const) {
        if (!list.length || !section(title)) continue;
        let drawn = 0;
        for (const icon of list) {
          if (!fits(ROW * 2)) break;
          row(line(icon, icons, t), value(icon), icon);
          drawn += 1;
        }
        more(list.length - drawn);
        y += 6;
      }
      if (cast.length && section(t('board.plan.sheet.cast'))) {
        let x = sx;
        for (const icon of cast) {
          const name = icon.label || t(`board.plan.icons.${icon.kind}`);
          const w = 18 + m(name, TEXT, 400) + 14;
          if (x + w > right && x > sx) {
            x = sx;
            y += ROW;
          }
          if (!fits(ROW)) break;
          glyph(icon, x + 6, y + ROW / 2 - 1);
          text(x + 18, y + 10.5, name, TEXT, 400, c['text-primary']);
          x += w;
        }
        y += ROW + 6;
      }
    }
    if (include.kit) {
      // The legend lists the lights and cameras; the kit adds the rest, or everything without it.
      const kit = kitList(plan, t, locale);
      for (const group of KIT_GROUPS) {
        if (include.legend && (group === 'lights' || group === 'camera')) continue;
        const lines = kit.filter((l) => l.group === group);
        if (!lines.length || !section(t(`board.plan.kitGroups.${group}`))) continue;
        let drawn = 0;
        for (const l of lines) {
          if (!fits(ROW * 2)) break;
          row(l.name, `×${l.count}`);
          drawn += 1;
        }
        more(lines.length - drawn);
        y += 6;
      }
    }
    const power = include.power ? powerLines(plan, t, locale) : null;
    if (power && section(power.title, true)) {
      text(right - m(power.total, TEXT, 600), y - 6, power.total, TEXT, 600, c['text-primary']);
      for (const r of power.rows) row(r.text, r.amps);
      y += 6;
    }
    const notes = include.notes
      ? icons
          .filter((i) => i.note?.trim())
          .map((i) => `${i.label || t(`board.plan.icons.${i.kind}`)}: ${i.note?.trim()}`)
      : [];
    if (notes.length && section(t('board.plan.sheet.notes'), true)) {
      const lines = wrapText(notes.join(' · '), sw, TEXT, 400, m);
      const room = Math.max(0, Math.floor((limit - y) / 14));
      const kept = lines.slice(0, room);
      if (lines.length > room && kept.length) kept[kept.length - 1] = `${kept.at(-1)}…`;
      ops.push(
        ...textBlock(kept, sx, y, {
          size: TEXT,
          weight: 400,
          color: c['text-primary'],
          leading: 14,
        }).ops,
      );
    }

    // The foot of the page.
    const footY = PAPER.height - PAD + 4;
    if (input.place) text(PAD, footY, input.place, CAP, 400, c['text-secondary']);
    const foot = t('board.plan.sheet.foot', { n: index + 1, total });
    text(right - m(foot, CAP, 400), footY, foot, CAP, 400, c['text-secondary']);
    return { width: PAPER.width, height: PAPER.height, ops };
  });
}
