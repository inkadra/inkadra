// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { parseFdx } from './fdx.ts';
import { parseFountain } from './fountain.ts';
import { type PdfPage, pdfPagesToFountain } from './pdf-text.ts';
import { MAX_SCRIPT_BYTES, MAX_SCRIPT_SCENES, parseHeading, ScriptError } from './script.ts';
import { MAX_XML_DEPTH, MAX_XML_ELEMENTS, parseXml, XmlError } from './xml.ts';

/**
 * Crafted files that used to block the thread for seconds or minutes: each must finish fast or
 * stop with a limit. The bound is generous, so a slow machine passes; quadratic code does not.
 */
const fast = <T>(run: () => T): T => {
  const start = performance.now();
  const result = run();
  expect(performance.now() - start).toBeLessThan(500);
  return result;
};
const code = (run: () => unknown) => {
  try {
    fast(run);
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

describe('parser worst cases', () => {
  it('reads many namespace prefixes in a deep document without copying them per element', () => {
    const prefixes = Array.from({ length: 8000 }, (_, i) => `xmlns:p${i}="u"`).join(' ');
    const nested = '<a>'.repeat(MAX_XML_DEPTH - 1) + '</a>'.repeat(MAX_XML_DEPTH - 1);
    const root = fast(() => parseXml(`<r ${prefixes}>${nested.repeat(300)}</r>`));
    expect(root.children).toHaveLength(300);
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
    const script = fast(() =>
      parseFountain(`${'= A synopsis.\n\n'.repeat(80_000)}INT. HALL - DAY\n`),
    );
    expect(script.scenes[0]?.blocks).toHaveLength(80_000);
  });

  it('moves each synopsis once, to the scene after it', () => {
    const script = parseFountain(
      'INT. A - DAY\n\n= one\n\n= two\n\nINT. B - DAY\n\nINT. C - DAY\n',
    );
    expect(script.scenes.map((s) => s.blocks.length)).toEqual([1, 1, 0]);
    expect(script.scenes[1]?.blocks[0]).toEqual({ kind: 'synopsis', text: 'two' });
  });

  it('reads a long title page line without a colon in linear time', () => {
    const long = 'draft '.repeat(50_000);
    const body = page(['INT. HALL - DAY', 'Mara waits.']);
    fast(() => pdfPagesToFountain([page(['THE TITLE', 'Written by', 'Nora', long]), body]));
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
    const pages = Array.from({ length: 2000 }, () => page(Array(40).fill(line)));
    const text = fast(() => pdfPagesToFountain(pages));
    expect(text.split('\n').filter(Boolean)).toHaveLength(1);
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
    fast(() => {
      for (let i = 0; i < 2000; i++) parseHeading(`INT. ${'('.repeat(490)} - NIGHT`);
    });
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
});
