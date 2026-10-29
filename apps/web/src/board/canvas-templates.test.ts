import type { Board } from '@inkadra/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { createBoard } from './boards.ts';
import { CANVAS_TEMPLATES, createCanvasBoards } from './canvas-templates.ts';

vi.mock('./boards.ts', () => ({ createBoard: vi.fn() }));

let next = 0;
beforeEach(() => {
  next = 0;
  vi.mocked(createBoard).mockReset();
  vi.mocked(createBoard).mockImplementation(
    async (projectId, parentId, title, kind) =>
      ({ id: `b${++next}`, projectId, parentId, title, kind }) as unknown as Board,
  );
});
const t = (key: string) => key;

it('lists a plain board, the one-board templates, then the template that makes a group', () => {
  expect(CANVAS_TEMPLATES).toEqual(['board', 'moodboard', 'storyboard', 'shotlist', 'production']);
});

it('inserts a plain board without a layout', async () => {
  const { board, jobs } = await createCanvasBoards('p', 'here', 'board', t, 'u');
  expect(vi.mocked(createBoard).mock.calls).toEqual([
    ['p', 'here', 'board.board.untitled', 'board'],
  ]);
  expect(board.id).toBe('b1');
  expect(jobs).toEqual([]);
});

it('makes the same board as the project setup for one-board templates', async () => {
  const story = await createCanvasBoards('p', 'here', 'storyboard', t, 'u');
  expect(vi.mocked(createBoard)).toHaveBeenLastCalledWith(
    'p',
    'here',
    'onboarding.templates.storyboard.name',
    'storyboard',
  );
  expect(story.jobs).toEqual([{ boardId: story.board.id, seed: 'storyboard', userId: 'u' }]);
  // The shot list template is a storyboard too, opened in its table view from the board.
  const shots = await createCanvasBoards('p', 'here', 'shotlist', t, 'u');
  expect(vi.mocked(createBoard)).toHaveBeenLastCalledWith(
    'p',
    'here',
    'onboarding.templates.shotlist.name',
    'storyboard',
  );
  expect(shots.jobs).toEqual([{ boardId: shots.board.id, seed: 'storyboard', userId: 'u' }]);
  const mood = await createCanvasBoards('p', 'here', 'moodboard', t, 'u');
  expect(mood.jobs).toEqual([{ boardId: mood.board.id, seed: 'moodboard', userId: 'u' }]);
});

it('puts the boards of a group template inside one new board and links them there last', async () => {
  const { board, jobs } = await createCanvasBoards('p', 'here', 'production', t, 'u');
  const calls = vi.mocked(createBoard).mock.calls;
  expect(calls[0]).toEqual(['p', 'here', 'onboarding.templates.production.name', 'board']);
  expect(calls.slice(1).map(([, parent, title, kind]) => [parent, title, kind])).toEqual([
    [board.id, 'onboarding.boards.brief', 'board'],
    [board.id, 'onboarding.boards.locations', 'board'],
    [board.id, 'onboarding.boards.casting', 'board'],
    [board.id, 'onboarding.boards.moodboard', 'board'],
    [board.id, 'onboarding.boards.storyboard', 'storyboard'],
  ]);
  expect(jobs.map((j) => j.seed ?? 'links')).toEqual([
    'brief',
    'locations',
    'casting',
    'moodboard',
    'storyboard',
    'links',
  ]);
  expect(jobs.at(-1)).toMatchObject({ boardId: board.id, userId: 'u' });
  expect(jobs.at(-1)?.links).toHaveLength(5);
});
