// @vitest-environment happy-dom
import { addScene, listElements, storyboardOf } from '@inkadra/canvas-core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL } from '../../store.ts';
import fdx from './fixtures/last-train.fdx?raw';
import fountain from './fixtures/last-train.fountain?raw';
import { parseScreenplay } from './parse.ts';
import {
  applyImport,
  castName,
  defaultOptions,
  MAX_IMPORT_FRAMES,
  planImport,
  sceneNumbers,
} from './plan.ts';
import { parseHeading } from './script.ts';

const line = (names: string[]) => `Characters: ${names.join(', ')}`;
const script = parseScreenplay('last-train.fountain', fountain);

describe('planImport', () => {
  it('makes one frame per action paragraph, with the dialogue that follows it', () => {
    const plan = planImport(script, defaultOptions(script), line);
    expect(plan.title).toBe('LAST TRAIN');
    expect(plan.scenes).toHaveLength(5);
    const station = plan.scenes[1];
    expect(station).toMatchObject({
      number: '1',
      setting: 'ext',
      location: 'CENTRAL STATION',
      time: 'night',
      title: 'Central Station',
      synopsis: 'Mara misses the last train and meets Leo.',
    });
    expect(station?.frames).toHaveLength(3);
    expect(station?.frames[1]).toEqual({
      action: 'The departures board flips: LAST TRAIN - DEPARTED.',
      dialogue: 'MARA: (out of breath) No. No, no, no.\nLEO (O.S.): It left four minutes early.',
      cast: ['Mara', 'Leo'],
      notes: 'Leo should already be in frame, half hidden by the pillar.',
    });
    // A forced heading names the scene; continuity words are never a title.
    expect(plan.scenes[0]).toMatchObject({ number: 'A1', title: 'COLD OPEN' });
    expect(plan.scenes[2]).toMatchObject({ title: 'Guard Booth', location: 'GUARD BOOTH' });
    expect(plan.scenes[3]).toMatchObject({ number: '2A', title: 'Guard Booth' });
    expect(plan.scenes[4]).toMatchObject({ number: '3A', title: 'Platform 4' });
    expect(plan.frameCount).toBe(plan.scenes.reduce((n, s) => n + s.frames.length, 0));
  });

  it('caps the frames of a scene and keeps the rest of the action on the last one', () => {
    const plan = planImport(script, { ...defaultOptions(script), maxFrames: 4 }, line);
    const long = parseScreenplay(
      'x.fountain',
      `INT. HALL - DAY\n\n${Array.from({ length: 6 }, (_, i) => `Beat ${i + 1}.`).join('\n\n')}`,
    );
    const capped = planImport(long, { ...defaultOptions(long), maxFrames: 4 }, line);
    expect(capped.scenes[0]?.frames.map((f) => f.action)).toEqual([
      'Beat 1.',
      'Beat 2.',
      'Beat 3.',
      'Beat 4.\n\nBeat 5.\n\nBeat 6.',
    ]);
    expect(plan.truncated).toBe(false);
  });

  it('makes one frame per scene, or none with the characters in the synopsis', () => {
    const one = planImport(script, { ...defaultOptions(script), frames: 'one' }, line);
    expect(one.scenes.map((s) => s.frames.length)).toEqual([1, 1, 1, 1, 1]);
    expect(one.scenes[1]?.frames[0]?.cast).toEqual(['Mara', 'Leo']);
    const none = planImport(script, { ...defaultOptions(script), frames: 'none' }, line);
    expect(none.frameCount).toBe(0);
    expect(none.scenes[1]?.synopsis).toBe(
      'Mara misses the last train and meets Leo.\nCharacters: Mara, Leo',
    );
    const noCast = planImport(script, { ...defaultOptions(script), cast: false }, line);
    expect(noCast.scenes[1]?.frames.some((f) => f.cast)).toBe(false);
    expect(noCast.scenes[1]?.synopsis).toContain('Characters: Mara, Leo');
  });

  it('imports only the chosen scenes and stays within the bounds', () => {
    const plan = planImport(script, { ...defaultOptions(script), scenes: new Set([1, 4]) }, line);
    expect(plan.scenes.map((s) => s.number)).toEqual(['1', '3A']);
    const huge = parseScreenplay(
      'x.fountain',
      Array.from({ length: 400 }, (_, i) => `INT. ROOM ${i} - DAY\n\nA.\n\nB.\n\nC.\n\nD.`).join(
        '\n\n',
      ),
    );
    const bounded = planImport(huge, defaultOptions(huge), line);
    expect(bounded.frameCount).toBe(MAX_IMPORT_FRAMES);
    expect(bounded.truncated).toBe(true);
  });

  it('numbers inserted scenes like a shooting script, without duplicates', () => {
    const scenes = ['', '1', '', '2', '2A', '', ''].map((number) => ({
      ...parseHeading('INT. ROOM - DAY'),
      ...(number ? { number } : {}),
      blocks: [],
      characters: [],
    }));
    expect(sceneNumbers(scenes)).toEqual(['A1', '1', '1A', '2', '2A', '2B', '2C']);
  });

  it('names a scene after its location and keeps only meaningful extras', () => {
    const s = parseScreenplay(
      'x.fountain',
      'INT. HALL - NIGHT (FLASHBACK)\n\nOne.\n\nEXT. YARD - MOMENTS LATER\n\nTwo.',
    );
    expect(planImport(s, defaultOptions(s), line).scenes.map((x) => x.title)).toEqual([
      'Hall (Flashback)',
      'Yard',
    ]);
  });

  it('writes names in title case', () => {
    expect(castName("DR. O'NEIL")).toBe("Dr. O'Neil");
    expect(castName('Mara')).toBe('Mara');
  });
});

describe('applyImport', () => {
  it('appends scenes and frames after the existing ones, undone in one step', () => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc);
    addScene(doc, { number: '7', title: 'Before' }, { userId: 'u', origin: LOCAL });
    store.undo.stopCapturing();
    const fdxScript = parseScreenplay('last-train.fdx', fdx);
    const plan = planImport(
      fdxScript,
      { ...defaultOptions(fdxScript), scenes: new Set([0, 1]) },
      line,
    );
    applyImport(doc, plan, { userId: 'u', origin: LOCAL });
    const groups = storyboardOf(listElements(doc));
    expect(groups.map((g) => g.scene?.number)).toEqual(['7', '1', '2']);
    expect(groups[1]?.frames.map((f) => f.action)).toEqual([
      'Rain hammers the glass roof. MARA runs across the empty concourse.',
      'CLOSE ON THE DEPARTURES BOARD',
    ]);
    expect(groups[1]?.scene?.x).toBeGreaterThan(groups[0]?.scene?.x ?? 0);
    store.undo.undo();
    expect(storyboardOf(listElements(doc)).map((g) => g.scene?.title)).toEqual(['Before']);
  });

  it('numbers scenes without a number after the last one', () => {
    const doc = new Y.Doc();
    addScene(doc, { number: '4', title: '' }, { userId: null });
    const s = parseScreenplay('x.fountain', 'INT. A - DAY\n\nOne.\n\nEXT. B - NIGHT\n\nTwo.');
    applyImport(doc, planImport(s, defaultOptions(s), line), { userId: null });
    expect(storyboardOf(listElements(doc)).map((g) => g.scene?.number)).toEqual(['4', '5', '6']);
  });
});
