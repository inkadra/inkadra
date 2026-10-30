import type { Element } from '@inkadra/doc-schema';
import { light } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';
import { type CardContext, cardHeight, drawCard } from './board-render.ts';
import {
  finish,
  type Shot,
  shotColumns,
  shotListPages,
  storyboardPages,
  titlePage,
  type Words,
} from './compose.ts';
import type { Op, Page } from './pages.ts';

const ctx: CardContext = {
  measure: (text, size) => [...text].length * size * 0.5,
  colors: light,
  noteBlocks: () => [],
  image: () => null,
  fileName: () => 'file.pdf',
  boardTitle: () => 'Board',
  frameLabel: () => '1A',
  frameAspect: () => 16 / 9,
  frameMeta: () => '',
  slugline: () => 'EXT. STAZIONE – NOTTE',
  storyMeta: (el) => (el.type === 'character' ? (el.actor ?? '') : 'INT.'),
  words: { board: 'Board', file: 'File' },
};

const words: Words = {
  pageOf: (n, total) => `${n} of ${total}`,
  madeWith: 'Made with Inkadra',
  scene: 'Sc.',
  noFrames: 'No frames',
  comments: 'Comments',
  onBoard: 'On the board',
  onCard: (label) => `On ${label}`,
  removedCard: 'On a removed card',
  dialogue: 'Dialogue',
  notes: 'Notes',
  columns: {
    shot: 'Shot',
    picture: 'Picture',
    size: 'Size',
    angle: 'Angle',
    movement: 'Movement',
    lens: 'Lens',
    duration: 'Dur.',
    action: 'Action',
    location: 'Location',
    cast: 'Cast',
    status: 'Status',
  },
};

const scene = {
  id: 'scene001',
  type: 'scene',
  number: '1',
  title: 'Binario 21',
  x: 0,
  y: 0,
  w: 300,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: 0,
} as Extract<Element, { type: 'scene' }>;

function shots(n: number, notes?: string): Shot[] {
  return Array.from({ length: n }, (_, i) => ({
    frame: {
      id: `frame${String(i).padStart(4, '0')}`,
      type: 'frame',
      x: 0,
      y: 0,
      w: 240,
      z: 'a0',
      parent: 'scene001',
      createdBy: null,
      createdAt: 0,
      action: `Azione ${i}`,
      ...(notes ? { notes } : {}),
    } as Extract<Element, { type: 'frame' }>,
    label: `1${String.fromCharCode(65 + (i % 26))}`,
    scene,
    size: 'Primo piano',
    angle: '',
    movement: '',
    duration: '2 s',
  }));
}

function texts(ops: readonly Op[]): string[] {
  return ops.flatMap((op) =>
    op.kind === 'text' ? [op.text] : op.kind === 'clip' ? texts(op.ops) : [],
  );
}
const allText = (pages: readonly Page[]) => pages.flatMap((p) => texts(p.ops)).join('\n');

const a4 = { paper: 'a4', orientation: 'landscape' } as const;

describe('storyboard pages', () => {
  it('puts the chosen number of frames on each page', () => {
    expect(storyboardPages(a4, shots(9), 4, ctx, words, true)).toHaveLength(3);
    expect(storyboardPages(a4, shots(9), 6, ctx, words, true)).toHaveLength(2);
    expect(storyboardPages(a4, shots(9), 1, ctx, words, true)).toHaveLength(9);
    expect(storyboardPages(a4, [], 4, ctx, words, true)).toHaveLength(1);
  });

  it('fills each column with its picture and lines the text up with it', () => {
    for (const perPage of [2, 4, 6] as const) {
      const [page] = storyboardPages(a4, shots(perPage), perPage, ctx, words, true);
      // framePicture draws a border rect the size of the picture after its clip.
      const borders = (page?.ops ?? []).filter(
        (op): op is Extract<Op, { kind: 'rect' }> => op.kind === 'rect' && !!op.stroke,
      );
      expect(borders).toHaveLength(perPage);
      const widths = new Set(borders.map((b) => b.w.toFixed(2)));
      expect(widths.size).toBe(1);
      const xs = [...new Set(borders.map((b) => b.x.toFixed(2)))].map(Number).sort((a, b) => a - b);
      const w = borders[0]?.w ?? 0;
      // Consistent gutters between columns, grid centred on the page.
      for (let i = 1; i < xs.length; i++)
        expect((xs[i] ?? 0) - (xs[i - 1] ?? 0) - w).toBeCloseTo(18, 1);
      const right = (xs.at(-1) ?? 0) + w;
      expect((xs[0] ?? 0) - 0).toBeCloseTo((page?.width ?? 0) - right, 1);
      const labels = texts(page?.ops ?? []).filter((t) => /^1[A-F]$/.test(t));
      expect(labels).toHaveLength(perPage);
    }
  });

  it("prints the director's notes only for the team", () => {
    expect(allText(storyboardPages(a4, shots(1, 'Luce fredda'), 2, ctx, words, true))).toContain(
      'Luce fredda',
    );
    expect(
      allText(storyboardPages(a4, shots(1, 'Luce fredda'), 2, ctx, words, false)),
    ).not.toContain('Luce fredda');
  });

  it('keeps every drawing inside the page', () => {
    for (const page of storyboardPages(
      { paper: 'letter', orientation: 'portrait' },
      shots(6),
      6,
      ctx,
      words,
      true,
    )) {
      for (const op of page.ops) {
        if (op.kind === 'text') {
          expect(op.x).toBeGreaterThanOrEqual(0);
          expect(op.y).toBeLessThanOrEqual(page.height);
        }
      }
    }
  });
});

describe('shot list pages', () => {
  it('repeats the table head and spreads long lists over pages', () => {
    const pages = shotListPages(a4, shots(60), ctx, words, true);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(texts(page.ops)).toContain('Shot');
    const labels = allText(pages);
    expect(labels).toContain('Azione 0');
    expect(labels).toContain('Azione 59');
  });

  it('drops the status column for clients', () => {
    expect(shotColumns(700, true).map((c) => c.key)).toContain('status');
    expect(shotColumns(700, false).map((c) => c.key)).not.toContain('status');
    const cols = shotColumns(700, false);
    const last = cols.at(-1);
    expect((last?.x ?? 0) + (last?.w ?? 0)).toBeCloseTo(700);
  });
});

describe('finish', () => {
  it('counts the title page in the numbers but prints none on it', () => {
    const info = {
      projectName: 'Ultima corsa',
      boardTitle: 'Binario 21',
      date: '30 ottobre 2026',
      kind: 'storyboard',
      kindLabel: 'Storyboard',
      summary: '',
    } as const;
    const pages = finish(
      [titlePage(a4, info, ctx, words), ...storyboardPages(a4, shots(5), 4, ctx, words, true)],
      info,
      ctx,
      words,
      true,
    );
    expect(pages).toHaveLength(3);
    expect(texts(pages[0]?.ops ?? []).some((t) => t.endsWith('of 3'))).toBe(false);
    expect(texts(pages[1]?.ops ?? [])).toContain('2 of 3');
    expect(texts(pages[2]?.ops ?? [])).toContain('3 of 3');
    expect(texts(pages[0]?.ops ?? [])).toContain('Binario 21');
  });
});

describe('story bible cards in exports', () => {
  const common = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdBy: null, createdAt: 0 };
  const flat = (ops: readonly Op[]): Op[] =>
    ops.flatMap((op) => (op.kind === 'clip' ? [op, ...flat(op.ops)] : [op]));
  const words = (ops: readonly Op[]) =>
    flat(ops).flatMap((op) => (op.kind === 'text' ? [op.text] : []));

  it('draws the face of a character, never its contact or notes', () => {
    const marta = {
      ...common,
      id: 'marta0001',
      type: 'character',
      name: 'Marta',
      role: 'Capotreno',
      actor: 'Giulia Neri',
      contact: 'agenzia@example.com',
      notes: 'Provino il 12',
    } as Element;
    const h = cardHeight(marta, 240, ctx) ?? 0;
    expect(h).toBeGreaterThanOrEqual(76);
    const shown = words(drawCard({ el: marta, x: 0, y: 0, w: 240, h }, ctx)).join(' ');
    expect(shown).toContain('Marta');
    expect(shown).toContain('Capotreno');
    expect(shown).toContain('Giulia Neri');
    expect(shown).not.toContain('agenzia');
    expect(shown).not.toContain('Provino');
  });

  it('draws a location with its setting and light, without the address', () => {
    const cabin = {
      ...common,
      id: 'cabin0001',
      type: 'location',
      name: 'Cabina del guardiano',
      setting: 'int',
      light: 'Neon verde',
      address: 'Via dei Binari 4',
    } as Element;
    const h = cardHeight(cabin, 240, ctx) ?? 0;
    const shown = words(drawCard({ el: cabin, x: 0, y: 0, w: 240, h }, ctx)).join(' ');
    expect(shown).toContain('Cabina del guardiano');
    expect(shown).toContain('INT.');
    expect(shown).toContain('Neon verde');
    expect(shown).not.toContain('Binari');
  });
});
