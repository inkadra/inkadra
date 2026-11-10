// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import type { ShootingDay } from '@inkadra/shared';
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
      ['07:00 – 07:30', '', 'schedule.types.setup', ''],
      ['07:30 – 08:30', '1A', 'Arrivo', 'Marta'],
      ['08:30', 'callSheet.cameraWrap', '', ''],
      ['19:00', 'callSheet.crewWrap', '', ''],
    ]);
    expect(cast?.rows.at(-1)).toEqual(['Marta', '', '', '07:30']);
    expect(departments?.rows).toEqual([['Camera', 'dolly']]);
    expect(notes?.rows).toEqual([['Pranzo al sacco']]);
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
