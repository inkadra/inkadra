import { addFrame, addScene, listElements, updateElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import type { Board } from '@inkadra/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

/**
 * Decision 0140, no data lost: a move only takes off the board what it copied, as it copied it,
 * and Undo only takes off the storyboard copies nobody changed there; a storyboard is never
 * deleted, at most trashed when the move made it and nothing else touched it.
 */
const docs = new Map<string, Y.Doc>();
/** Runs between the write and the server's answer: what a colleague does meanwhile. */
let meanwhile: (() => void) | null = null;
vi.mock('./send-to-storyboard.ts', () => ({
  writeToBoard: async <T>(id: string, write: (doc: Y.Doc) => T) => {
    const doc = docs.get(id);
    if (!doc) throw new Error('No such board');
    const value = write(doc);
    meanwhile?.();
    meanwhile = null;
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
  },
  RequestError: class extends Error {},
}));

const { moveScenes } = await import('./scene-move.ts');

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const storyboardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
const opts = { userId: 'u1' };
const boards = [{ id: boardId, kind: 'board' } as Board];

function setUp() {
  docs.clear();
  comments.clear();
  created.length = 0;
  deleted.length = 0;
  meanwhile = null;
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
const move = (doc: Y.Doc, target: Parameters<typeof moveScenes>[0]['target']) =>
  moveScenes({ doc, projectId: 'p', boardId, userId: 'u1', boards, target });
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

  it('never deletes a storyboard: one made for the move goes to the trash only untouched', async () => {
    const first = setUp();
    const moved = await move(first.doc, { title: 'New', new: true });
    await moved.undo();
    expect(ids(first.doc)).toEqual(expect.arrayContaining([first.one.id, first.two.id]));
    expect(listElements(first.doc).some((e) => e.type === 'board')).toBe(false);
    expect(deleted).toEqual([`/boards/${created[0]}`]);

    const second = setUp();
    const again = await move(second.doc, { title: 'New', new: true });
    const made = docs.get(created[0] ?? '') as Y.Doc;
    addScene(made, { number: '9', title: 'Someone else’s' }, opts);
    await again.undo();
    expect(deleted).toEqual([]);
    expect(listElements(made).some((e) => e.type === 'scene' && e.number === '9')).toBe(true);
  });

  it('never trashes a storyboard that was there before', async () => {
    const { doc } = setUp();
    const result = await move(doc, { id: storyboardId, title: 'Film' });
    await result.undo();
    expect(deleted).toEqual([]);
  });
});
