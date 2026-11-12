import type { Board, Project } from '@inkadra/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { createBoard, loadBoards } from '../board/boards.ts';
import { addBoard, addBoardItems } from './add-storyboard.ts';

vi.mock('../board/boards.ts', async (original) => ({
  ...(await original<typeof import('../board/boards.ts')>()),
  loadBoards: vi.fn(),
  createBoard: vi.fn(),
}));

const project = { id: 'p1', rootBoardId: 'root' };
const t = (key: string) => key;
const board = (id: string, kind: Board['kind']) =>
  ({ id, kind, parentBoardId: 'root', title: id, position: id }) as Board;
beforeEach(() => vi.clearAllMocks());

it('makes a storyboard under the root the way the Canvas menu does, and returns its address', async () => {
  vi.mocked(loadBoards).mockResolvedValue([board('a', 'board')]);
  vi.mocked(createBoard).mockResolvedValue(board('s', 'storyboard'));
  await expect(addBoard(project, 'storyboard', t)).resolves.toBe('/p/p1/b/s');
  expect(createBoard).toHaveBeenCalledWith('p1', 'root', 'film.views.storyboard', 'storyboard');
});

it('adds a second storyboard next to the first, with a number', async () => {
  vi.mocked(loadBoards).mockResolvedValue([board('s', 'storyboard')]);
  vi.mocked(createBoard).mockResolvedValue(board('s2', 'storyboard'));
  await expect(addBoard(project, 'storyboard', t)).resolves.toBe('/p/p1/b/s2');
  expect(createBoard).toHaveBeenCalledWith('p1', 'root', 'film.views.storyboard 2', 'storyboard');
});

it('makes a moodboard too', async () => {
  vi.mocked(loadBoards).mockResolvedValue([board('s', 'storyboard')]);
  vi.mocked(createBoard).mockResolvedValue(board('m', 'moodboard'));
  await expect(addBoard(project, 'moodboard', t)).resolves.toBe('/p/p1/b/m');
  expect(createBoard).toHaveBeenCalledWith('p1', 'root', 'film.views.moodboard', 'moodboard');
});

it('fails when the boards cannot be loaded, and is offered to editors only', async () => {
  vi.mocked(loadBoards).mockResolvedValue(null);
  await expect(addBoard(project, 'storyboard', t)).rejects.toThrow();
  const menu = (myRole: Project['myRole']) =>
    addBoardItems({ ...project, myRole } as Project, t, vi.fn(), []);
  expect(menu('editor')).toHaveLength(2);
  expect(menu('owner')).toHaveLength(2);
  expect(menu('viewer')).toHaveLength(0);
});

it('offers only the kinds of modules that are on (decision 0121)', () => {
  const labels = (off: string[]) =>
    addBoardItems({ ...project, myRole: 'owner' } as Project, t, vi.fn(), off).map((i) => i.label);
  expect(labels(['storyboard'])).toEqual(['nav.addMoodboard']);
  expect(labels(['moodboard', 'storyboard'])).toEqual([]);
  expect(labels(['plan', 'later'])).toHaveLength(2);
});
