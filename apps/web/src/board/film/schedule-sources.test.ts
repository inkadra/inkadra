import { createElement, storyboardOf } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import type { Board, ScheduleBlock } from '@inkadra/shared';
import { glyphColor } from '@inkadra/ui';
import { describe, expect, it } from 'vitest';
import type { BoardConnection } from '../connection.ts';
import { BoardStore } from '../store.ts';
import { newScheduleBlock } from './schedule.ts';
import {
  dayElements,
  lookOf,
  offersWhole,
  plannedKeys,
  type ScheduleSources,
  sourceOf,
  storyboardDots,
  UNAVAILABLE_DOT,
  withLabels,
} from './schedule-sources.tsx';

const PROD = '0193f0a4-6c1e-7b9a-9c51-000000000001';
const A = '0193f0a4-6c1e-7b9a-9c51-00000000000a';
const B = '0193f0a4-6c1e-7b9a-9c51-00000000000b';
const GONE = '0193f0a4-6c1e-7b9a-9c51-00000000000c';
const opts = { userId: null };

/** A storyboard with one scene "1" and its frame "1A". */
function storyboard(id: string) {
  const doc = createBoardDoc(id);
  const scene = createElement(doc, 'scene', { x: 0, y: 0 }, { number: '1', title: '' }, opts);
  const frame = createElement(doc, 'frame', { x: 0, y: 0 }, { parent: scene.id }, opts);
  return { store: new BoardStore(doc), scene, frame };
}

/** What the Production board reads of two storyboards, as useScheduleSources merges them. */
function sources(...boards: Array<{ id: string; store: BoardStore }>): ScheduleSources {
  const byId = new Map();
  const boardOf = new Map<string, string>();
  const labels = new Map<string, string>();
  const groups: ScheduleSources['groups'] = [];
  for (const { id, store } of boards) {
    for (const [key, el] of store.getSnapshot().byId) {
      byId.set(key, el);
      boardOf.set(key, id);
    }
    const all = storyboardOf([...store.getSnapshot().byId.values()]);
    for (const g of all) {
      groups.push({ ...g, boardId: id });
      for (const f of g.frames) labels.set(f.id, `${g.scene?.number}A`);
    }
  }
  return {
    dayBoardId: PROD,
    across: true,
    list: boards.map(({ id, store }) => ({
      boardId: id,
      title: id === A ? 'Teaser' : 'Film',
      dot: id === A ? 'red' : 'blue',
      store,
      readOnly: false,
    })),
    byId,
    groups,
    frames: groups.flatMap((g) => g.frames),
    labels,
    boardOf,
    loading: false,
  };
}

describe('blocks across storyboards (decision 0123)', () => {
  const a = storyboard(A);
  const b = storyboard(B);
  const read = sources({ id: A, store: a.store }, { id: B, store: b.store });
  const shot = (shotId: string, shotBoardId: string, more: Partial<ScheduleBlock> = {}) => ({
    ...newScheduleBlock('shot', shotId),
    shotBoardId,
    ...more,
  });

  it("reads a block's frame from its own storyboard, with its dot", () => {
    const look = lookOf(shot(a.frame.id, A), read, 'n/a');
    expect(look).toMatchObject({ label: '1A', frame: { id: a.frame.id }, missing: false });
    expect(look?.scene?.id).toBe(a.scene.id);
    expect(look?.dot).toEqual({ color: 'red', name: 'Teaser' });
    // The frame named with the other storyboard's id is not this one.
    expect(lookOf(shot(a.frame.id, B), read, 'n/a')).toMatchObject({ missing: true });
  });

  it('shows the stored label with the grey dot when its storyboard cannot be read', () => {
    const look = lookOf(shot('gonexxxxxx', GONE, { shotLabel: '7B' }), read, 'Not available');
    expect(look).toMatchObject({ label: '7B', frame: undefined, missing: false });
    expect(look?.dot).toEqual({ color: UNAVAILABLE_DOT, name: 'Not available' });
  });

  it('reads a scene block as its scene, drawn or not', () => {
    const block = { ...newScheduleBlock('scene'), sceneId: b.scene.id, sceneBoardId: B };
    expect(lookOf(block, read, '')).toMatchObject({ label: '1', scene: { id: b.scene.id } });
    expect(lookOf(newScheduleBlock('break'), read, '')).toBeNull();
  });

  it('keeps the labels as last seen when a day is saved, not on a storyboard of its own', () => {
    expect(withLabels(shot(b.frame.id, B), read).shotLabel).toBe('1A');
    const scene = { ...newScheduleBlock('scene'), sceneId: a.scene.id, sceneBoardId: A };
    expect(withLabels(scene, read).sceneLabel).toBe('1');
    // An unreadable storyboard keeps the label it had.
    const kept = shot('gonexxxxxx', GONE, { shotLabel: '7B' });
    expect(withLabels(kept, read)).toBe(kept);
    expect(withLabels(shot(b.frame.id, B), { ...read, across: false }).shotLabel).toBeUndefined();
  });

  it('offers a scene as a whole until a block plans it, while it has frames to plan or none', () => {
    const film = read.groups.find((g) => g.boardId === B && g.scene);
    if (!film) throw new Error('no scene');
    expect(offersWhole(film, new Set())).toBe(true);
    expect(offersWhole(film, new Set([`shot:${B}/${b.frame.id}`]))).toBe(false);
    expect(offersWhole({ ...film, frames: [] }, new Set())).toBe(true);
    expect(offersWhole(film, new Set([`scene:${B}/${b.scene.id}`]))).toBe(false);
  });

  it('keys planned frames and scenes by board and id', () => {
    const keys = plannedKeys(
      [
        shot(a.frame.id, A),
        { ...newScheduleBlock('scene'), sceneId: b.scene.id, sceneBoardId: B },
        newScheduleBlock('shot', 'ownframexx'),
      ],
      PROD,
    );
    expect(keys).toEqual(
      new Set([`shot:${A}/${a.frame.id}`, `scene:${B}/${b.scene.id}`, `shot:${PROD}/ownframexx`]),
    );
    expect(keys.has(`shot:${B}/${a.frame.id}`)).toBe(false);
  });
});

describe('the dot of a storyboard (decision 0123)', () => {
  const at = (id: string, createdAt: string, icon?: Board['icon']) =>
    ({ id, kind: 'storyboard', parentBoardId: 'root', createdAt, icon }) as Board;
  it('is its icon colour, else a colour of the identity palette taken from its id', () => {
    const own = at('own', '2026-03-01', { shape: 'circle', color: 'pink', emoji: null });
    const first = at('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a20', '2026-01-01');
    const second = at('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a21', '2026-02-01');
    const dots = storyboardDots([second, first, own]);
    expect(dots.get('own')).toBe(glyphColor.pink);
    const palette = new Set<string>(Object.values(glyphColor));
    expect(palette.has(dots.get(first.id) ?? '')).toBe(true);
    expect(dots.get(first.id)).not.toBe(glyphColor.neutral);
    // An earlier storyboard going to the trash does not change the colour of a later one.
    expect(storyboardDots([second]).get(second.id)).toBe(dots.get(second.id));
  });
});

describe("a day's cards on the Production board (decision 0123)", () => {
  it('are those of the storyboards the day plans, the first in tree order winning', () => {
    const a = storyboard(A);
    const b = storyboard(B);
    const read = sources({ id: A, store: a.store }, { id: B, store: b.store });
    const only = dayElements(
      { blocks: [{ type: 'shot', shotId: b.frame.id, shotBoardId: B }] },
      read,
    );
    expect(only.has(b.frame.id)).toBe(true);
    expect(only.has(a.frame.id)).toBe(false);
    expect(dayElements({ blocks: [] }, read).size).toBe(0);
    // A storyboard's own schedule reads all of its cards.
    expect(dayElements({ blocks: [] }, { ...read, across: false })).toBe(read.byId);
  });
});

describe('sourceOf (#826)', () => {
  const summary = storyboard(A).store;
  const conn = (status: BoardConnection['status'], store: BoardStore, readOnly = false) => ({
    status,
    store,
    readOnly,
  });

  it('reads the open document once synced, with the person’s role', () => {
    const live = storyboard(A).store;
    expect(sourceOf(A, conn('synced', live), summary)).toEqual({
      boardId: A,
      store: live,
      readOnly: false,
    });
  });

  it('ticks offline on a document that holds the board, not on the summary', () => {
    const held = storyboard(A).store;
    expect(sourceOf(A, conn('offline', held), summary)?.store).toBe(held);
    // An empty document offline (nothing kept): the summary, read only.
    const empty = new BoardStore(createBoardDoc(A));
    expect(sourceOf(A, conn('offline', empty), summary)).toEqual({
      boardId: A,
      store: summary,
      readOnly: true,
    });
  });

  it('reads the summary, read only, until the document is open, and nothing once refused', () => {
    expect(sourceOf(A, undefined, summary)).toMatchObject({ store: summary, readOnly: true });
    const live = storyboard(A).store;
    expect(sourceOf(A, conn('connecting', live), summary)?.store).toBe(summary);
    expect(sourceOf(A, conn('denied', live), summary)).toBeNull();
    expect(sourceOf(A, undefined, undefined)).toBeNull();
  });
});
