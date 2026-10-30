import type { Element } from '@inkadra/doc-schema';
import { light } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';
import type { CardContext } from './board-render.ts';
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
  it('numbers content pages and leaves the title page bare', () => {
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
    expect(texts(pages[0]?.ops ?? [])).not.toContain('1 of 2');
    expect(texts(pages[1]?.ops ?? [])).toContain('1 of 2');
    expect(texts(pages[2]?.ops ?? [])).toContain('2 of 2');
    expect(texts(pages[0]?.ops ?? [])).toContain('Binario 21');
  });
});
