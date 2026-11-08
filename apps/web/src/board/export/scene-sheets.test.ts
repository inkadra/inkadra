// SPDX-License-Identifier: AGPL-3.0-only
import { storyboardOf } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { ShootingDay } from '@inkadra/shared';
import { light } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';
import type { CardContext } from './board-render.ts';
import { finish, type Words } from './compose.ts';
import type { Op, Page } from './pages.ts';
import {
  chosenScenes,
  type Department,
  selectedSceneIds,
  withoutOmitted,
} from './scene-choice.ts';
import { type SceneSheet, type SheetWords, sceneSheetPages, sceneSheets } from './scene-sheets.ts';

const base = { x: 0, y: 0, w: 240, z: 'a0', createdBy: null, createdAt: 0 };
let z = 0;
const scene = (id: string, number: string, extra: object = {}) =>
  ({
    ...base,
    z: `a${z++}`,
    id,
    type: 'scene',
    number,
    title: '',
    parent: null,
    ...extra,
  }) as Element;
const frame = (id: string, parent: string, extra: object = {}) =>
  ({ ...base, z: `a${z++}`, id, type: 'frame', parent, ...extra }) as Element;
const card = (id: string, type: string, extra: object) =>
  ({ ...base, id, type, parent: null, ...extra }) as Element;

const elements: Element[] = [
  scene('s11', '11', { location: 'Street', setting: 'ext', time: 'night' }),
  frame('f11a', 's11', { cast: ['Mara'] }),
  scene('s12', '12', {
    location: 'Kitchen',
    setting: 'int',
    time: 'night',
    synopsis: 'Mara comes home soaked.',
  }),
  frame('f12a', 's12', { cast: ['Mara', 'Luca'], lens: '24', notes: 'Door opens' }),
  frame('f12b', 's12', { cast: ['mara'] }),
  scene('s13', '13'),
  frame('f13a', 's13'),
  scene('s14', '14A'),
  frame('f14a', 's14', { cast: ['Mara'] }),
  card('c1', 'character', {
    name: 'Mara',
    actor: 'Giulia R.',
    costume: 'Costume 2 · wet coat\nHair wet.',
    references: ['ref1', 'ref2'],
  }),
  card('c2', 'character', { name: 'Anna', scenes: ['12'] }),
  card('l1', 'location', {
    name: 'Kitchen',
    address: 'Via Roma 12',
    notes: 'Parking in the courtyard',
    light: 'Window at dusk',
  }),
  card('p1', 'plan', { title: 'Kitchen A', sceneIds: ['s12'] }),
  card('p2', 'plan', { title: 'Hall', sceneIds: ['s13'] }),
  card('t1', 'todo', {
    list: 'props',
    sceneId: 's12',
    items: [
      { id: 'i1', text: 'Towel', done: false },
      { id: 'i2', text: 'towel ', done: false },
      { id: 'i3', text: '', done: false },
    ],
  }),
  card('t2', 'todo', { sceneId: 's12', items: [{ id: 'i4', text: 'Not a list', done: false }] }),
];
const byId = new Map(elements.map((el) => [el.id, el]));
const groups = storyboardOf(elements);

const day = (id: string, date: string, shots: string[], extra: Partial<ShootingDay> = {}) =>
  ({
    id,
    date,
    callTime: '18:30',
    wrap: null,
    location: '',
    notes: '',
    blocks: shots.map((shotId, i) => ({
      id: `${id}-${i}`,
      type: 'shot',
      title: '',
      start: null,
      duration: 30,
      shotId,
      cast: [],
      departments: shotId === 'f12a' ? ['Lights off: blackout on the windows'] : [],
    })),
    ...extra,
  }) as unknown as ShootingDay;
const days = [day('d1', '2026-11-17', ['f11a']), day('d2', '2026-11-18', ['f13a', 'f12a'])];

describe('which scenes get a sheet', () => {
  it('takes every scene, the selected ones or those of a shooting day in its order', () => {
    const numbers = (list: readonly { number: string }[]) => list.map((s) => s.number);
    expect(numbers(chosenScenes(groups, 'all', new Set(), days, byId))).toEqual([
      '11',
      '12',
      '13',
      '14A',
    ]);
    // A frame stands for its scene.
    const picked = new Set(['f14a', 's11']);
    expect([...selectedSceneIds(picked, byId)]).toEqual(['s14', 's11']);
    expect(numbers(chosenScenes(groups, 'selection', picked, days, byId))).toEqual(['11', '14A']);
    expect(numbers(chosenScenes(groups, 'day:d2', new Set(), days, byId))).toEqual(['13', '12']);
    expect(chosenScenes(groups, 'day:gone', new Set(), days, byId)).toEqual([]);
  });

  it('leaves out scenes the export may not show', () => {
    const visible = groups.filter((g) => g.scene?.id !== 's12');
    expect(chosenScenes(visible, 'day:d2', new Set(), days, byId).map((s) => s.id)).toEqual([
      's13',
    ]);
  });
});

const text = {
  project: 'The Long Night',
  slugline: (s: Extract<Element, { type: 'scene' }>) =>
    [s.setting?.toUpperCase(), s.location?.toUpperCase()].filter(Boolean).join(' '),
  time: (s: Extract<Element, { type: 'scene' }>) => [s.setting, s.time].filter(Boolean).join(' · '),
  day: (n: number, date: string) => `Day ${n} · ${date}`,
  dayOf: (n: number, total: number, list: string) => `Day ${n} of ${total} · scenes ${list}`,
  continuity: (name: string, previous: string, next: string) =>
    `${name}: ${previous || '-'} / ${next || '-'}`,
};

function build(scenes: string[], withDays = true, storyboard = groups): SceneSheet[] {
  return sceneSheets({
    scenes: scenes.map((id) => byId.get(id) as Extract<Element, { type: 'scene' }>),
    groups: storyboard,
    elements,
    days: withDays ? days : [],
    byId,
    shot: (f, s) => ({
      frame: f,
      label: `${s.number}${f.id.at(-1)}`,
      scene: s,
      size: '',
      angle: '',
      movement: '',
    }),
    text,
  });
}

describe('what a sheet holds', () => {
  const [sheet] = build(['s12']);

  it('reads the scene, its day and its place', () => {
    expect(sheet).toMatchObject({
      overline: 'The Long Night · Day 2 · 2026-11-18',
      heading: '12 · INT KITCHEN',
      call: '18:30',
      location: 'Via Roma 12',
      locationDetail: 'Parking in the courtyard',
      light: 'Window at dusk',
      time: 'int · night',
      synopsis: 'Mara comes home soaked.',
      day: 'Day 2 of 2 · scenes 13, 12',
      notes: ['Lights off: blackout on the windows'],
    });
    expect(sheet?.shots.map((s) => s.frame.id)).toEqual(['f12a', 'f12b']);
    expect(sheet?.plans.map((p) => p.id)).toEqual(['p1']);
  });

  it('finds the characters by the cast of the frames and the scenes of their card', () => {
    expect(sheet?.characters).toEqual([
      {
        name: 'Mara',
        actor: 'Giulia R.',
        costume: 'Costume 2 · wet coat\nHair wet.',
        refs: ['ref1', 'ref2'],
        continuity: 'Mara: 11 (EXT STREET) / 14A',
      },
      { name: 'Luca', actor: '', costume: '', refs: [], continuity: '' },
      { name: 'Anna', actor: '', costume: '', refs: [], continuity: '' },
    ]);
    expect(sheet?.cast).toBe('Mara (Giulia R.), Luca, Anna');
  });

  it('merges the items to bring, from typed lists only', () => {
    expect(sheet?.needed).toEqual(['Towel ×2']);
  });

  it('skips omitted scenes, left out of the export, in the continuity', () => {
    const draft = elements.map((el) => (el.id === 's12' ? { ...el, omitted: true } : el));
    const kept = withoutOmitted(storyboardOf(draft as Element[]));
    expect(chosenScenes(kept, 'all', new Set(), days, byId).map((s) => s.number)).toEqual([
      '11',
      '13',
      '14A',
    ]);
    const [first] = build(['s11'], false, kept);
    expect(first?.characters[0]?.continuity).toBe('Mara: - / 14A');
  });

  it('has no schedule without shooting days, as for clients', () => {
    const [bare] = build(['s12'], false);
    expect(bare).toMatchObject({ overline: 'The Long Night', call: '', day: '', notes: [] });
  });
});

const ctx: CardContext = {
  measure: (value, size) => [...value].length * size * 0.5,
  colors: light,
  noteBlocks: () => [],
  image: (id) => (id ? { key: id, info: { width: 3, height: 2 } } : null),
  fileName: () => '',
  boardTitle: () => '',
  frameLabel: () => '',
  frameAspect: () => 16 / 9,
  frameMeta: () => '',
  slugline: () => '',
  characterLine: () => '',
  storyMeta: () => '',
  words: { board: 'Board', file: 'File', plan: 'Set plan' },
};

const words: SheetWords = {
  department: 'Camera',
  footer: 'Inkadra · The team',
  pageOf: (n, total) => `${n} / ${total}`,
  none: 'No scenes',
  call: 'Call',
  location: 'Location',
  time: 'Time',
  cast: 'Cast',
  frames: 'Frames',
  characters: 'Characters',
  inScene: 'Characters in this scene',
  playedBy: (actor) => `Played by ${actor}`,
  continuity: 'Continuity',
  setPlan: 'Set plan',
  frameNotes: 'Frame notes',
  light: 'Light',
  shootingDay: 'Shooting day',
  needed: 'Needed',
  notes: 'Notes',
  production: 'Production',
  columns: {
    frame: 'Frame',
    number: '#',
    size: 'Size',
    angle: 'Angle',
    movement: 'Move',
    lens: 'Lens',
    notes: 'Notes',
  },
};

const texts = (ops: readonly Op[]): string[] =>
  ops.flatMap((op) => (op.kind === 'text' ? [op.text] : op.kind === 'clip' ? texts(op.ops) : []));
const setup = { paper: 'a4', orientation: 'portrait' } as const;
const pages = (department: Department, sheets = build(['s12'])) =>
  sceneSheetPages(setup, sheets, department, ctx, words);

describe('the printed sheet', () => {
  it('prints what the department needs and leaves out empty fields', () => {
    const camera = texts(pages('camera')[0]?.ops ?? []);
    expect(camera).toEqual(
      expect.arrayContaining(['12 · INT KITCHEN', 'FRAMES', '12a', 'Door opens']),
    );
    expect(camera).toContain('SET PLAN · KITCHEN A');
    expect(camera).not.toContain('CHARACTERS IN THIS SCENE');

    const costume = texts(pages('costume')[0]?.ops ?? []);
    expect(costume).toEqual(
      expect.arrayContaining(['MARA', 'Played by Giulia R.', 'Costume 2 · wet coat', 'CONTINUITY']),
    );
    expect(costume).not.toContain('FRAMES');

    const production = texts(pages('production')[0]?.ops ?? []);
    expect(production).toEqual(expect.arrayContaining(['• Towel ×2', 'CALL', '18:30']));
    // No call time without a schedule: neither the label nor a placeholder.
    expect(texts(pages('production', build(['s12'], false))[0]?.ops ?? [])).not.toContain('CALL');

    const everything = pages('everything').flatMap((page) => texts(page.ops));
    expect(everything).toEqual(expect.arrayContaining(['FRAMES', 'MARA', '• Towel ×2']));
  });

  it('starts every scene on a page and flows a long one onto more under the same header', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      frame(`long${i}`, 's12', { notes: 'A note' }),
    );
    const [sheet] = build(['s12']);
    const long = {
      ...(sheet as SceneSheet),
      shots: many.map((f) => ({
        frame: f as Extract<Element, { type: 'frame' }>,
        label: f.id,
        scene: null,
        size: '',
        angle: '',
        movement: '',
      })),
    };
    const out = pages('camera', [long, ...build(['s13'])]);
    expect(out.length).toBeGreaterThan(2);
    expect(texts(out[1]?.ops ?? [])).toContain('12 · INT KITCHEN');
    expect(texts(out.at(-1)?.ops ?? [])[1]).toBe('13');
  });

  it('numbers its own footer and skips the running header of other pages', () => {
    const out: Page[] = finish(
      pages('camera', build(['s12', 's13'])),
      {} as never,
      ctx,
      {} as Words,
      false,
    );
    expect(texts(out[0]?.ops ?? [])).toEqual(
      expect.arrayContaining(['Inkadra · The team', '1 / 2']),
    );
    expect(texts(out[1]?.ops ?? [])).toContain('2 / 2');
  });

  it('says so when no scene is left', () => {
    expect(texts(pages('camera', [])[0]?.ops ?? [])).toContain('No scenes');
  });
});
