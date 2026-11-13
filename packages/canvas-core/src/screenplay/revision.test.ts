import { roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { listElements } from '../board.ts';
import { addScenes, type NewScene, type SceneElement, storyboardOf } from '../film.ts';
import { applyRevision, matchRevision, revisionCounts, similarity } from './revision.ts';

/** The board's undo as the web keeps it (`BoardStore.undo`): local writes, 400 ms steps. */
const LOCAL = Symbol('local');
const undoOf = (doc: Y.Doc) =>
  new Y.UndoManager(roots(doc).elements, { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 });

const opts = { userId: 'u', origin: LOCAL };
const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ action: `Beat ${i + 1}` }));

/** The storyboard made from draft 2: scenes with frames someone has already drawn. */
const DRAFT_2: NewScene[] = [
  {
    number: '11',
    title: 'Street',
    setting: 'ext',
    location: 'STREET',
    time: 'night',
    synopsis: 'Mara runs home through the rain.',
    frames: frames(2),
  },
  {
    number: '12',
    title: 'Kitchen',
    setting: 'int',
    location: 'KITCHEN',
    time: 'day',
    synopsis: 'Luca cooks while Mara reads the letter.',
    frames: frames(3),
  },
  {
    number: '14',
    title: 'Rooftop',
    setting: 'ext',
    location: 'ROOFTOP',
    time: 'dusk',
    synopsis: 'Mara and Luca look at the city.',
    frames: frames(2),
  },
  {
    number: '15',
    title: 'Parking Lot',
    setting: 'ext',
    location: 'PARKING LOT',
    time: 'night',
    synopsis: 'A car waits with its lights off.',
    frames: frames(2),
  },
  {
    number: '18',
    title: 'Car',
    setting: 'int',
    location: 'CAR',
    time: 'night',
    synopsis: 'Mara drives towards the motorway, the letter on the seat.',
    frames: frames(1),
  },
  {
    number: '20',
    title: 'Corridor',
    setting: 'int',
    location: 'CORRIDOR',
    time: 'night',
    synopsis: 'Luca waits outside the operating room, a nurse brings coffee.',
    frames: frames(2),
  },
];

/** Draft 3: 12 changed, 14 renumbered 14A, 14B new, 15 gone, 18 relocated, 20 → 21 rewritten. */
const DRAFT_3: NewScene[] = [
  { ...DRAFT_2[0]!, frames: frames(1) },
  {
    ...DRAFT_2[1]!,
    time: 'night',
    synopsis: 'Luca burns dinner; Mara hides the letter.',
    frames: frames(1),
  },
  { ...DRAFT_2[2]!, number: '14A', frames: frames(1) },
  {
    number: '14B',
    title: 'Stairwell',
    setting: 'int',
    location: 'STAIRWELL',
    time: 'night',
    synopsis: 'They run down the stairs.',
    frames: frames(3),
  },
  {
    number: '18',
    title: 'Mara’s Car',
    setting: 'int',
    location: 'MARA’S CAR',
    time: 'night',
    synopsis: 'Mara drives towards the motorway with the letter on the seat.',
    frames: frames(1),
  },
  {
    number: '21',
    title: 'Hospital Corridor',
    setting: 'int',
    location: 'HOSPITAL CORRIDOR',
    time: 'night',
    synopsis: 'Luca waits outside the operating room; a nurse brings him coffee.',
    frames: frames(1),
  },
];

function board() {
  const doc = new Y.Doc();
  const undo = undoOf(doc);
  addScenes(doc, DRAFT_2, opts);
  undo.stopCapturing();
  const scenes = () => storyboardOf(listElements(doc)).flatMap((g) => (g.scene ? [g.scene] : []));
  return { doc, undo, scenes };
}

const brief = (rows: ReturnType<typeof matchRevision>, scenes: SceneElement[]) =>
  rows.map((r) => [
    r.status,
    r.draft === null ? null : DRAFT_3[r.draft]?.number,
    scenes.find((s) => s.id === r.sceneId)?.number ?? null,
    r.changes.join(','),
    r.uncertain,
  ]);

describe('matchRevision', () => {
  it('matches by number, then heading, then text, and finds new and omitted scenes', () => {
    const { scenes } = board();
    const rows = matchRevision(DRAFT_3, scenes());
    expect(brief(rows, scenes())).toEqual([
      ['same', '11', '11', '', false],
      ['changed', '12', '12', 'time,synopsis', false],
      ['changed', '14A', '14', 'number', false],
      ['new', '14B', null, '', false],
      // Omitted: after the scene it followed on the storyboard.
      ['omitted', null, '15', '', false],
      ['changed', '18', '18', 'title,location,synopsis', false],
      ['changed', '21', '20', 'number,title,location,synopsis', true],
    ]);
    expect(rows[3]?.after).toBe(2);
  });

  it('takes the person’s choice for an uncertain scene', () => {
    const { scenes } = board();
    const asNew = matchRevision(DRAFT_3, scenes(), new Map([[5, null]]));
    expect(asNew.find((r) => r.draft === 5)).toMatchObject({ status: 'new', sceneId: null });
    expect(asNew.filter((r) => r.status === 'omitted')).toHaveLength(2);
    const parking = scenes()[3]!;
    const chosen = matchRevision(DRAFT_3, scenes(), new Map([[5, parking.id]]));
    expect(chosen.find((r) => r.draft === 5)).toMatchObject({
      sceneId: parking.id,
      uncertain: false,
    });
  });

  it('brings back an omitted scene the draft has again', () => {
    const { scenes } = board();
    const omitted = scenes().map((s) => (s.number === '15' ? { ...s, omitted: true } : s));
    const rows = matchRevision(DRAFT_2, omitted);
    expect(rows.find((r) => r.sceneId === omitted[3]?.id)).toMatchObject({
      status: 'changed',
      changes: [],
      restored: true,
    });
  });

  it('measures how alike two scenes read', () => {
    expect(similarity(DRAFT_2[5]!, DRAFT_3[5]!)).toBeGreaterThan(0.5);
    expect(similarity(DRAFT_2[0]!, DRAFT_3[3]!)).toBeLessThan(0.2);
  });
});

describe('applyRevision', () => {
  it('updates scenes, inserts new ones in place and marks omitted, frames untouched, one undo', () => {
    const { doc, undo, scenes } = board();
    const framesBefore = listElements(doc).filter((e) => e.type === 'frame');
    const rows = matchRevision(DRAFT_3, scenes());
    const options = { details: true, omit: true };
    expect(revisionCounts(rows, DRAFT_3, options)).toEqual({
      updated: 4,
      added: 1,
      frames: 3,
      omitted: 1,
    });
    applyRevision(doc, rows, DRAFT_3, scenes(), options, opts);

    const groups = storyboardOf(listElements(doc));
    expect(
      groups.map((g) => [g.scene?.number, g.scene?.omitted ?? false, g.frames.length]),
    ).toEqual([
      ['11', false, 2],
      ['12', false, 3],
      ['14A', false, 2],
      ['14B', false, 3],
      ['15', true, 2],
      ['18', false, 1],
      ['21', false, 2],
    ]);
    expect(groups[1]?.scene).toMatchObject({ time: 'night', synopsis: DRAFT_3[1]?.synopsis });
    expect(groups[6]?.scene).toMatchObject({ title: 'Hospital Corridor' });
    // Every frame that was there is there, unchanged.
    for (const frame of framesBefore)
      expect(listElements(doc).find((e) => e.id === frame.id)).toEqual(frame);

    undo.undo();
    expect(scenes().map((s) => [s.number, s.omitted ?? false])).toEqual(
      DRAFT_2.map((s) => [s.number, false]),
    );
    expect(listElements(doc).filter((e) => e.type === 'frame')).toHaveLength(framesBefore.length);
    undo.destroy();
  });

  it('leaves details and omitted scenes alone when those options are off', () => {
    const { doc, scenes } = board();
    const before = scenes();
    const rows = matchRevision(DRAFT_3, before);
    const options = { details: false, omit: false };
    expect(revisionCounts(rows, DRAFT_3, options)).toMatchObject({ updated: 0, omitted: 0 });
    applyRevision(doc, rows, DRAFT_3, before, options, opts);
    const after = scenes();
    expect(after.map((s) => s.number)).toEqual(['11', '12', '14', '14B', '15', '18', '20']);
    expect(after.filter((s) => before.some((b) => b.id === s.id))).toEqual(before);
  });

  it('puts a scene that opens the draft before the first one', () => {
    const { doc, scenes } = board();
    const opening = { number: '1', title: 'Cold Open', frames: frames(1) };
    const draft = [opening, ...DRAFT_2];
    applyRevision(
      doc,
      matchRevision(draft, scenes()),
      draft,
      scenes(),
      { details: true, omit: true },
      opts,
    );
    expect(scenes().map((s) => s.number)).toEqual(['1', '11', '12', '14', '15', '18', '20']);
  });
});
