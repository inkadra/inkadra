// SPDX-License-Identifier: MPL-2.0
import {
  backgroundBox,
  foldIcons,
  gridStep,
  iconCentre,
  iconSize,
  KIT_GROUPS,
  kitList,
  layerOf,
  legendLine,
  legendValue,
  PLAN_VIEW_H,
  PLAN_VIEW_W,
  type PlanElement,
  planFrame,
  planLegend,
  powerLines,
  roomSize,
  type Words,
} from '@inkadra/canvas-core';
import type { PlanIcon } from '@inkadra/doc-schema';
import { pageSize } from './layout.ts';
import type { Op, Page } from './ops.ts';
import { exportRoomSize, type PlanDrawContext, planOps } from './plan-ops.ts';
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

/**
 * What a sheet of `plan` includes until the person changes it: the defaults, with the background
 * picture when the plan shows one, in greys if the plan's background is grey (decision 0115).
 * `plan` is the plan as drawn: a setup shows its base's background.
 */
export function sheetInclude(plan: Pick<PlanElement, 'background'>): PlanSheetInclude {
  return { ...PLAN_SHEET_INCLUDE, background: !!plan.background && !plan.background.hidden };
}

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
  t: Words;
  locale: string;
}

/** A4 landscape, as the mockup's sheet. */
const PAPER = pageSize('a4', 'landscape');
const PAD = 24;
const PLAN_W = 480;
const GAP = 21;
const CAP = 8.25;
/** Where the drawing sits on the sheet, below the title block: the export dialog previews it. */
export const PLAN_SHEET_FRAME = {
  x: PAD,
  y: PAD + 52,
  w: PLAN_W,
  h: PAPER.height - PAD - 18 - (PAD + 52),
} as const;

const TEXT = 9.75;
const ROW = 15;

/**
 * The PDF sheet of a set plan (decision 0111, the mockup's Sheet): A4 landscape in the light
 * theme, one page per setup. The title block (scene, setup, shots, scale, room), the drawing as
 * vectors, and beside it the legend of cameras, lights and cast with their glyphs, the kit, the
 * power per circuit and the notes; the place and the page at the foot.
 */
export function planSheetPages(input: PlanSheetInput, ctx: PlanDrawContext): Page[] {
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
    const frame = PLAN_SHEET_FRAME;
    const top = frame.y;
    const bottom = frame.y + frame.h;
    ops.push({
      kind: 'rect',
      ...frame,
      radius: 6,
      fill: c['surface-1'],
      stroke: c['border-default'],
      lineWidth: 0.75,
    });
    // What the editor showed, or what is drawn on the plan in the frame's own shape, so it
    // fills the frame with the card's small margin (decisions 0118 and 0119).
    const area =
      input.area ??
      planFrame(
        plan,
        exportRoomSize(ctx),
        include.background,
        [],
        (frame.w - 16) / Math.max(1, frame.h - 16),
      );
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
    // The picture under the plan where it was placed, at its opacity, in greys if the plan says
    // so; not when it is hidden, nor with the Set (decision 0110).
    const bg = plan.background;
    if (include.background && bg && !bg.hidden && !plan.hiddenLayers?.includes('set')) {
      const box = backgroundBox(bg);
      inside.push({
        kind: 'image',
        key: bg.assetId,
        x: whole.x + box.x * k,
        y: whole.y + box.y * k,
        w: box.w * k,
        h: box.h * k,
        fit: 'cover',
        ...(bg.opacity !== undefined ? { opacity: bg.opacity } : {}),
        ...(bg.grey ? { grey: true } : {}),
      });
    }
    if (include.grid) {
      const step = gridStep(plan) * k;
      // The lines of the plan's grid over what is shown, beyond the old extent too (0118).
      const first = (from: number, origin: number) =>
        origin + Math.ceil((from - origin) / step - 1e-6) * step;
      for (let x = first(view.x, whole.x); x <= view.x + view.w + 0.1; x += step)
        inside.push({
          kind: 'line',
          x1: x,
          y1: view.y,
          x2: x,
          y2: view.y + view.h,
          color: c['border-default'],
          width: 0.3,
        });
      for (let y = first(view.y, whole.y); y <= view.y + view.h + 0.1; y += step)
        inside.push({
          kind: 'line',
          x1: view.x,
          y1: y,
          x2: view.x + view.w,
          y2: y,
          color: c['border-default'],
          width: 0.3,
        });
    }
    inside.push(...planOps(plan, whole, ctx, true, true, view, include.scale));
    ops.push({ kind: 'clip', ...view, ops: inside });

    // The side column.
    const sx = frame.x + frame.w + GAP;
    const sw = right - sx;
    const limit = bottom;
    let y = top + 4;
    const icons = (plan.icons ?? []).filter((i) => !plan.hiddenLayers?.includes(layerOf(i)));
    /** A glyph of `icon`, `size` points wide, centred at (x, y), without its beam or label. */
    const glyph = (icon: PlanIcon, x: number, cy: number, size = 12) => {
      // Only the glyph: no label, power or lens of its own, which the row prints beside it.
      const alone: PlanIcon = {
        ...icon,
        rotation: 0,
        steps: undefined,
        label: undefined,
        power: undefined,
        watts: undefined,
        showLens: undefined,
      };
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
      // Flags, frames and stands standing on their own, as the mockup's "Neg fill, flag 4×4".
      const { cameras, lights, grip, cast } = planLegend(plan);
      for (const [title, list] of [
        [t('board.plan.sheet.cameras'), cameras],
        [t('board.plan.sheet.lights'), lights],
        [t('board.plan.sheet.grip'), grip],
      ] as const) {
        if (!list.length || !section(title)) continue;
        // Identical icons as one row, "Practical ×3", as Elements and the view list them.
        const rows = foldIcons(list, icons);
        let drawn = 0;
        for (const { icon, count } of rows) {
          if (!fits(ROW * 2)) break;
          const name = legendLine(icon, icons, t, locale);
          row(count > 1 ? `${name} ×${count}` : name, legendValue(icon), icon);
          drawn += 1;
        }
        more(rows.length - drawn);
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
