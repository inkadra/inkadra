// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scene sheets (decision 0083): one sheet per scene for one department, made only of what the
 * board already holds. The data is gathered first (pure, tested), then laid out on light paper.
 */
import { type SceneGroup, variantView } from '@inkadra/canvas-core';
import { type Element, PLAN_ASPECT, TODO_LISTS } from '@inkadra/doc-schema';
import { clockMinutes, type ShootingDay } from '@inkadra/shared';
import { sceneIdsOf } from '../film/needed.ts';
import { clockLabel } from '../film/schedule.ts';
import { type CardContext, framePicture, picture, planOps } from './board-render.ts';
import type { PageSetup, Shot } from './compose.ts';
import { MARGIN, pageSize } from './layout.ts';
import type { FontWeight, Op, Page } from './pages.ts';
import type { Department } from './scene-choice.ts';
import { ellipsize, textBlock, wrapText } from './text.ts';

type Scene = Extract<Element, { type: 'scene' }>;
type Frame = Extract<Element, { type: 'frame' }>;
type Plan = Extract<Element, { type: 'plan' }>;

export interface SheetCharacter {
  name: string;
  actor: string;
  costume: string;
  /** Pictures of the character card's references. */
  refs: string[];
  /** Previous and next scene of the character, already written out; empty when it has none. */
  continuity: string;
}

export interface SceneSheet {
  /** Project and shooting day: "THE LONG NIGHT · DAY 3 · TUE 18 NOV". */
  overline: string;
  /** "12 · INT. KITCHEN – NIGHT". */
  heading: string;
  call: string;
  location: string;
  /** The location card's notes (team only). */
  locationDetail: string;
  /** The location card's light notes. */
  light: string;
  /** "INT. · NIGHT". */
  time: string;
  synopsis: string;
  shots: Shot[];
  /** Set plans of the scene, a variant already drawn over its base's Set. */
  plans: Plan[];
  characters: SheetCharacter[];
  /** "Mara (Giulia R.), Luca". */
  cast: string;
  /** "Day 3 of 12 · scenes 11, 12, 13". */
  day: string;
  /** Typed to-do items linked to the scene (decision 0058), duplicates merged. */
  needed: string[];
  /** Department entries of the shot blocks of the scene, as written. */
  notes: string[];
}

/** Translated texts the sheets are made of; the engine builds them from `t`. */
export interface SheetText {
  project: string;
  slugline(scene: Scene): string;
  time(scene: Scene): string;
  day(n: number, date: string): string;
  dayOf(n: number, total: number, scenes: string): string;
  continuity(name: string, previous: string, next: string): string;
}

export interface SheetInput {
  scenes: readonly Scene[];
  /** The whole storyboard, as the export may show it: frames, and the order of scenes. */
  groups: readonly SceneGroup[];
  /** Every other card the export may show: characters, locations, plans, to-do lists. */
  elements: readonly Element[];
  /** Shooting days, by date; none for an export meant for clients. */
  days: readonly ShootingDay[];
  byId: ReadonlyMap<string, Element>;
  shot(frame: Frame, scene: Scene): Shot;
  text: SheetText;
}

const key = (name: string) => name.trim().toLocaleLowerCase();

export function sceneSheets(input: SheetInput): SceneSheet[] {
  const { groups, elements, days, byId, text } = input;
  const order = groups.flatMap((g) => (g.scene ? [g] : []));
  const characters = elements.flatMap((el) => (el.type === 'character' ? [el] : []));
  const locations = elements.flatMap((el) => (el.type === 'location' ? [el] : []));
  const castOf = (group: SceneGroup) =>
    new Set(group.frames.flatMap((f) => (f.cast ?? []).map(key)));
  const castByScene = new Map(order.map((g) => [g.scene?.id, castOf(g)]));
  const appears = (group: SceneGroup, name: string, numbers: readonly string[]) =>
    castByScene.get(group.scene?.id)?.has(name) || numbers.includes(group.scene?.number ?? '');

  return input.scenes.map((scene) => {
    const index = order.findIndex((g) => g.scene?.id === scene.id);
    const group = order[index] ?? { scene, frames: [] };
    const frames = group.frames;
    const frameIds = new Set(frames.map((f) => f.id));

    // Who is in the scene: names in the cast of its frames, then cards that list its number.
    const names = new Map<string, string>();
    for (const frame of frames)
      for (const name of frame.cast ?? []) if (!names.has(key(name))) names.set(key(name), name);
    for (const card of characters)
      if (card.scenes?.includes(scene.number) && !names.has(key(card.name)))
        names.set(key(card.name), card.name);
    const people = [...names].map(([k, typed]) => {
      const card = characters.find((c) => key(c.name) === k);
      const numbers = card?.scenes ?? [];
      const before = order
        .slice(0, Math.max(index, 0))
        .reverse()
        .find((g) => appears(g, k, numbers))?.scene;
      const after = order.slice(index + 1).find((g) => appears(g, k, numbers))?.scene;
      const name = card?.name.trim() || typed;
      return {
        name,
        actor: card?.actor?.trim() ?? '',
        costume: card?.costume?.trim() ?? '',
        refs: card?.references ?? [],
        continuity:
          before || after
            ? text.continuity(
                name,
                before ? `${before.number} (${text.slugline(before)})`.replace(' ()', '') : '',
                after?.number ?? '',
              )
            : '',
      } satisfies SheetCharacter;
    });

    // The first shooting day that shoots one of its frames.
    const dayIndex = days.findIndex((d) =>
      d.blocks.some((b) => b.shotId && frameIds.has(b.shotId)),
    );
    const day = days[dayIndex];
    const dayNumbers = day
      ? sceneIdsOf(day, byId).flatMap((id) => {
          const el = byId.get(id);
          return el?.type === 'scene' && el.number ? [el.number] : [];
        })
      : [];
    const notes = day
      ? [
          ...new Set(
            day.blocks
              .filter((b) => b.shotId && frameIds.has(b.shotId))
              .flatMap((b) => b.departments.map((d) => d.trim()).filter(Boolean)),
          ),
        ]
      : [];

    const place =
      locations.find((l) => l.scenes?.includes(scene.number)) ??
      (scene.location ? locations.find((l) => key(l.name) === key(scene.location ?? '')) : null);

    const needed = new Map<string, { text: string; count: number; list: number }>();
    for (const el of elements) {
      if (el.type !== 'todo' || !el.list || el.sceneId !== scene.id) continue;
      for (const item of el.items) {
        const value = item.text.trim();
        if (!value) continue;
        const row = needed.get(`${el.list}\u0000${key(value)}`) ?? {
          text: value,
          count: 0,
          list: TODO_LISTS.indexOf(el.list),
        };
        row.count += 1;
        needed.set(`${el.list}\u0000${key(value)}`, row);
      }
    }

    const plans = elements.flatMap((el) => {
      if (el.type !== 'plan' || !el.sceneIds?.includes(scene.id)) return [];
      const base = el.variantOf ? byId.get(el.variantOf) : undefined;
      return [base?.type === 'plan' ? variantView(el, base) : el];
    });

    const slug = text.slugline(scene);
    return {
      overline: [text.project, day ? text.day(dayIndex + 1, day.date) : '']
        .filter(Boolean)
        .join(' · '),
      heading: [scene.number, slug || scene.title.trim()].filter(Boolean).join(' · '),
      call: day ? clockLabel(clockMinutes(day.callTime)) : '',
      // The address when the export may show it, else the place as the scene names it.
      location: place?.address?.trim() || scene.location?.trim() || place?.name.trim() || '',
      locationDetail: place?.notes?.trim() ?? '',
      light: place?.light?.trim() ?? '',
      time: text.time(scene),
      synopsis: scene.synopsis?.trim() ?? '',
      shots: frames.map((f) => input.shot(f, scene)),
      plans,
      characters: people,
      cast: people.map((p) => (p.actor ? `${p.name} (${p.actor})` : p.name)).join(', '),
      day: day ? text.dayOf(dayIndex + 1, days.length, dayNumbers.join(', ')) : '',
      needed: [...needed.values()]
        .sort((a, b) => a.list - b.list)
        .map((row) => (row.count > 1 ? `${row.text} ×${row.count}` : row.text)),
      notes,
    };
  });
}

/** What the printed sheet says, in the reader's language. */
export interface SheetWords {
  /** The department, in the pill of the header. */
  department: string;
  /** "Inkadra · The team". */
  footer: string;
  /** "1 / 6". */
  pageOf(n: number, total: number): string;
  /** Printed when no scene is left. */
  none: string;
  call: string;
  location: string;
  time: string;
  cast: string;
  frames: string;
  characters: string;
  inScene: string;
  /** "Played by Giulia R." */
  playedBy(actor: string): string;
  continuity: string;
  setPlan: string;
  /** The kit of a plan, "Fresnel 2K ×1", and its power per circuit (decision 0111). */
  planKit?:
    | ((plan: Extract<Element, { type: 'plan' }>) => {
        kit: { label: string; lines: string[] } | null;
        power: { label: string; lines: string[] } | null;
      })
    | undefined;
  frameNotes: string;
  light: string;
  shootingDay: string;
  needed: string;
  notes: string;
  production: string;
  columns: Record<'frame' | 'number' | 'size' | 'angle' | 'movement' | 'lens' | 'notes', string>;
}

type Fact = 'call' | 'location' | 'time' | 'cast' | 'frames' | 'characters';

/** The facts under the heading, by department; empty ones are left out. */
export const SHEET_FACTS: Record<Department, Fact[]> = {
  everything: ['call', 'location', 'time', 'cast', 'frames'],
  camera: ['location', 'cast', 'frames'],
  lighting: ['location', 'time', 'frames'],
  costume: ['location', 'time', 'characters'],
  production: ['call', 'time', 'frames'],
};

function factValue(sheet: SceneSheet, fact: Fact): string {
  switch (fact) {
    case 'frames':
      return sheet.shots.length ? String(sheet.shots.length) : '';
    case 'characters':
      return sheet.characters.length ? String(sheet.characters.length) : '';
    case 'cast':
      return sheet.characters.map((c) => c.name).join(', ');
    default:
      return sheet[fact];
  }
}

/** Space for the footer under the content: its rule, its line and a gap. */
const FOOT = 24;
const GAP = 6;
const LABEL_W = 120;

type Block = { h: number; keep?: boolean; draw: (top: number) => Op[] };

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

/**
 * The pages of the sheets: one scene per page, a long scene flowing onto more pages under the
 * same header. Each page draws its own footer once the document's page count is known.
 */
export function sceneSheetPages(
  setup: PageSetup,
  sheets: readonly SceneSheet[],
  department: Department,
  ctx: CardContext,
  words: SheetWords,
): Page[] {
  const { width, height } = pageSize(setup.paper, setup.orientation);
  const c = ctx.colors;
  const m = ctx.measure;
  const x = MARGIN;
  const w = width - MARGIN * 2;
  const bottom = height - MARGIN - FOOT;
  const newPage = (): Page => ({
    width,
    height,
    ops: [],
    ownChrome: (n, total) => {
      const base = height - MARGIN;
      const label = words.pageOf(n, total);
      return [
        {
          kind: 'line',
          x1: x,
          y1: base - 12,
          x2: x + w,
          y2: base - 12,
          color: c['border-default'],
          width: 0.5,
        },
        text(words.footer, x, base, 7.5, 400, c['text-muted']),
        text(label, x + w - m(label, 7.5, 400), base, 7.5, 400, c['text-muted']),
      ];
    },
  });

  if (sheets.length === 0) {
    const page = newPage();
    page.ops.push(text(words.none, x, MARGIN + 20, 11, 400, c['text-muted']));
    return [page];
  }

  // Header of every page of a sheet: project and day, the scene, the department.
  const header = (ops: Op[], sheet: SceneSheet): number => {
    const pillW = m(words.department, 8, 600) + 18;
    const room = w - pillW - 16;
    ops.push(
      text(
        ellipsize(sheet.overline.toLocaleUpperCase(), room, 8, 600, m),
        x,
        MARGIN + 8,
        8,
        600,
        c['text-secondary'],
      ),
    );
    const title = textBlock(wrapText(sheet.heading, room, 18, 'heading', m, 2), x, MARGIN + 13, {
      size: 18,
      weight: 'heading',
      leading: 23,
      color: c['text-primary'],
    });
    ops.push(...title.ops);
    ops.push(
      {
        kind: 'rect',
        x: x + w - pillW,
        y: MARGIN,
        w: pillW,
        h: 18,
        radius: 9,
        stroke: c['border-strong'],
        lineWidth: 0.75,
      },
      text(words.department, x + w - pillW + 9, MARGIN + 12.3, 8, 600, c['text-primary']),
    );
    const rule = title.bottom + 8;
    ops.push({
      kind: 'line',
      x1: x,
      y1: rule,
      x2: x + w,
      y2: rule,
      color: c['border-strong'],
      width: 0.75,
    });
    return rule + 10;
  };

  const section = (title: string): Block => ({
    h: 22,
    keep: true,
    draw: (top) => [
      text(
        ellipsize(title.toLocaleUpperCase(), w, 8, 600, m),
        x,
        top + 15,
        8,
        600,
        c['text-secondary'],
      ),
    ],
  });

  const paragraph = (value: string, color = c['text-primary']): Block => {
    const lines = wrapText(value, w, 9.5, 400, m, 12);
    return {
      h: lines.length * 13.5 + 4,
      draw: (top) => textBlock(lines, x, top, { size: 9.5, weight: 400, leading: 13.5, color }).ops,
    };
  };

  /** A label in a narrow column and its value: Location, Cast, Needed… */
  const row = (label: string, values: readonly string[], boldFirst = false): Block => {
    const vw = w - LABEL_W - GAP;
    const parts = values.map((value, i) => {
      const weight: FontWeight = boldFirst && i === 0 ? 600 : 400;
      return { weight, lines: wrapText(value, vw, 9.5, weight, m, 8), first: i === 0 };
    });
    const h =
      Math.max(
        14,
        parts.reduce((s, p) => s + p.lines.length * 13.5, 0),
      ) + 10;
    return {
      h,
      draw: (top) => {
        const ops: Op[] = [
          text(
            ellipsize(label.toLocaleUpperCase(), LABEL_W, 7, 600, m),
            x,
            top + 13,
            7,
            600,
            c['text-muted'],
          ),
        ];
        let y = top + 4;
        for (const part of parts) {
          const block = textBlock(part.lines, x + LABEL_W + GAP, y, {
            size: 9.5,
            weight: part.weight,
            leading: 13.5,
            color: boldFirst && !part.first ? c['text-secondary'] : c['text-primary'],
          });
          ops.push(...block.ops);
          y = block.bottom;
        }
        ops.push({
          kind: 'line',
          x1: x,
          y1: top + h,
          x2: x + w,
          y2: top + h,
          color: c['border-default'],
          width: 0.5,
        });
        return ops;
      },
    };
  };

  const framesTable = (shots: readonly Shot[], withNotes: boolean): Block[] => {
    const fixed: Array<[keyof SheetWords['columns'], number]> = [
      ['frame', 84],
      ['number', 38],
      ['size', 52],
      ['angle', 52],
      ['movement', 58],
      ['lens', 44],
    ];
    const used = fixed.reduce((s, [, cw]) => s + cw + GAP, 0);
    const cols = [...fixed, ...(withNotes ? [['notes', w - used] as const] : [])].reduce<
      Array<{ key: keyof SheetWords['columns']; x: number; w: number }>
    >((out, [k, cw]) => {
      const prev = out.at(-1);
      out.push({ key: k, x: prev ? prev.x + prev.w + GAP : 0, w: cw });
      return out;
    }, []);
    const head: Block = {
      h: 16,
      keep: true,
      draw: (top) => [
        ...cols.map((col) =>
          text(
            ellipsize(words.columns[col.key].toLocaleUpperCase(), col.w, 7, 600, m),
            x + col.x,
            top + 10,
            7,
            600,
            c['text-muted'],
          ),
        ),
        {
          kind: 'line',
          x1: x,
          y1: top + 15,
          x2: x + w,
          y2: top + 15,
          color: c['border-default'],
          width: 0.5,
        },
      ],
    };
    const rows = shots.map((shot): Block => {
      const f = shot.frame;
      const values: Record<string, string> = {
        number: shot.label,
        size: shot.size,
        angle: shot.angle,
        movement: shot.movement,
        lens: f.lens ?? '',
        notes: f.notes ?? '',
      };
      const cells = cols
        .filter((col) => col.key !== 'frame')
        .map((col) => ({
          col,
          weight: (col.key === 'number' ? 600 : 400) as FontWeight,
          lines: wrapText(
            values[col.key] ?? '',
            col.w,
            9,
            col.key === 'number' ? 600 : 400,
            m,
            col.key === 'notes' ? 5 : 2,
          ),
        }));
      const thumb = cols[0] as { w: number };
      const ph = Math.min(thumb.w / ctx.frameAspect(f), 64);
      const pw = ph * ctx.frameAspect(f);
      const lines = Math.max(1, ...cells.map((cell) => cell.lines.length));
      const h = Math.max(ph, lines * 12) + 8;
      return {
        h,
        draw: (top) => {
          const box = { x, y: top + 4, w: pw, h: ph };
          const has = f.assetId || f.strokes?.length || f.shapes?.length;
          const ops: Op[] = has ? framePicture(f, box, ctx) : [picture(undefined, box, 'cover', c)];
          for (const cell of cells)
            ops.push(
              ...textBlock(cell.lines, x + cell.col.x, top + 4, {
                size: 9,
                weight: cell.weight,
                leading: 12,
                color:
                  cell.col.key === 'number' || cell.col.key === 'notes'
                    ? c['text-primary']
                    : c['text-secondary'],
              }).ops,
            );
          ops.push({
            kind: 'line',
            x1: x,
            y1: top + h,
            x2: x + w,
            y2: top + h,
            color: c['border-default'],
            width: 0.5,
          });
          return ops;
        },
      };
    });
    return shots.length ? [section(words.frames), head, ...rows] : [];
  };

  const planBlocks = (plans: readonly Plan[]): Block[] =>
    plans.flatMap((plan) => {
      const title =
        plan.variantOf && plan.variant
        ? [plan.title || words.setPlan, plan.variant].filter(Boolean).join(' · ')
        : [words.setPlan, plan.title].filter(Boolean).join(' · ');
      // Short, as in the mockup: the plan fits under a scene's frames on the same page.
      const h = Math.min(w / PLAN_ASPECT, 180);
      return [
        section(title),
        {
          h: h + 8,
          draw: (top) => {
            const box = { x, y: top, w, h };
            const dh = h - 12;
            const dw = Math.min(w - 12, dh * PLAN_ASPECT);
            const drawing = { x: x + (w - dw) / 2, y: top + 6, w: dw, h: dw / PLAN_ASPECT };
            return [
              {
                kind: 'rect',
                ...box,
                radius: 2,
                fill: c['bg-canvas'],
                stroke: c['border-default'],
                lineWidth: 0.75,
              },
              { kind: 'clip', ...drawing, ops: planOps(plan, drawing, ctx) },
            ];
          },
        },
        // The kit as the call sheet prints it, and the power per circuit, computed each time.
        ...(() => {
          const extra = words.planKit?.(plan);
          return [extra?.kit, extra?.power].flatMap((part) =>
            part?.lines.length ? [row(part.label, part.lines)] : [],
          );
        })(),
      ];
    });

  const characterBlocks = (sheet: SceneSheet): Block[] => {
    if (!sheet.characters.length) return [];
    const left = 130;
    const rw = w - left - GAP * 2;
    const rows = sheet.characters.map((person): Block => {
      const [first = '', ...rest] = person.costume.split('\n');
      const look = wrapText(first, rw, 9.5, 600, m, 2);
      const more = wrapText(rest.join('\n').trim(), rw, 9, 400, m, 6);
      const name = wrapText(person.name.toLocaleUpperCase(), left, 9.5, 600, m, 2);
      const actor = person.actor ? wrapText(words.playedBy(person.actor), left, 9, 400, m, 2) : [];
      const refs = person.refs.length ? 52 : 0;
      const h =
        Math.max(
          (name.length + actor.length) * 13,
          (look.length + more.length) * 13 + (refs ? refs + 4 : 0),
        ) + 12;
      return {
        h,
        draw: (top) => {
          const ops: Op[] = [];
          const n = textBlock(name, x, top + 6, {
            size: 9.5,
            weight: 600,
            leading: 13,
            color: c['text-primary'],
          });
          ops.push(...n.ops);
          ops.push(
            ...textBlock(actor, x, n.bottom, {
              size: 9,
              weight: 400,
              leading: 13,
              color: c['text-secondary'],
            }).ops,
          );
          const rx = x + left + GAP * 2;
          const a = textBlock(look, rx, top + 6, {
            size: 9.5,
            weight: 600,
            leading: 13,
            color: c['text-primary'],
          });
          ops.push(...a.ops);
          const b = textBlock(more, rx, a.bottom, {
            size: 9,
            weight: 400,
            leading: 13,
            color: c['text-primary'],
          });
          ops.push(...b.ops);
          let px = rx;
          for (const ref of person.refs) {
            if (px + 39 > x + w) break;
            const img = ctx.image(ref);
            ops.push(picture(img?.key, { x: px, y: b.bottom + 4, w: 39, h: refs }, 'cover', c));
            px += 39 + 5;
          }
          ops.push({
            kind: 'line',
            x1: x,
            y1: top + h,
            x2: x + w,
            y2: top + h,
            color: c['border-default'],
            width: 0.5,
          });
          return ops;
        },
      };
    });
    const continuity = sheet.characters.map((p) => p.continuity).filter(Boolean);
    return [
      section(words.inScene),
      ...rows,
      ...(continuity.length
        ? [
            section(words.continuity),
            ...continuity.map((line) => paragraph(line, c['text-secondary'])),
          ]
        : []),
    ];
  };

  const productionBlocks = (sheet: SceneSheet, withTitle: boolean): Block[] => {
    const rows: Block[] = [];
    if (sheet.location)
      rows.push(row(words.location, [sheet.location, sheet.locationDetail].filter(Boolean), true));
    if (sheet.cast) rows.push(row(words.cast, [sheet.cast]));
    if (sheet.day) rows.push(row(words.shootingDay, [sheet.day]));
    if (sheet.needed.length)
      rows.push(
        row(
          words.needed,
          sheet.needed.map((item) => `• ${item}`),
        ),
      );
    if (sheet.notes.length) rows.push(row(words.notes, sheet.notes));
    return rows.length && withTitle ? [section(words.production), ...rows] : rows;
  };

  const lightBlocks = (sheet: SceneSheet, withFrameNotes: boolean): Block[] => {
    const out: Block[] = [];
    if (sheet.light) out.push(row(words.light, [sheet.light]));
    const noted = withFrameNotes ? sheet.shots.filter((s) => s.frame.notes?.trim()) : [];
    if (noted.length)
      out.push(
        section(words.frameNotes),
        ...noted.map((s) => row(s.label, [s.frame.notes?.trim() ?? ''])),
      );
    return out;
  };

  const blocksOf = (sheet: SceneSheet): Block[] => {
    switch (department) {
      case 'camera':
        return [...framesTable(sheet.shots, true), ...planBlocks(sheet.plans)];
      case 'lighting':
        return [...planBlocks(sheet.plans), ...lightBlocks(sheet, true)];
      case 'costume':
        return characterBlocks(sheet);
      case 'production':
        return productionBlocks(sheet, false);
      case 'everything':
        return [
          ...framesTable(sheet.shots, true),
          ...planBlocks(sheet.plans),
          ...lightBlocks(sheet, false),
          ...characterBlocks(sheet),
          ...productionBlocks(sheet, true),
        ];
    }
  };

  const pages: Page[] = [];
  for (const sheet of sheets) {
    let page = newPage();
    pages.push(page);
    let top = header(page.ops, sheet);

    const facts = SHEET_FACTS[department]
      .map((fact) => ({ label: words[fact], value: factValue(sheet, fact) }))
      .filter((fact) => fact.value);
    if (facts.length) {
      const cw = w / Math.max(4, facts.length);
      const cells = facts.map((fact) => wrapText(fact.value, cw - GAP, 9.5, 400, m, 2));
      const h = 11 + Math.max(...cells.map((lines) => lines.length)) * 12.5;
      facts.forEach((fact, i) => {
        const fx = x + i * cw;
        page.ops.push(
          text(
            ellipsize(fact.label.toLocaleUpperCase(), cw - GAP, 7, 600, m),
            fx,
            top + 7,
            7,
            600,
            c['text-muted'],
          ),
          ...textBlock(cells[i] ?? [], fx, top + 10, {
            size: 9.5,
            weight: 400,
            leading: 12.5,
            color: c['text-primary'],
          }).ops,
        );
      });
      page.ops.push({
        kind: 'line',
        x1: x,
        y1: top + h + 6,
        x2: x + w,
        y2: top + h + 6,
        color: c['border-default'],
        width: 0.5,
      });
      top += h + 14;
    }
    if (sheet.synopsis) {
      const lines = wrapText(sheet.synopsis, w, 10, 400, m, 10);
      page.ops.push(
        ...textBlock(lines, x, top, {
          size: 10,
          weight: 400,
          leading: 14,
          color: c['text-secondary'],
        }).ops,
      );
      top += lines.length * 14 + 8;
    }

    const blocks = blocksOf(sheet);
    let pageTop = top;
    blocks.forEach((block, i) => {
      // A heading stays with what follows it; a block taller than a page starts one of its own.
      const next = block.keep ? (blocks[i + 1]?.h ?? 0) : 0;
      if (top + block.h + next > bottom && top > pageTop) {
        page = newPage();
        pages.push(page);
        top = header(page.ops, sheet);
        pageTop = top;
      }
      page.ops.push(...block.draw(top));
      top += block.h;
    });
  }
  return pages;
}
