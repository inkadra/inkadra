// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import type { SceneElement } from '../film.ts';
import { parseFdx } from './fdx.ts';
import { parseFountain } from './fountain.ts';
import { type PdfPage, pdfPagesToFountain } from './pdf-text.ts';
import {
  defaultOptions,
  MAX_IMPORT_CHARACTERS,
  placeName,
  planImport,
  sceneNumbers,
} from './plan.ts';
import { matchRevision } from './revision.ts';
import {
  clean,
  MAX_SCRIPT_BYTES,
  MAX_SCRIPT_SCENES,
  parseHeading,
  ScriptError,
  type ScriptScene,
  splitCue,
} from './script.ts';
import { MAX_XML_DEPTH, MAX_XML_ELEMENTS, parseXml, XmlError } from './xml.ts';

/**
 * Crafted files that used to block the thread for seconds or minutes. No test compares a time
 * with a fixed bound, which depends on the machine: each counts the work, stops at a limit, or
 * checks how the time grows when the input grows fourfold. Linear work takes about 4 times as
 * long, quadratic work 16 times; below 8 passes on a slow or busy machine and fails on quadratic
 * code. Both sizes are warmed up, then timed in turns, and the medians compared: a pause of
 * the collector or a busy runner slows one run, not the median of either size.
 */
const SCALE = 4;
const MAX_RATIO = 8;
/** Only a guard against a hang, not a measure of speed. */
const HANG = 10_000;

const RUNS = 5;
const timed = (run: () => unknown) => {
  const start = performance.now();
  run();
  return performance.now() - start;
};
const median = (times: number[]) => times.sort((a, b) => a - b)[times.length >> 1] as number;

/** Time with input `n * SCALE` over time with input `n`: the input is built before timing. */
const growth = <T>(build: (n: number) => T, run: (input: T) => unknown, n: number) => {
  const small = build(n);
  const large = build(n * SCALE);
  run(small);
  // The warm-up of the large input is also the guard against a hang.
  expect(timed(() => run(large))).toBeLessThan(HANG);
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    a.push(timed(() => run(small)));
    b.push(timed(() => run(large)));
  }
  return median(b) / Math.max(median(a), 1);
};
const linear = <T>(build: (n: number) => T, run: (input: T) => unknown, n: number) =>
  expect(growth(build, run, n)).toBeLessThan(MAX_RATIO);

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ScriptError) return error.code;
    throw error;
  }
  return null;
};
const page = (lines: string[]): PdfPage => ({
  width: 612,
  items: lines.map((str, i) => ({ str, x: 108, y: 720 - i * 14, height: 12 })),
});

/**
 * A growth test runs the large input up to six times (a warm-up and five timed runs), each
 * stopped by `HANG` only after it ends: the timeout covers them all on a slow runner, where
 * vitest's 5 s default did not.
 */
const TIMEOUT = 6 * HANG;

describe('parser worst cases', { timeout: TIMEOUT }, () => {
  it('reads many namespace prefixes in a deep document without copying them per element', () => {
    const nested = '<a>'.repeat(50) + '</a>'.repeat(50);
    // n prefixes and about n elements: copying the prefixes per element is n².
    const xml = (n: number) => {
      const prefixes = Array.from({ length: n }, (_, i) => `xmlns:p${i}="u"`).join(' ');
      return `<r ${prefixes}>${nested.repeat(Math.ceil(n / 50))}</r>`;
    };
    linear(xml, parseXml, 3000);
    expect(parseXml(xml(500)).children).toHaveLength(10);
  });

  it('keeps a prefix in scope only inside the element that declares it', () => {
    expect(parseXml('<r><a xmlns:q="u"><q:b/></a></r>').children).toHaveLength(1);
    expect(() => parseXml('<r><a xmlns:q="u"/><q:b/></r>')).toThrow(XmlError);
  });

  it('refuses a document nested or sized beyond any Final Draft file', () => {
    const deep = '<a>'.repeat(MAX_XML_DEPTH + 1) + '</a>'.repeat(MAX_XML_DEPTH + 1);
    expect(() => parseXml(deep)).toThrow('too deep');
    const many = `<r>${'<a/>'.repeat(MAX_XML_ELEMENTS)}</r>`;
    expect(() => parseXml(many)).toThrow('too many elements');
    expect(code(() => parseFdx(`<FinalDraft>${deep}</FinalDraft>`))).toBe('invalid');
  });

  it('moves synopses before a heading in one step', () => {
    const text = (n: number) => `${'= A synopsis.\n\n'.repeat(n)}INT. HALL - DAY\n`;
    linear(text, parseFountain, 20_000);
    expect(parseFountain(text(1000)).scenes[0]?.blocks).toHaveLength(1000);
  });

  it('moves each synopsis once, to the scene after it', () => {
    const script = parseFountain(
      'INT. A - DAY\n\n= one\n\n= two\n\nINT. B - DAY\n\nINT. C - DAY\n',
    );
    expect(script.scenes.map((s) => s.blocks.length)).toEqual([1, 1, 0]);
    expect(script.scenes[1]?.blocks[0]).toEqual({ kind: 'synopsis', text: 'two' });
  });

  it('leaves a title page with a line longer than any title page has', () => {
    const body = page(['INT. HALL - DAY', 'Mara waits.']);
    const long = pdfPagesToFountain([page(['THE TITLE', 'by', 'Nora', 'draft '.repeat(60)]), body]);
    expect(long).not.toContain('Title:');
  });

  it('reads title page draft lines without a colon in linear time', () => {
    const body = page(['INT. HALL - DAY', 'Mara waits.']);
    // A title page has at most 20 lines of at most 300 characters: these reach the reader of
    // draft lines, which backtracked quadratically on each one.
    linear(
      (n) => [
        page(['THE TITLE', 'Written by', 'Nora', ...Array(17).fill('draft '.repeat(n))]),
        body,
      ],
      (pages) => {
        for (let i = 0; i < 300; i++) pdfPagesToFountain(pages);
      },
      12,
    );
    const title = pdfPagesToFountain([
      page(['THE TITLE', 'by', 'Nora', 'First draft: 3 May']),
      body,
    ]);
    expect(title).toContain('Revision: First draft\nDraft date: 3 May');
  });

  it('checks the size of a PDF text layer before reading it', () => {
    const huge = page(Array.from({ length: 100 }, () => 'x'.repeat(MAX_SCRIPT_BYTES / 99)));
    expect(code(() => pdfPagesToFountain([huge]))).toBe('tooLarge');
  });

  it('joins a paragraph that runs over every page in linear time', () => {
    const line = 'and the train goes on through the night and nobody stops it';
    const pages = (n: number) => Array.from({ length: n }, () => page(Array(40).fill(line)));
    linear(pages, pdfPagesToFountain, 200);
    expect(pdfPagesToFountain(pages(10)).split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('stops at the scene limit', () => {
    const text = 'INT. A - DAY\n\n'.repeat(MAX_SCRIPT_SCENES + 1);
    expect(code(() => parseFountain(text))).toBe('tooManyScenes');
    expect(parseFountain('INT. A - DAY\n\n'.repeat(MAX_SCRIPT_SCENES)).scenes).toHaveLength(
      MAX_SCRIPT_SCENES,
    );
    const paragraph = '<Paragraph Type="Scene Heading"><Text>INT. A - DAY</Text></Paragraph>';
    const fdx = `<FinalDraft><Content>${paragraph.repeat(MAX_SCRIPT_SCENES + 1)}</Content></FinalDraft>`;
    expect(code(() => parseFdx(fdx))).toBe('tooManyScenes');
  });

  it('splits a heading full of brackets in linear time', () => {
    // Headings are cut at 500 characters: the length is what grows, up to 480.
    linear(
      (n) => `INT. ${'('.repeat(n)} - NIGHT`,
      (heading) => {
        for (let i = 0; i < 5000; i++) parseHeading(heading);
      },
      120,
    );
    expect(parseHeading('INT. HALL - NIGHT (A) (FLASHBACK)')).toEqual({
      heading: 'INT. HALL - NIGHT (A) (FLASHBACK)',
      setting: 'int',
      location: 'HALL – NIGHT (A) (FLASHBACK)',
    });
    expect(parseHeading('INT. HALL - NIGHT ((FLASHBACK)')).toMatchObject({
      time: 'night',
      extra: '(FLASHBACK',
    });
  });

  it('reads a centered line with a long run of spaces in linear time', () => {
    const text = (n: number) => `INT. A - DAY\n\n>a${' '.repeat(n)}b<\n`;
    linear(
      text,
      (t) => {
        for (let i = 0; i < 80; i++) parseFountain(t);
      },
      20_000,
    );
    expect(parseFountain(text(100)).scenes[0]?.blocks[0]).toEqual({ kind: 'action', text: 'a b' });
    expect(parseFountain('INT. A - DAY\n\n> THE END <\n').scenes[0]?.blocks[0]).toEqual({
      kind: 'action',
      text: 'THE END',
    });
  });

  it('collects a frame cast of thousands of speakers in linear time', () => {
    const script = (n: number) =>
      parseFountain(
        `INT. A - DAY\n\n${Array.from({ length: n }, (_, i) => `@C${i}\na\n\n`).join('')}`,
      );
    const plan = (s: ReturnType<typeof script>) =>
      planImport(s, defaultOptions(s), (names) => names.join());
    linear(script, plan, 50_000);
    expect(plan(script(100)).scenes[0]?.frames[0]?.cast).toHaveLength(30);
    expect(plan(script(100)).scenes[0]?.frames[0]?.cast?.[29]).toBe('C29');
  });

  it('numbers thousands of unnumbered scenes in linear time', () => {
    const scene = (number?: string) => ({ heading: '', blocks: [], characters: [], number });
    const scenes = (n: number): ScriptScene[] => [
      scene('1'),
      ...Array.from({ length: n - 1 }, () => scene()),
    ];
    linear(scenes, sceneNumbers, 10_000);
    const numbers = sceneNumbers(scenes(5000));
    expect(numbers.slice(0, 4)).toEqual(['1', '1A', '1B', '1C']);
    expect(new Set(numbers).size).toBe(5000);
    expect(sceneNumbers([scene(), scene('2'), scene(), scene('2A'), scene()])).toEqual([
      'A2',
      '2',
      '2B',
      '2A',
      '2C',
    ]);
  });

  it('counts indents and blank lines in the size of a PDF text', () => {
    const items = Array.from({ length: 200_000 }, (_, i) => ({
      str: 'a',
      x: 500,
      y: -i * 40,
      height: 12,
    }));
    items.push({ str: 'a', x: 0, y: 0, height: 12 });
    expect(code(() => pdfPagesToFountain([{ width: 612, items }]))).toBe('tooLarge');
    const left = {
      width: 612,
      items: [-100, -50].map((x, i) => ({ str: 'a', x, y: -i * 40, height: 12 })),
    };
    expect(() => pdfPagesToFountain([left])).not.toThrow();
  });

  it('reads the text of nested Final Draft paragraphs once', () => {
    const nest = (n: number, leaf: string): string =>
      n ? `<Paragraph><Text>${nest(n - 1, leaf)}</Text></Paragraph>` : leaf;
    const summary = `<SceneProperties><Summary>${nest(45, 'x'.repeat(1_000_000))}</Summary></SceneProperties>`;
    const fdx = `<FinalDraft><Content><Paragraph Type="Scene Heading"><Text>INT. A - DAY</Text>${summary}</Paragraph></Content></FinalDraft>`;
    // Read once per level, the text was copied 45 times.
    expect(parseFdx(fdx).scenes[0]?.blocks).toEqual([
      { kind: 'synopsis', text: 'x'.repeat(1_000_000) },
    ]);
  });

  it('splits thousands of cues full of brackets in linear time', () => {
    // Cues are cut at 200 characters: the length is what grows, up to 180.
    linear(
      (n) => `@${'('.repeat(n)}`,
      (cue) => {
        for (let i = 0; i < 20_000; i++) splitCue(cue);
      },
      45,
    );
    expect(splitCue("MARA (V.O.) (CONT'D)")).toEqual({
      character: 'MARA',
      extension: "(V.O.) (CONT'D)",
    });
    expect(splitCue('MARA ((V.O.)')).toEqual({ character: 'MARA', extension: '((V.O.)' });
    expect(splitCue('MARA (A) x (B)')).toEqual({ character: 'MARA (A) x', extension: '(B)' });
    expect(splitCue('(V.O.)')).toEqual({ character: '', extension: '(V.O.)' });
  });

  it('matches a long draft to a long storyboard reading each scene once', () => {
    const text = (i: number) =>
      Array.from({ length: 40 }, (_, w) => `word${(i * 7 + w) % 997}`).join(' ');
    const draft = Array.from({ length: 500 }, (_, i) => ({
      title: `Place ${i}`,
      synopsis: text(i),
    }));
    const scenes = Array.from(
      { length: 500 },
      (_, i) =>
        ({ id: `s${i}`, title: `Other ${i}`, synopsis: text(i + 1) }) as unknown as SceneElement,
    );
    // The work is counted: each scene's text is split into words once, not once per pair.
    const split = vi.spyOn(String.prototype, 'split');
    try {
      const rows = matchRevision(draft, scenes);
      expect(split.mock.calls.length).toBeLessThanOrEqual(draft.length + scenes.length);
      expect(rows.length).toBeGreaterThanOrEqual(500);
    } finally {
      split.mockRestore();
    }
  });

  it('compares scenes that share one heading folding each scene a few times, not each pair', () => {
    const at = { location: 'THE HALL!', setting: 'int', time: 'day' } as const;
    const words = (i: number) => Array.from({ length: 40 }, (_, w) => `w${i}x${w}`).join(' ');
    const draft = Array.from({ length: 300 }, (_, i) => ({ ...at, synopsis: words(i) }));
    const scenes = Array.from(
      { length: 300 },
      (_, i) => ({ ...at, id: `s${i}`, synopsis: words(i + 1000) }) as unknown as SceneElement,
    );
    const replace = vi.spyOn(String.prototype, 'replace');
    try {
      const rows = matchRevision(draft, scenes);
      // Each scene of either side is folded a handful of times; pair by pair it was 270 000.
      expect(replace.mock.calls.length).toBeLessThan(20 * (draft.length + scenes.length));
      expect(rows.filter((r) => r.status === 'changed' || r.status === 'same')).toHaveLength(300);
    } finally {
      replace.mockRestore();
    }
  });

  it('reads each note once, whatever note marks the file holds', () => {
    const marks = '\uE0000\uE000'.repeat(300);
    const script = parseFountain(`INT. A - DAY\n\n[[a note]]\n\n${marks}\n\nMara waits.\n`);
    const blocks = script.scenes.flatMap((s) => s.blocks);
    expect(blocks.filter((b) => b.kind === 'note')).toEqual([{ kind: 'note', text: 'a note' }]);
    expect(JSON.stringify(script)).not.toContain('\uE000');
    // A frame keeps only what it shows: a scene of many notes is not joined whole.
    const notes = Array.from({ length: 2000 }, (_, i) => `[[note ${i} ${'x'.repeat(100)}]]`);
    const many = parseFountain(`INT. A - DAY\n\nMara waits.\n\n${notes.join('\n\n')}\n`);
    const join = vi.spyOn(Array.prototype, 'join');
    try {
      const frame = planImport(many, defaultOptions(many), (n) => n.join()).scenes[0]?.frames[0];
      expect(frame?.notes?.length).toBe(4000);
      const joined = join.mock.results.map((r) => String(r.value).length);
      expect(Math.max(...joined)).toBeLessThan(5000);
    } finally {
      join.mockRestore();
    }
  });

  it('numbers scenes after a number without a digit at its end with one letter each', () => {
    const scene = (number?: string) => ({ heading: '', blocks: [], characters: [], number });
    expect(sceneNumbers([scene('X'), scene(), scene(), scene()])).toEqual(['X', 'XA', 'XB', 'XC']);
    expect(sceneNumbers([scene('1.'), scene(), scene()])).toEqual(['1.', '1.A', '1.B']);
  });

  it('numbers scenes after a number without a digit at its end in linear time', () => {
    const scene = (number?: string) => ({ heading: '', blocks: [], characters: [], number });
    const scenes = (n: number): ScriptScene[] => [
      scene('PROLOGUE'),
      ...Array.from({ length: n - 1 }, () => scene()),
    ];
    linear(scenes, sceneNumbers, 10_000);
    expect(Math.max(...sceneNumbers(scenes(5000)).map((n) => n?.length ?? 0))).toBeLessThan(12);
  });

  it('creates at most MAX_IMPORT_CHARACTERS character cards and says the rest were left out', () => {
    const cues = Array.from({ length: 1000 }, (_, i) => `@C${i}\na\n\n`).join('');
    const script = parseFountain(`INT. A - DAY\n\n${cues}`);
    const options = { ...defaultOptions(script), characterCards: true };
    const plan = planImport(script, options, (names) => names.join());
    expect(plan.characters).toHaveLength(MAX_IMPORT_CHARACTERS);
    expect(plan.charactersTruncated).toBe(true);
    const few = parseFountain(`INT. A - DAY\n\n@MARA\nHi.\n`);
    const fewPlan = planImport(few, { ...defaultOptions(few), characterCards: true }, String);
    expect(fewPlan.charactersTruncated).toBeUndefined();
  });

  it('folds any whitespace within a line, keeping line breaks', () => {
    expect(clean('A\u3000\u3000B\v\fC\u202FD')).toBe('A B C D');
    expect(clean('A\n\nB')).toBe('A\n\nB');
    expect(parseHeading('INT.\v\vHALL\n-\nNIGHT')).toMatchObject({
      location: 'HALL',
      time: 'night',
    });
  });

  it('splits headings and cues with long runs of any whitespace in linear time', () => {
    linear(
      (n) => `INT. A${'\v\n'.repeat(n)}X`,
      (heading) => {
        for (let i = 0; i < 2000; i++) parseHeading(heading);
      },
      60,
    );
    linear(
      (n) => `MARA${'\v\n'.repeat(n)}X`,
      (cue) => {
        for (let i = 0; i < 5000; i++) splitCue(cue);
      },
      24,
    );
  });

  it('cuts section names and title page fields to what a label shows', () => {
    const fountain = parseFountain(
      `Title: ${'T'.repeat(10_000)}\n\n# ${'A'.repeat(100_000)}\n\nINT. A - DAY\n\nINT. B - DAY\n`,
    );
    expect(fountain.scenes.map((s) => s.section?.length)).toEqual([200, 200]);
    expect(fountain.title?.length).toBe(500);
    expect(fountain.titlePage.title?.length).toBe(2000);
    const act = `<Paragraph Type="New Act"><Text>${'A'.repeat(100_000)}</Text></Paragraph>`;
    const heading = '<Paragraph Type="Scene Heading"><Text>INT. A - DAY</Text></Paragraph>';
    const fdx = parseFdx(`<FinalDraft><Content>${act}${heading}${heading}</Content></FinalDraft>`);
    expect(fdx.scenes.map((s) => s.section?.length)).toEqual([200, 200]);
  });

  it('keeps particles lower case in a place name in linear time', () => {
    linear(
      (n) => `${' '.repeat(n)}A DE B`,
      (name) => {
        for (let i = 0; i < 400; i++) placeName(name);
      },
      5000,
    );
    expect(placeName('CASA DI MARA')).toBe('Casa di Mara');
  });
});
