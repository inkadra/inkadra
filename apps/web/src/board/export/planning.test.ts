// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import type { CrewMember, ShootingDay } from '@inkadra/shared';
import { light } from '@inkadra/ui/tokens';
import type { TFunction } from 'i18next';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { CardContext } from './board-render.ts';
import { callSheetPages, callSheetSections, linkCallSheetPdf } from './planning.ts';

// Keys with their values, so the tests read what each cell says.
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}${JSON.stringify(vars)}` : key) as unknown as TFunction;

const day = (date: string, extra: Partial<ShootingDay> = {}): ShootingDay => ({
  id: `day-${date}`,
  projectId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
  boardId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11',
  revision: 1,
  date,
  callTime: '07:00',
  wrap: '19:00',
  location: 'Rifugio',
  notes: '',
  blocks: [],
  ...extra,
});

describe('call sheet pages', () => {
  it('prints the day, its blocks with their shots, the cast calls and the departments', () => {
    const sections = callSheetSections(
      day('2026-11-10', {
        notes: 'Pranzo al sacco',
        blocks: [
          {
            id: 'b1',
            type: 'setup',
            title: '',
            start: null,
            duration: 30,
            shotId: null,
            cast: [],
            departments: ['Camera: dolly'],
          },
          {
            id: 'b2',
            type: 'shot',
            title: 'Arrivo',
            start: null,
            duration: 60,
            shotId: 'frame0001',
            cast: ['Marta'],
            departments: [],
          },
        ],
      }),
      (id) => (id === 'frame0001' ? '1A' : undefined),
      t,
    );
    const [info, location, schedule, cast, departments, notes] = sections;
    expect(info?.rows).toEqual([
      ['callSheet.call', 'callSheet.ready', 'callSheet.cameraWrap', 'callSheet.crewWrap'],
      ['07:00', '07:30', '08:30', '19:00'],
    ]);
    expect(location?.rows).toEqual([['callSheet.locationNumber{"n":1}', 'Rifugio']]);
    expect(schedule?.rows.slice(1)).toEqual([
      ['07:00 – 07:30', 'schedule.types.setup'],
      ['07:30 – 08:30', '1A', 'Arrivo', 'Marta'],
      ['08:30', 'callSheet.cameraWrap'],
      ['19:00', 'callSheet.crewWrap'],
    ]);
    expect(cast?.rows.at(-1)).toEqual(['Marta', '', '—', '07:00', '07:30', '']);
    expect(departments?.rows).toEqual([['Camera', 'dolly']]);
    expect(notes?.rows).toEqual([['Pranzo al sacco']]);
  });
});

describe("the day's Location beside the scene locations", () => {
  it('prints the address the crew needs before the numbered scene locations', () => {
    const elements = new Map<string, Element>([
      [
        'scene0001',
        {
          id: 'scene0001',
          type: 'scene',
          number: '1',
          location: 'Scogliera',
        } as unknown as Element,
      ],
      ['frame0001', { id: 'frame0001', type: 'frame', parent: 'scene0001' } as unknown as Element],
    ]);
    const shotBlocks: ShootingDay['blocks'] = [
      {
        id: 'b1',
        type: 'shot',
        title: '',
        start: null,
        duration: 30,
        shotId: 'frame0001',
        cast: [],
        departments: [],
      },
    ];
    const sections = callSheetSections(
      day('2026-11-21', { location: 'Faro\nVia del Faro', blocks: shotBlocks }),
      () => '1A',
      t,
      elements,
    );
    expect(sections.find((s) => s.title === 'callSheet.location')?.rows).toEqual([
      ['callSheet.address', 'Faro\nVia del Faro'],
      ['callSheet.locationNumber{"n":1}', 'Scogliera'],
    ]);
    // A location card named like the day's place, but empty, keeps the day's address.
    elements.set('loc00001', { id: 'loc00001', type: 'location', name: 'Faro' } as unknown as Element);
    const again = callSheetSections(
      day('2026-11-21', { location: 'Faro\nVia del Faro', blocks: shotBlocks }),
      () => '1A',
      t,
      elements,
    );
    expect(again.find((s) => s.title === 'callSheet.location')?.rows[0]).toEqual([
      'callSheet.address',
      'Faro\nVia del Faro',
    ]);
  });
});

describe('the crew on the call sheet (decision 0092)', () => {
  const person = (n: number, extra: Partial<CrewMember>): CrewMember => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    projectId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
    name: `Person ${n}`,
    role: '',
    department: '',
    phone: '',
    email: '',
    pickup: '',
    notes: '',
    userId: null,
    character: null,
    onSetContact: false,
    position: n,
    revision: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  });
  const crew = [
    person(1, { name: 'Ada', role: 'DOP', department: 'Camera', phone: '+39 333 1' }),
    person(2, {
      name: 'Bea',
      role: 'AD',
      department: 'Regia',
      phone: '+39 333 2',
      onSetContact: true,
    }),
    person(3, { name: 'Marta', department: 'Cast', pickup: 'Hotel 06:30' }),
    person(4, { name: 'Nino', department: 'Cast' }),
  ];
  const shooting = day('2026-11-19', {
    location: 'Piazza https://www.openstreetmap.org/#map=17/45.0703/7.5210',
    blocks: [
      {
        id: 'b1',
        type: 'shot',
        title: 'Vetrina',
        start: null,
        duration: 60,
        shotId: null,
        cast: ['Marta'],
        departments: [],
        notes: 'LUMINARIE ACCESE',
      },
    ],
    calls: [
      { crewMemberId: crew[0]?.id ?? '', call: '06:30', pickup: null },
      { crewMemberId: crew[2]?.id ?? '', call: '06:45', pickup: null },
    ],
  });

  it('prints the contact, the called crew, the cast calls and the sunrise cell', () => {
    const sections = callSheetSections(shooting, () => undefined, t, new Map(), crew);
    const titles = sections.map((s) => s.title);
    expect(titles.slice(0, 4)).toEqual([
      'callSheet.times',
      'callSheet.onSetContact',
      'callSheet.location',
      'callSheet.troupe',
    ]);
    const [info, contact, , troupe] = sections;
    expect(info?.rows[0]?.at(-1)).toBe('callSheet.sun{"n":1}');
    expect(info?.rows[1]?.at(-1)).toMatch(/^\d\d:\d\d · \d\d:\d\d$/);
    expect(contact?.rows).toEqual([['Bea', 'AD', '+39 333 2']]);
    // Cast rows live in the cast table; Nino is not in the blocks and not called.
    expect(troupe?.rows.slice(1)).toEqual([
      ['Camera'],
      ['Ada', 'DOP', '—', '06:30', '+39 333 1'],
      ['Regia'],
      ['Bea', 'AD', '—', '07:00', '+39 333 2'],
    ]);
    const cast = sections.find((s) => s.title === 'callSheet.cast');
    expect(cast?.rows.at(-1)).toEqual(['Marta', '', 'Hotel 06:30', '06:45', '07:00', '']);
  });

  it('reads a character card of another board and the project clock', () => {
    const lead = person(5, {
      name: 'Giulia',
      department: 'Cast',
      character: { boardId: '00000000-0000-4000-8000-000000000998', elementId: 'char0001' },
    });
    const filmDay = { ...shooting, blocks: [{ ...shooting.blocks[0]!, cast: ['Luca'] }] };
    const characters = [
      {
        boardId: '00000000-0000-4000-8000-000000000998',
        elementId: 'char0001',
        name: 'Luca',
        actor: 'Giulia B.',
        contact: 'Agency',
      },
    ];
    const sections = callSheetSections(filmDay, () => undefined, t, new Map(), [lead], {
      characters,
      timeZone: 'Europe/Rome',
    });
    const cast = sections.find((s) => s.title === 'callSheet.cast');
    expect(cast?.rows[0]?.[0]).toBe('callSheet.character');
    expect(cast?.rows.at(-1)).toEqual(['Luca', 'Giulia B.', '—', '07:00', '07:00', 'Agency']);
    // Turin, 19 November, on the Rome clock: sunrise after 07:00, sunset before 17:00.
    expect(sections[0]?.rows[1]?.at(-1)).toMatch(/^07:\d\d · 16:\d\d$/);
  });

  it('draws a block note in the warning colour under its description', () => {
    const sections = callSheetSections(shooting, () => undefined, t, new Map(), crew);
    const ctx = {
      colors: light,
      measure: (text: string, size: number) => text.length * size * 0.5,
      image: () => undefined,
    } as unknown as CardContext;
    const pages = callSheetPages(
      { paper: 'a4', orientation: 'portrait' },
      'Call sheet',
      sections,
      ctx,
    );
    const ops = pages.flatMap((page) => page.ops);
    expect(ops).toContainEqual(
      expect.objectContaining({
        kind: 'text',
        text: 'LUMINARIE ACCESE',
        weight: 700,
        color: light['tag-orange'],
      }),
    );
  });

  it('prints no crew, phone, call or pick-up without the team’s roster', () => {
    const sections = callSheetSections(shooting, () => undefined, t);
    const text = JSON.stringify(sections.map((s) => s.rows));
    expect(sections.map((s) => s.title)).not.toContain('callSheet.troupe');
    expect(sections.map((s) => s.title)).not.toContain('callSheet.onSetContact');
    for (const secret of ['+39 333', 'Hotel 06:30', '06:30', '06:45', 'Bea'])
      expect(text).not.toContain(secret);
  });
});

it('renders shot pictures and semantic break/move colours across paginated PDF pages', () => {
  const frame = { id: 'frame001', type: 'frame', assetId: 'image001' } as Element;
  const elements = new Map([[frame.id, frame]]);
  const blocks = Array.from({ length: 40 }, (_, i) => ({
    id: `block-${i}`,
    type: i === 0 ? ('break' as const) : i === 1 ? ('move' as const) : ('shot' as const),
    title: 'Description of the shot',
    duration: 10,
    start: null,
    cast: [],
    departments: [],
    shotId: i > 1 ? frame.id : null,
  }));
  const sections = callSheetSections(day('2026-11-19', { blocks }), () => 'A', t, elements);
  const ctx = {
    colors: light,
    measure: (text: string, size: number) => text.length * size * 0.5,
    image: () => ({ key: 'image001', info: { width: 100, height: 60 } }),
  } as unknown as CardContext;
  const pages = callSheetPages(
    { paper: 'a4', orientation: 'portrait' },
    'Call sheet',
    sections,
    ctx,
  );
  expect(pages.length).toBeGreaterThan(1);
  const ops = pages.flatMap((page) => page.ops);
  expect(ops.some((op) => op.kind === 'rect' && op.fill === light['tag-green-bg'])).toBe(true);
  expect(ops.some((op) => op.kind === 'rect' && op.fill === light['tag-orange-bg'])).toBe(true);
  expect(ops.filter((op) => op.kind === 'clip')).toHaveLength(38);
  for (const page of pages) {
    for (const op of page.ops) if ('y' in op) expect(op.y).toBeLessThan(page.height);
  }
});

it('adds a clickable map annotation to its PDF page and skips pages without maps', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const bytes = await pdf.save();
  expect(await linkCallSheetPdf(bytes, [{ width: 595, height: 842, ops: [] }])).toBe(bytes);
  const elements = new Map<string, Element>([
    [
      'location',
      { type: 'location', name: 'Rifugio', mapUrl: 'https://example.com/map' } as Element,
    ],
  ]);
  const sections = callSheetSections(day('2026-11-19'), () => '', t, elements);
  const ctx = {
    colors: light,
    measure: (text: string, size: number) => text.length * size * 0.5,
    image: () => null,
  } as unknown as CardContext;
  const pages = callSheetPages(
    { paper: 'a4', orientation: 'portrait' },
    'Call sheet',
    sections,
    ctx,
  );
  const result = await PDFDocument.load(await linkCallSheetPdf(bytes, pages));
  expect(result.getPage(0).node.Annots()?.size()).toBe(1);
});

describe('call sheet layout', () => {
  const ctx = {
    colors: light,
    measure: (text: string, size: number) => text.length * size * 0.5,
    image: () => undefined,
  } as unknown as CardContext;
  const setup = { paper: 'a4', orientation: 'portrait' } as const;
  const shot = (i: number) => ({
    id: `block-${i}`,
    type: 'shot' as const,
    title: `Shot ${i}`,
    duration: 10,
    start: null,
    cast: [],
    departments: [],
    shotId: null,
  });

  it('prints the closing times across the table on the neutral band of the sheet', () => {
    const wrapLabel = 'Camera wrap, the last shot of the day';
    const long = ((key: string, vars?: Record<string, unknown>) =>
      key === 'callSheet.cameraWrap' ? wrapLabel : t(key, vars)) as unknown as TFunction;
    const sections = callSheetSections(day('2026-11-19', { blocks: [shot(0)] }), () => 'A', long);
    const [page] = callSheetPages(setup, 'Call sheet', sections, ctx);
    const texts = (page?.ops ?? []).flatMap((op) => (op.kind === 'text' ? [op] : []));
    // One line right after the time: the narrow shot column no longer wraps it.
    const label = texts.find((op) => op.text === wrapLabel);
    expect(label?.x).toBe(texts.find((op) => op.text === 'callSheet.shot')?.x);
    const bands = (page?.ops ?? []).filter(
      (op) => op.kind === 'rect' && op.fill === light['surface-2'],
    );
    expect(bands).toHaveLength(2);
    expect(bands.every((op) => op.kind === 'rect' && op.w > 400)).toBe(true);
  });

  it('never leaves a section title alone at the bottom of a page', () => {
    for (let count = 30; count < 60; count++) {
      const sections = callSheetSections(
        day('2026-11-19', {
          notes: 'Accesso dal lato est.',
          blocks: Array.from({ length: count }, (_, i) => shot(i)),
        }),
        () => 'A',
        t,
      );
      const pages = callSheetPages(setup, 'Call sheet', sections, ctx);
      for (const page of pages) {
        const texts = page.ops.filter((op) => op.kind === 'text');
        const last = texts.at(-1);
        expect(last && 'text' in last && sections.some((s) => s.title === last.text)).toBe(false);
      }
      const notesPage = pages.find((page) =>
        page.ops.some((op) => op.kind === 'text' && op.text === 'callSheet.notes'),
      );
      expect(
        notesPage?.ops.some((op) => op.kind === 'text' && op.text === 'Accesso dal lato est.'),
      ).toBe(true);
    }
  });

  it('keeps titles, departments and the first and last rows of a table with a neighbour', () => {
    const member = (n: number, name: string, department: string): CrewMember => ({
      id: `00000000-0000-4000-8000-0000000000${n}0`,
      projectId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10',
      name,
      role: 'Role',
      department,
      phone: `+39 333 00${n}`,
      email: '',
      pickup: '',
      notes: '',
      userId: null,
      character: null,
      onSetContact: false,
      position: n,
      revision: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
    const crew = [
      member(1, 'Matteo', 'Regia'),
      member(2, 'Ada', 'Camera'),
      member(3, 'Bruno', 'Camera'),
      member(4, 'Carla', 'Suono'),
      member(5, 'Elena', 'Cast'),
      member(6, 'Pietro', 'Cast'),
    ];
    for (const orientation of ['portrait', 'landscape'] as const)
      for (let count = 1; count < 24; count++) {
        const sections = callSheetSections(
          day('2026-11-19', {
            location: 'Faro, Otranto',
            notes: 'Accesso dal sentiero est.',
            blocks: Array.from({ length: count }, (_, i) => ({
              ...shot(i),
              cast: i % 2 ? ['Elena', 'Pietro'] : ['Elena'],
              departments: i ? [] : ['Fotografia: drone', 'Trucco: sole', 'Fonico: vento'],
            })),
            calls: crew
              .slice(0, 4)
              .map((c) => ({ crewMemberId: c.id, call: '06:30', pickup: null })),
          }),
          () => 'A',
          t,
          new Map(),
          crew,
        );
        const pages = callSheetPages({ ...setup, orientation }, 'Call sheet', sections, ctx);
        const texts = pages.map((page) =>
          page.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : [])).slice(1),
        );
        const all = sections.slice(1).flatMap((s) => s.rows.flat());
        // The page of a row, found by a cell no later row repeats (the times come first).
        const pageOf = (row: string[]) =>
          Math.max(
            ...row
              .filter((value) => all.filter((v) => v === value).length === 1)
              .map((cell) =>
                texts.findLastIndex((page) => page.includes(cell.split('\n')[0] ?? '')),
              ),
          );
        const where = `${orientation}, ${count} blocks`;
        for (const section of sections) {
          const first = section.title === 'callSheet.times' ? 2 : section.header ? 1 : 0;
          const rows = section.rows.slice(first);
          // The schedule names a column after the cast table: its title is the later one.
          const title = texts.findLastIndex((page) => page.includes(section.title));
          if (rows[0]) expect(pageOf(rows[0]), `${where}: ${section.title}`).toBe(title);
          if (rows.length > 1) {
            expect(pageOf(rows[1]!), `${where}: ${section.title} first`).toBe(pageOf(rows[0]!));
            expect(pageOf(rows.at(-2)!), `${where}: ${section.title} last`).toBe(
              pageOf(rows.at(-1)!),
            );
          }
          // A department of the troupe stays with its first person.
          for (const [i, row] of rows.entries())
            if (section.title === 'callSheet.troupe' && row.length === 1)
              expect(pageOf(rows[i + 1]!), `${where}: ${row[0]}`).toBe(
                texts.findIndex((page) => page.includes(row[0]!)),
              );
        }
        // No last page with only a section of one line.
        const tail = texts.at(-1)!;
        expect(
          pages.length === 1 || !sections.some((s) => s.title === tail[0]) || tail.length > 2,
          `${where}: ${tail.join(' | ')}`,
        ).toBe(true);
      }
  });
});
