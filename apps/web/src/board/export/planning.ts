// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import {
  type CrewCharacter,
  type CrewMember,
  castNameKey,
  type Schedule,
  type ShootingDay,
} from '@inkadra/shared';
import type { TFunction } from 'i18next';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { api, RequestError } from '../../lib/api.ts';
import {
  dayAddress,
  departmentNotes,
  hasSceneNumbers,
  keyTimes,
  locationsOfDay,
  serveLines,
  sheetShot,
} from '../film/call-sheet.ts';
import {
  byDepartment,
  castCard,
  castRows,
  dayCrew,
  onSetContacts,
  sunOfDay,
  troupeRows,
} from '../film/day-calls.ts';
import { neededForDay } from '../film/needed.ts';
import { clockLabel, clockMinutes, scheduleTimes } from '../film/schedule.ts';
import { type CardContext, framePicture } from './board-render.ts';
import type { Section, sectionPages } from './compose.ts';
import { contentBox, pageSize, paginateRows } from './layout.ts';
import type { Op, Page } from './pages.ts';
import { textBlock, wrapText } from './text.ts';

/** What the call sheets and the scene sheets print: the board's shooting days. */
export interface Planning {
  days: ShootingDay[];
}

/** Shooting days of the board; out of reach, there are none. */
export async function loadPlanning(boardId: string): Promise<Planning> {
  const days = await api.get<Schedule>(`/boards/${boardId}/schedule`).then(
    (r) => r.items,
    (error) => {
      if (error instanceof RequestError && [403, 404].includes(error.status)) return [];
      throw error;
    },
  );
  return { days: [...days].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** A `YYYY-MM-DD` date in the reader's language, read as a calendar date. */
export function calendarDate(date: string, language: string, style: 'short' | 'long'): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) return date;
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: style,
    ...(style === 'long' ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(time);
}

/**
 * Team-only call sheet sections, derived from the same elements as the print dialog. The crew,
 * its phones, calls and pick-ups come only from the team's roster (decision 0092): the client
 * export never builds these sections.
 */
export function callSheetSections(
  day: ShootingDay,
  shotLabel: (id: string) => string | undefined,
  t: TFunction,
  elements: ReadonlyMap<string, Element> = new Map(),
  crew: readonly CrewMember[] = [],
  /** Character cards of other boards that crew rows link, and the project's clock for the sun. */
  more: { characters?: readonly CrewCharacter[]; timeZone?: string | undefined } = {},
): CallSheetSection[] {
  const times = keyTimes(day);
  const locations = locationsOfDay(day, elements);
  const address = dayAddress(day, elements);
  const entries = dayCrew(day, crew, elements, more.characters);
  const sun = sunOfDay(day, locations, more.timeZone, address);
  const sunCell = sun && (sun.sunrise !== null || sun.sunset !== null);
  const sunClock = (time: number | null) => (time === null ? '—' : clockLabel(time));
  const serve = serveLines(day, elements);
  const numbered = hasSceneNumbers(day, elements);
  const slots = scheduleTimes(day);
  const info: CallSheetSection = {
    title: t('callSheet.times'),
    header: true,
    columns: [...times.map(() => 1), ...(sunCell ? [1.6] : [])],
    rows: [
      [
        ...times.map(({ key }) => t(`callSheet.${key}`)),
        ...(sun && sunCell
          ? [sun.location ? t('callSheet.sun', { n: sun.location }) : t('callSheet.sunAddress')]
          : []),
      ],
      [
        ...times.map(({ time }) => clockLabel(time)),
        ...(sun && sunCell ? [`${sunClock(sun.sunrise)} · ${sunClock(sun.sunset)}`] : []),
      ],
    ],
    empty: '',
  };
  const contact: CallSheetSection = {
    title: t('callSheet.onSetContact'),
    columns: [2, 2, 3],
    rows: onSetContacts(entries).map(({ member }) => [member.name, member.role, member.phone]),
    empty: '',
  };
  const troupeGroups = byDepartment(troupeRows(day, entries));
  const troupe: CallSheetSection = {
    title: t('callSheet.troupe'),
    header: true,
    columns: [2, 2, 1.6, 1, 2],
    rows: [
      [
        t('callSheet.name'),
        t('troupe.role'),
        t('callSheet.pickup'),
        t('callSheet.callShort'),
        t('troupe.phoneColumn'),
      ],
      ...troupeGroups.flatMap(({ department, people }) => [
        [department || t('troupe.noDepartment')],
        ...people.map((e) => [
          e.member.name,
          e.member.role,
          e.pickup.trim() || '—',
          clockLabel(e.call),
          e.member.phone.trim() || '—',
        ]),
      ]),
    ],
    tones: [
      undefined,
      ...troupeGroups.flatMap(({ people }) => [
        'surface-2' as const,
        ...people.map(() => undefined),
      ]),
    ],
    empty: '',
  };
  const location: CallSheetSection = {
    title: t('callSheet.location'),
    columns: [1, 4],
    empty: '',
    // The day's own address first, where the crew goes, then the numbered scene locations.
    rows: [
      ...(address ? [{ loc: address, label: t('callSheet.address') }] : []),
      ...locations.map((loc, n) => ({ loc, label: t('callSheet.locationNumber', { n: n + 1 }) })),
    ].map(({ loc, label }) => [
      label,
      [loc.name, loc.address, loc.mapUrl ? t('story.location.openMap') : '']
        .filter(Boolean)
        .join('\n'),
    ]),
  };
  location.links = [...(address ? [address] : []), ...locations].map((loc) => loc.mapUrl);
  // Breaks, moves, set-ups and the closing times read across the table after their time.
  const aside = (block: { type: string; shotId: string | null }) =>
    block.type !== 'shot' && !block.shotId;
  const schedule: CallSheetSection = {
    title: t('callSheet.schedule'),
    header: true,
    columns: [1.5, ...(numbered ? [1] : []), 1.3, 3, 1.5, ...(locations.length > 1 ? [1] : [])],
    rows: [
      [
        t('callSheet.time'),
        ...(numbered ? [t('callSheet.scene')] : []),
        t('callSheet.shot'),
        t('callSheet.description'),
        t('callSheet.cast'),
        ...(locations.length > 1 ? [t('callSheet.place')] : []),
      ],
      ...slots.map(({ block, start, end }) => {
        const time = `${clockLabel(start)} – ${clockLabel(end)}`;
        if (aside(block))
          return [
            time,
            [t(`schedule.types.${block.type}`), block.title.trim()].filter(Boolean).join(' · '),
          ];
        const { frame, scene } = sheetShot(block.shotId, elements);
        const loc = locations.findIndex(
          (loc) =>
            loc.name.trim().toLocaleLowerCase() === scene?.location?.trim().toLocaleLowerCase(),
        );
        return [
          time,
          ...(numbered ? [scene?.number ?? ''] : []),
          block.shotId ? (shotLabel(block.shotId) ?? t('schedule.missingShot')) : '',
          [
            frame?.action || block.title.trim() || t(`schedule.types.${block.type}`),
            serve.has(block.id) ? t('callSheet.serve', { items: serve.get(block.id) }) : '',
          ]
            .filter(Boolean)
            .join('\n'),
          block.cast.join(', '),
          ...(locations.length > 1
            ? [loc >= 0 ? t('callSheet.locationNumber', { n: loc + 1 }) : '']
            : []),
        ];
      }),
    ],
    pictures: [undefined, ...slots.map(({ block }) => sheetShot(block.shotId, elements).frame)],
    notes: [undefined, ...slots.map(({ block }) => block.notes?.trim() || undefined)],
    pictureColumn: numbered ? 2 : 1,
    descriptionColumn: numbered ? 3 : 2,
    tones: [
      undefined,
      ...slots.map(({ block }) =>
        block.type === 'break'
          ? 'tag-green-bg'
          : block.type === 'move'
            ? 'tag-orange-bg'
            : aside(block)
              ? 'surface-2'
              : undefined,
      ),
    ],
    empty: t('callSheet.noBlocks'),
  };
  for (const { key, time } of times.filter(
    ({ key }) => key === 'cameraWrap' || key === 'crewWrap',
  )) {
    schedule.rows.push([clockLabel(time), t(`callSheet.${key}`)]);
    schedule.tones?.push('surface-2');
  }
  const calls = castRows(day, entries);
  const cards = calls.map((c) => castCard(c.name, c.entry, elements, more.characters));
  const dayCall = clockMinutes(day.callTime);
  const cast: CallSheetSection = {
    title: t('callSheet.cast'),
    header: true,
    columns: [2, 2, 1.6, 1, 1, 2.4],
    rows: [
      [
        t(
          cards.some(Boolean) ||
            calls.some((c) => c.entry && castNameKey(c.entry.member.name) !== castNameKey(c.name))
            ? 'callSheet.character'
            : 'callSheet.name',
        ),
        t('story.character.actor'),
        t('callSheet.pickup'),
        t('callSheet.callShort'),
        t('callSheet.inScene'),
        t('callSheet.contact'),
      ],
      ...calls.map(({ name, start, entry }, i) => {
        const card = cards[i];
        const actor =
          card?.actor ||
          (entry && castNameKey(entry.member.name) !== castNameKey(name) ? entry.member.name : '');
        return [
          name,
          actor,
          entry?.pickup.trim() || '—',
          clockLabel(entry?.call ?? dayCall),
          clockLabel(start),
          card?.contact || entry?.member.phone || '',
        ];
      }),
    ],
    empty: '',
  };
  const departments: CallSheetSection = {
    title: t('callSheet.departments'),
    columns: [2, 5],
    rows: departmentNotes(day).map((d) => [d.department, d.note]),
    empty: '',
  };
  const notes: CallSheetSection = {
    title: t('callSheet.notes'),
    columns: [1],
    rows: day.notes.trim() ? [[day.notes.trim()]] : [],
    empty: '',
  };
  const needed: CallSheetSection = {
    title: t('callSheet.needed'),
    columns: [3, 1],
    empty: '',
    rows: neededForDay(day, elements.values()).map((row) => [
      `${row.text}${row.count > 1 ? ` ×${row.count}` : ''}`,
      row.scenes.join(', '),
    ]),
  };
  return [
    info,
    contact,
    location,
    ...(troupeGroups.length ? [troupe] : []),
    schedule,
    ...(calls.length ? [cast] : []),
    departments,
    needed,
    notes,
  ].filter((section) => section.rows.length || section === schedule);
}

interface CallSheetSection extends Section {
  /** The first row names the columns: it stays on the page of the row after it. */
  header?: boolean;
  links?: Array<string | undefined>;
  pictures?: Array<Extract<Element, { type: 'frame' }> | undefined>;
  /** A block's own note, drawn semibold in the warning colour under the description. */
  notes?: Array<string | undefined>;
  pictureColumn?: number;
  descriptionColumn?: number;
  tones?: Array<'tag-green-bg' | 'tag-orange-bg' | 'surface-2' | undefined>;
}

/** The call sheet needs pictures and semantic row colours; the generic text tables stay unchanged. */
export function callSheetPages(
  setup: Parameters<typeof sectionPages>[0],
  heading: string,
  sections: CallSheetSection[],
  ctx: CardContext,
): Page[] {
  const { width, height } = pageSize(setup.paper, setup.orientation);
  const box = contentBox(width, height);
  const paginate = (blocks: ReturnType<typeof sheetBlocks>) =>
    paginateRows(
      blocks.map((block) => block.h),
      box.h - 35,
      blocks.map((block) => !!block.keep),
    );
  let blocks = sheetBlocks(sections, box, ctx, false);
  let pages = paginate(blocks);
  // A last page holding only a one-line section: tighter spacing, when it saves that page.
  const last = pages.at(-1) ?? [];
  if (pages.length > 1 && last.length <= 2 && blocks[last[0] ?? -1]?.title) {
    const compact = sheetBlocks(sections, box, ctx, true);
    const fewer = paginate(compact);
    if (fewer.length < pages.length) [blocks, pages] = [compact, fewer];
  }
  return pages.map((indexes) => {
    const ops: Op[] = [
      {
        kind: 'text',
        x: box.x,
        y: box.y + 16,
        text: heading,
        size: 12,
        weight: 600,
        color: ctx.colors['text-primary'],
      },
    ];
    const callSheetLinks: MapLink[] = [];
    let top = box.y + 35;
    for (const index of indexes) {
      const block = blocks[index];
      if (block) {
        ops.push(...block.draw(top));
        if (block.link && /^https?:\/\//i.test(block.link))
          callSheetLinks.push({ url: block.link, x: box.x, y: top, w: box.w, h: block.h });
        top += block.h;
      }
    }
    return { width, height, ops, callSheetLinks };
  });
}

/**
 * The titles and rows of a call sheet, each with the height it takes. A title stays with its
 * first row, a department with its people, and a table never leaves one row alone at the top or
 * the bottom of a page. `compact` trims the spacing.
 */
function sheetBlocks(
  sections: CallSheetSection[],
  box: ReturnType<typeof contentBox>,
  ctx: CardContext,
  compact: boolean,
) {
  const pad = compact ? 6 : 10;
  const blocks: Array<{
    h: number;
    keep?: boolean;
    title?: boolean;
    link?: string | undefined;
    draw: (top: number) => Op[];
  }> = [];
  for (const section of sections) {
    blocks.push({
      h: compact ? 22 : 28,
      keep: true,
      title: true,
      draw: (top) => [
        {
          kind: 'text',
          x: box.x,
          y: top + (compact ? 15 : 18),
          text: section.title,
          size: 11,
          weight: 600,
          color: ctx.colors['text-primary'],
        },
      ],
    });
    const total = section.columns.reduce((a, b) => a + b, 0);
    const rows = section.rows.length ? section.rows : [[section.empty]];
    const first = section.header ? 1 : 0;
    const several = rows.length - first > 1;
    for (const [index, row] of rows.entries()) {
      const frame = section.pictures?.[index];
      const tone = section.tones?.[index];
      let left = 0;
      const short = row.length < section.columns.length;
      const note = section.notes?.[index];
      const cells = row.map((value, col) => {
        // A row shorter than the table, such as a break, gives its last cell the rest of the width.
        const w =
          col === row.length - 1 && short
            ? box.w - left
            : (box.w * (section.columns[col] ?? total)) / total;
        const x = left;
        left += w;
        const described = col === (short ? row.length - 1 : section.descriptionColumn);
        const wrap = (text: string, weight: 400 | 600) =>
          wrapText(text, w - 8, 8.5, weight, ctx.measure);
        const [first = '', ...rest] = value.split('\n');
        // Description: its first paragraph, the block's note, then the muted lines.
        const head = described && (note || rest.length) ? wrap(first, 400) : wrap(value, 400);
        const noted = described && note ? wrap(note, 600) : [];
        const tail = described && rest.length ? wrap(rest.join('\n'), 400) : [];
        return {
          x,
          w,
          lines: [...head, ...noted, ...tail],
          picture: frame && col === section.pictureColumn,
          noteFrom: head.length,
          mutedFrom: described && rest.length ? head.length + noted.length : Infinity,
        };
      });
      const h =
        Math.max(1, ...cells.map((cell) => cell.lines.length)) * 12 + pad + (frame ? 36 : 0);
      blocks.push({
        h,
        keep:
          (index < first && rows.length > 1) ||
          // A department heading of the troupe: one cell across the table.
          (row.length === 1 && section.columns.length > 1) ||
          (several && (index === first || index === rows.length - 2)),
        link: section.links?.[index],
        draw: (top) => [
          ...(tone
            ? [{ kind: 'rect' as const, x: box.x, y: top, w: box.w, h, fill: ctx.colors[tone] }]
            : []),
          ...cells.flatMap((cell) => [
            ...(cell.picture && frame
              ? framePicture(
                  frame,
                  { x: box.x + cell.x, y: top + pad / 2 - 1, w: cell.w - 8, h: 32 },
                  ctx,
                )
              : []),
            ...cell.lines.flatMap(
              (line, n) =>
                textBlock(
                  [line],
                  box.x + cell.x,
                  top + pad / 2 + (cell.picture ? 36 : 0) + n * 12,
                  {
                    size: 8.5,
                    weight: n >= cell.noteFrom && n < cell.mutedFrom && note ? 600 : 400,
                    leading: 12,
                    color:
                      ctx.colors[
                        n >= cell.mutedFrom
                          ? 'text-secondary'
                          : n >= cell.noteFrom && note
                            ? 'tag-orange'
                            : 'text-primary'
                      ],
                  },
                ).ops,
            ),
          ]),
        ],
      });
    }
  }
  return blocks;
}

interface MapLink {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Preserve clickable team map links without changing the shared drawing-operation format. */
export async function linkCallSheetPdf(
  bytes: Uint8Array,
  pages: readonly Page[],
): Promise<Uint8Array> {
  const links = pages.map(
    (page) => (page as Page & { callSheetLinks?: MapLink[] }).callSheetLinks ?? [],
  );
  if (!links.some((page) => page.length)) return bytes;
  const pdf = await PDFDocument.load(bytes);
  for (const [index, entries] of links.entries()) {
    const page = pdf.getPage(index);
    for (const link of entries) {
      if (!/^https?:\/\//i.test(link.url)) continue;
      const annotation = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [
          link.x,
          page.getHeight() - link.y - link.h,
          link.x + link.w,
          page.getHeight() - link.y,
        ],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: PDFName.of('URI'), URI: PDFString.of(link.url) },
      });
      page.node.addAnnot(pdf.context.register(annotation));
    }
  }
  return pdf.save();
}
