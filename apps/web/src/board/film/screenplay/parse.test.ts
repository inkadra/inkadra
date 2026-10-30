// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import fdx from './fixtures/last-train.fdx?raw';
import fountain from './fixtures/last-train.fountain?raw';
import { parseFountain } from './fountain.ts';
import { parseScreenplay } from './parse.ts';
import { parseHeading, ScriptError } from './script.ts';

describe('scene headings', () => {
  it.each([
    [
      'EXT. CENTRAL STATION - NIGHT',
      { setting: 'ext', location: 'CENTRAL STATION', time: 'night' },
    ],
    ['INT./EXT. CAR - DAY', { setting: 'int-ext', location: 'CAR', time: 'day' }],
    ['I/E CAR – MORNING', { setting: 'int-ext', location: 'CAR', time: 'day' }],
    ['EST. CITY SKYLINE — DUSK', { setting: 'ext', location: 'CITY SKYLINE', time: 'dusk' }],
    ['INT. CASA DI MARA - NOTTE', { setting: 'int', location: 'CASA DI MARA', time: 'night' }],
    ['INT./EST. AUTO - ALBA', { setting: 'int-ext', location: 'AUTO', time: 'dawn' }],
    [
      'INT. STATION - PLATFORM 4 - NIGHT (FLASHBACK)',
      { location: 'STATION – PLATFORM 4', time: 'night', extra: 'FLASHBACK' },
    ],
    ['INT. GUARD BOOTH - CONTINUOUS', { location: 'GUARD BOOTH', extra: 'CONTINUOUS' }],
    ['INT. GUARD BOOTH - NIGHT - LATER', { time: 'night', extra: 'LATER' }],
    ['EXT. PLATFORM 4 – DAWN #3A#', { number: '3A', location: 'PLATFORM 4', time: 'dawn' }],
    ['INT. HALL', { setting: 'int', location: 'HALL' }],
  ])('%s', (heading, expected) => {
    expect(parseHeading(heading)).toMatchObject(expected);
  });

  it('keeps a forced heading whole', () => {
    expect(parseHeading('THE DREAM')).toEqual({ heading: 'THE DREAM' });
  });
});

describe('Fountain', () => {
  const script = parseFountain(fountain);

  it('reads the title page', () => {
    expect(script.title).toBe('LAST TRAIN');
    expect(script.titlePage).toMatchObject({
      credit: 'written by',
      author: 'Nora Vidal',
      'draft date': '30 October 2026',
      contact: 'nora@example.com',
    });
  });

  it('finds every scene, with forced and lower-case headings', () => {
    expect(script.scenes.map((s) => s.heading)).toEqual([
      'COLD OPEN',
      'EXT. CENTRAL STATION - NIGHT',
      'INT. GUARD BOOTH - CONTINUOUS',
      'int. guard booth - later',
      'EXT. PLATFORM 4 – DAWN',
    ]);
    expect(script.scenes.map((s) => s.number)).toEqual([undefined, '1', '2', undefined, '3A']);
    expect(script.scenes[1]?.section).toBe('ACT ONE');
  });

  it('reads action, dialogue, parentheticals, notes, synopses and transitions', () => {
    const station = script.scenes[1];
    expect(station?.blocks.map((b) => b.kind)).toEqual([
      'synopsis',
      'action',
      'action',
      'dialogue',
      'dialogue',
      'note',
      'action',
      'dialogue',
      'transition',
    ]);
    expect(station?.blocks[3]).toEqual({
      kind: 'dialogue',
      character: 'MARA',
      lines: [{ text: '(out of breath)', parenthetical: true }, { text: 'No. No, no, no.' }],
    });
    expect(station?.blocks[4]).toMatchObject({ character: 'LEO', extension: '(O.S.)' });
    expect(station?.characters).toEqual(['MARA', 'LEO']);
    expect(script.characters).toEqual(['MARA', 'LEO']);
  });

  it('leaves out the boneyard, reads dual dialogue and forced action', () => {
    const booth = script.scenes[2];
    expect(booth?.blocks.filter((b) => b.kind === 'dialogue')).toHaveLength(2);
    expect(JSON.stringify(script)).not.toContain('quitters');
    const platform = script.scenes[4];
    expect(platform?.blocks[1]).toEqual({ kind: 'action', text: 'MARA LOOKS BACK.' });
    expect(platform?.blocks.at(-1)).toEqual({ kind: 'transition', text: 'FADE OUT.' });
  });

  it('copes with Windows line endings, a BOM and no blank line after a heading', () => {
    const s = parseFountain('﻿INT. KITCHEN - DAY\r\nA kettle boils.\r\n\r\nANNA\r\nTea?\r\n');
    expect(s.scenes).toHaveLength(1);
    expect(s.scenes[0]?.blocks).toEqual([
      { kind: 'action', text: 'A kettle boils.' },
      { kind: 'dialogue', character: 'ANNA', lines: [{ text: 'Tea?' }] },
    ]);
  });

  it('stays linear on unclosed notes, boneyards and long cue lines', () => {
    for (const source of [
      '[['.repeat(100_000),
      '/*'.repeat(100_000),
      `INT. HALL - DAY\n\n${'('.repeat(200_000)}\nText`,
    ]) {
      const start = performance.now();
      parseFountain(source);
      expect(performance.now() - start).toBeLessThan(200);
    }
    // An unclosed note keeps its text.
    expect(parseFountain('INT. HALL - DAY\n\nA [[door.').scenes[0]?.blocks).toEqual([
      { kind: 'action', text: 'A [[door.' },
    ]);
  });

  it('keeps what comes before the first heading as a scene without one', () => {
    const s = parseFountain('A clock ticks.\n\nINT. HALL - DAY\n\nA door.');
    expect(s.scenes.map((x) => [x.heading, x.prelude])).toEqual([
      ['', true],
      ['INT. HALL - DAY', undefined],
    ]);
    expect(parseFountain('FADE IN:\n\nINT. HALL - DAY\n\nA door.').scenes).toHaveLength(1);
  });

  it('gives a synopsis written before a heading to the scene it opens', () => {
    const s = parseFountain(
      'INT. HALL - DAY\n\n= In the hall.\n\nA door.\n\n= Out in the yard.\n\nEXT. YARD - DAY\n\nRain.',
    );
    expect(s.scenes.map((x) => x.blocks.filter((b) => b.kind === 'synopsis'))).toEqual([
      [{ kind: 'synopsis', text: 'In the hall.' }],
      [{ kind: 'synopsis', text: 'Out in the yard.' }],
    ]);
  });

  it('removes underline marks only around words', () => {
    const s = parseFountain(
      'INT. HALL - DAY\n\nShe types _now_ my_file_name and http://a.example/x_y_z.',
    );
    expect(s.scenes[0]?.blocks[0]).toEqual({
      kind: 'action',
      text: 'She types now my_file_name and http://a.example/x_y_z.',
    });
  });

  it('makes one scene of a script without headings', () => {
    expect(parseFountain('A door opens.\n\nANNA\nHello?').scenes).toHaveLength(1);
  });

  it('does not take a shouted action line for a character', () => {
    const s = parseFountain('INT. HALL - DAY\n\nBANG!\nThe door flies open.');
    expect(s.scenes[0]?.blocks.map((b) => b.kind)).toEqual(['action']);
  });
});

describe('Final Draft', () => {
  const script = parseScreenplay('last-train.fdx', fdx);

  it('reads scenes, numbers, summaries and the title page', () => {
    expect(script.format).toBe('fdx');
    expect(script.title).toBe('LAST TRAIN');
    expect(script.titlePage.author).toBe('Nora Vidal');
    expect(script.scenes.map((s) => [s.number, s.location, s.time])).toEqual([
      ['1', 'CENTRAL STATION', 'night'],
      ['2', 'GUARD BOOTH', undefined],
      ['3', 'PLATFORM 4', 'dawn'],
    ]);
    expect(script.scenes[0]?.blocks[0]).toEqual({
      kind: 'synopsis',
      text: 'Mara misses the last train and meets Leo.',
    });
  });

  it('joins text runs and reads dialogue, shots and dual dialogue', () => {
    const [station, booth] = script.scenes;
    expect(station?.blocks[1]).toEqual({
      kind: 'action',
      text: 'Rain hammers the glass roof. MARA runs across the empty concourse.',
    });
    expect(station?.blocks[2]).toEqual({
      kind: 'dialogue',
      character: 'MARA',
      lines: [{ text: '(out of breath)', parenthetical: true }, { text: 'No. No, no, no.' }],
    });
    expect(station?.blocks[4]).toEqual({ kind: 'action', text: 'CLOSE ON THE DEPARTURES BOARD' });
    expect(booth?.characters).toEqual(['MARA', 'LEO']);
  });

  it('refuses entity declarations and broken files', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><FinalDraft>&a;</FinalDraft>`;
    expect(() => parseScreenplay('x.fdx', bomb)).toThrow(ScriptError);
    expect(() => parseScreenplay('x.fdx', '<FinalDraft><Content>')).toThrow(/invalid/);
    expect(() => parseScreenplay('x.fdx', '<other/>')).toThrow(/invalid/);
  });
});

describe('files', () => {
  it('refuses other formats, empty scripts and large files', () => {
    expect(() => parseScreenplay('notes.docx', 'x')).toThrow(/unsupported/);
    expect(() => parseScreenplay('empty.fountain', '\n\n')).toThrow(/empty/);
    expect(() => parseScreenplay('big.txt', 'a'.repeat(5 * 1024 * 1024 + 1))).toThrow(/tooLarge/);
  });

  it('reads a misnamed Final Draft file as XML', () => {
    expect(parseScreenplay('script.txt', fdx).format).toBe('fdx');
  });
});
