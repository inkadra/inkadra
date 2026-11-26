import {
  addFrame,
  addScene,
  createElement,
  intersects,
  listElements,
  updateElement,
} from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import type { Board } from '@inkadra/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

/**
 * Decision 0140, no data lost: a move only takes off the board what it copied, as it copied it,
 * and Undo only takes off the storyboard copies nobody changed there; a storyboard is never
 * deleted, at most trashed when the move made it and nothing else touched it.
 */
const docs = new Map<string, Y.Doc>();
/** Runs between the write and the server's answer: what a colleague does meanwhile. */
let meanwhile: (() => void) | null = null;
/** Connections kept open a little longer: their `end`. */
const lingering: Array<() => void> = [];
vi.mock('./send-to-storyboard.ts', () => ({
  writeToBoard: async <T>(id: string, write: (doc: Y.Doc) => T, linger?: { end: () => void }) => {
    const doc = docs.get(id);
    if (!doc) throw new Error('No such board');
    const value = write(doc);
    meanwhile?.();
    meanwhile = null;
    if (linger) lingering.push(linger.end);
    return value;
  },
}));
const created: string[] = [];
vi.mock('../boards.ts', () => ({
  createBoard: async () => {
    const id = `0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a${20 + created.length}`;
    created.push(id);
    docs.set(id, createBoardDoc(id));
    return { id };
  },
  refreshBoards: async () => {},
  productionOf: () => undefined,
  boardsWith: () => null,
}));
const deleted: string[] = [];
/** Calls of the move of the server's data (capability `element-data-move`). */
type DataMove = { from: string; to: string; ids: string[] };
const moves: DataMove[] = [];
/** Runs on each of those calls: throws to fail it. */
let onMove: ((call: DataMove) => void) | null = null;
/** Cards the server says have data of guests whose link does not reach the storyboard. */
let outOfReach: string[] = [];
/** Cards the server keeps something about, by board. */
const comments = new Map<string, string[]>();
vi.mock('../../lib/api.ts', () => ({
  api: {
    get: async (path: string) => {
      const board = path.split('/')[2] ?? '';
      if (path.endsWith('/comment-counts'))
        return {
          items: (comments.get(board) ?? []).map((elementId) => ({
            elementId,
            open: 1,
            resolved: 0,
          })),
        };
      if (path.endsWith('/schedule')) return { items: [] };
      return { items: [] };
    },
    delete: async (path: string) => {
      deleted.push(path);
    },
    post: async (path: string, body: { toBoardId: string; elementIds: string[] }) => {
      const from = path.split('/')[2] ?? '';
      const call = { from, to: body.toBoardId, ids: body.elementIds };
      moves.push(call);
      if (onMove) onMove(call);
      return {
        comments: 1,
        reactions: 0,
        reviews: 0,
        reviewEvents: 0,
        picks: 0,
        notifications: 0,
        shootingDays: 0,
        guestsOutOfReach: call.ids.filter((id) => outOfReach.includes(id)),
      };
    },
  },
  RequestError: class extends Error {},
}));

const { moveScenes, setElementDataMove, SceneMoveError } = await import('./scene-move.ts');

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const storyboardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
const opts = { userId: 'u1' };
const boards = [{ id: boardId, kind: 'board' } as Board];

function setUp() {
  docs.clear();
  comments.clear();
  created.length = 0;
  deleted.length = 0;
  moves.length = 0;
  onMove = null;
  outOfReach = [];
  meanwhile = null;
  lingering.length = 0;
  const doc = createBoardDoc(boardId);
  docs.set(boardId, doc);
  const story = createBoardDoc(storyboardId);
  docs.set(storyboardId, story);
  const one = addScene(doc, { number: '1', title: 'Station' }, opts, { x: 0, y: 0 });
  const two = addScene(doc, { number: '2', title: 'Diner' }, opts, { x: 300, y: 0 });
  const a = addFrame(doc, one.id, null, {}, opts);
  const b = addFrame(doc, two.id, null, {}, opts);
  return { doc, story, one, two, a, b };
}
const late: Array<{ scenes: number; lost: number }> = [];
const move = (doc: Y.Doc, target: Parameters<typeof moveScenes>[0]['target']) =>
  moveScenes({
    doc,
    projectId: 'p',
    boardId,
    userId: 'u1',
    boards,
    target,
    measure: (card) => ({ w: card.w ?? 280, h: card.h ?? 120 }),
    onLate: (notice) => late.push(notice),
  });
const sync = (from: Y.Doc, to: Y.Doc) =>
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
const ids = (doc: Y.Doc) => listElements(doc).map((e) => e.id);

describe('a move never loses what changes meanwhile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps on the board a scene a colleague edits between the copy and the removal', async () => {
    const { doc, story, one, two, a } = setUp();
    meanwhile = () => updateElement(doc, a.id, { action: 'Edited meanwhile' });
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    expect(result.moved).toBe(1);
    expect(result.changed).toBe(1);
    // The edited scene stays on the board, edit included; its stale copy left the storyboard.
    expect(ids(doc)).toContain(one.id);
    expect(listElements(doc).find((e) => e.id === a.id)).toMatchObject({
      action: 'Edited meanwhile',
    });
    expect(ids(doc)).not.toContain(two.id);
    expect(ids(story)).toContain(two.id);
    expect(ids(story)).not.toContain(one.id);
  });

  it('keeps on the board a scene that gains a frame meanwhile', async () => {
    const { doc, two } = setUp();
    meanwhile = () => addFrame(doc, two.id, null, {}, opts);
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    expect(result.changed).toBe(1);
    expect(ids(doc)).toContain(two.id);
  });

  it('undoes only what is unchanged in the storyboard, keeping a colleague’s edit there', async () => {
    const { doc, story, one, two, a, b } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    expect(result.moved).toBe(2);
    updateElement(story, b.id, { action: 'Drawn in the storyboard' });
    const { back, stayed } = await result.undo();
    expect([back, stayed]).toEqual([1, 1]);
    // Scene one is back where it was, with its frame; scene two stays in the storyboard, edited.
    expect(listElements(doc).find((e) => e.id === one.id)).toMatchObject({ x: 0, y: 0 });
    expect(ids(doc)).toContain(a.id);
    expect(ids(story)).not.toContain(one.id);
    expect(ids(doc)).not.toContain(two.id);
    expect(listElements(story).find((e) => e.id === b.id)).toMatchObject({
      action: 'Drawn in the storyboard',
    });
    // Something still points there: the storyboard's card stays.
    expect(listElements(doc).some((e) => e.type === 'board')).toBe(true);
  });

  it('keeps in the storyboard a copy that got comments there', async () => {
    const { doc, story, two } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    comments.set(storyboardId, [two.id]);
    const { stayed } = await result.undo();
    expect(stayed).toBe(1);
    expect(ids(story)).toContain(two.id);
  });

  it('never deletes nor trashes a storyboard; one made for the move and left empty is named', async () => {
    const { doc, one, two } = setUp();
    const moved = await move(doc, { title: 'New', new: true });
    const { emptyStoryboard } = await moved.undo();
    expect(ids(doc)).toEqual(expect.arrayContaining([one.id, two.id]));
    expect(listElements(doc).some((e) => e.type === 'board')).toBe(false);
    expect(emptyStoryboard).toBe('New');
    expect(deleted).toEqual([]);
  });

  it('puts the scenes back clear of a card that took their place, their layout kept', async () => {
    const { doc, one, two } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    // Someone put a note where scene one was.
    createElement(doc, 'note', { x: 0, y: 0 }, { w: 200, h: 200 }, opts);
    await result.undo();
    const back = listElements(doc);
    const a = back.find((e) => e.id === one.id);
    const b = back.find((e) => e.id === two.id);
    expect(a && b ? [b.x - a.x, b.y - a.y] : null).toEqual([300, 0]);
    expect(
      a && intersects({ x: a.x, y: a.y, w: 280, h: 120 }, { x: 0, y: 0, w: 200, h: 200 }),
    ).toBe(false);
  });

  it('carries a colleague’s change that lands after the removal to the storyboard', async () => {
    const { doc, story, a } = setUp();
    late.length = 0;
    const theirs = new Y.Doc();
    sync(doc, theirs);
    await move(doc, { id: storyboardId, title: 'Film' });
    // Their change was sent before they saw the scenes go.
    updateElement(theirs, a.id, { action: 'Late but kept' });
    sync(theirs, doc);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(listElements(story).find((e) => e.id === a.id)).toMatchObject({
      action: 'Late but kept',
    });
    expect(late).toEqual([{ scenes: 1, lost: 0 }]);
  });

  it('carries a change that lands in the storyboard while Undo takes the copies off', async () => {
    const { doc, story, a } = setUp();
    late.length = 0;
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    const theirs = new Y.Doc();
    sync(story, theirs);
    await result.undo();
    updateElement(theirs, a.id, { action: 'Drawn while undoing' });
    sync(theirs, story);
    await new Promise((r) => setTimeout(r, 0));
    for (const end of lingering) end();
    expect(listElements(doc).find((e) => e.id === a.id)).toMatchObject({
      action: 'Drawn while undoing',
    });
    expect(late).toEqual([{ scenes: 1, lost: 0 }]);
  });

  it('never trashes a storyboard that was there before', async () => {
    const { doc } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    await result.undo();
    expect(deleted).toEqual([]);
  });
});

describe('with the server moving its data along (element-data-move)', () => {
  beforeEach(() => setElementDataMove(true));
  afterEach(() => setElementDataMove(false));

  it('moves a commented scene: its data goes after the copy, before the board lets it go', async () => {
    const { doc, story, one, two, a } = setUp();
    comments.set(boardId, [a.id]);
    const seen: Array<[boolean, boolean]> = [];
    onMove = (call) => {
      if (call.from === boardId)
        seen.push([ids(story).includes(one.id), ids(doc).includes(one.id)]);
    };
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    expect(result.moved).toBe(2);
    expect(result.plan.stay).toEqual([]);
    expect(result.dataMoved).toBeGreaterThan(0);
    // Copied and still on the board when the data moved; then a sweep for late comments.
    expect(seen[0]).toEqual([true, true]);
    expect(moves[0]).toMatchObject({ from: boardId, to: storyboardId });
    expect(moves[0]?.ids).toEqual(expect.arrayContaining([one.id, two.id, a.id]));
    expect(ids(doc)).not.toContain(one.id);
  });

  it('keeps the scenes on the board when the data cannot move, and takes the copies back', async () => {
    const { doc, story, one, two } = setUp();
    onMove = (call) => {
      if (call.from === boardId) throw new Error('offline');
    };
    await expect(move(doc, { id: storyboardId, title: 'Film' })).rejects.toBeInstanceOf(
      SceneMoveError,
    );
    expect(ids(doc)).toEqual(expect.arrayContaining([one.id, two.id]));
    expect(ids(story)).toEqual([]);
    // A lost answer may have moved it all the same: it was asked back.
    expect(moves.map((m) => m.from)).toEqual([boardId, storyboardId]);
  });

  it('keeps the copies in the storyboard when the data can neither move nor come back', async () => {
    const { doc, story, one } = setUp();
    onMove = () => {
      throw new Error('offline');
    };
    await expect(move(doc, { id: storyboardId, title: 'Film' })).rejects.toThrow();
    expect(ids(doc)).toContain(one.id);
    expect(ids(story)).toContain(one.id);
  });

  it('brings back the data of a scene that changed meanwhile and stays on the board', async () => {
    const { doc, one, a } = setUp();
    meanwhile = () => updateElement(doc, a.id, { action: 'Edited meanwhile' });
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    expect(result.changed).toBe(1);
    const back = moves.find((m) => m.from === storyboardId);
    expect(back?.to).toBe(boardId);
    expect(back?.ids).toEqual(expect.arrayContaining([one.id, a.id]));
  });

  it('Undo brings the data back between the copy on the board and the removal from the storyboard', async () => {
    const { doc, story, one, a } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    // A comment written in the storyboard no longer keeps a scene there.
    comments.set(storyboardId, [a.id]);
    moves.length = 0;
    const seen: Array<[boolean, boolean]> = [];
    onMove = () => seen.push([ids(doc).includes(one.id), ids(story).includes(one.id)]);
    const { back, stayed } = await result.undo();
    expect([back, stayed]).toEqual([2, 0]);
    expect(moves[0]).toMatchObject({ from: storyboardId, to: boardId });
    expect(moves[0]?.ids).toEqual(expect.arrayContaining([one.id, a.id]));
    expect(seen).toEqual([[true, true]]);
    expect(ids(story)).toEqual([]);
  });

  it('Undo leaves the scenes in the storyboard when their data cannot come back', async () => {
    const { doc, story, one } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    onMove = (call) => {
      if (call.from === storyboardId) throw new Error('offline');
    };
    await expect(result.undo()).rejects.toThrow();
    expect(ids(story)).toContain(one.id);
    expect(ids(doc)).not.toContain(one.id);
  });

  it('counts the scenes whose guests’ link does not reach the storyboard', async () => {
    const { doc, a } = setUp();
    outOfReach = [a.id];
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    expect(result.guestsUnreached).toBe(1);
  });

  it('Undo keeps in the storyboard a copy changed just before its data would come back', async () => {
    const { doc, story, one, two, a } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    moves.length = 0;
    // Runs right after the copies are back on the board, before the data is asked back.
    meanwhile = () => updateElement(story, a.id, { action: 'Drawn meanwhile' });
    const { back, stayed } = await result.undo();
    expect([back, stayed]).toEqual([1, 1]);
    expect(ids(doc)).not.toContain(one.id);
    expect(ids(story)).toContain(one.id);
    expect(ids(doc)).toContain(two.id);
    // Only the unchanged scene's data came back.
    expect(moves).toHaveLength(1);
    expect(moves[0]?.ids).not.toContain(one.id);
  });

  it('Undo sends the data back to a copy changed while it came back, keeping the scene there', async () => {
    const { doc, story, one, a } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    moves.length = 0;
    onMove = (call) => {
      if (call.from === storyboardId) updateElement(story, a.id, { action: 'Drawn meanwhile' });
    };
    const { back, stayed } = await result.undo();
    expect([back, stayed]).toEqual([1, 1]);
    // Its data went back to the storyboard before its copy left the board.
    const again = moves.find((m) => m.from === boardId);
    expect(again?.to).toBe(storyboardId);
    expect(again?.ids).toEqual(expect.arrayContaining([one.id, a.id]));
    expect(ids(story)).toContain(one.id);
    expect(ids(doc)).not.toContain(one.id);
  });
});
