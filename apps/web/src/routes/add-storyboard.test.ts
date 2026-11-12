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
  expect(menu('editor')).toHaveLength(3);
  expect(menu('owner')).toHaveLength(3);
  expect(menu('viewer')).toHaveLength(0);
});

it('offers only the kinds of modules that are on (decision 0121)', () => {
  const labels = (off: string[]) =>
    addBoardItems({ ...project, myRole: 'owner' } as Project, t, vi.fn(), off).map((i) => i.label);
  expect(labels(['storyboard', 'production'])).toEqual(['nav.addMoodboard']);
  expect(labels(['moodboard', 'storyboard', 'production'])).toEqual([]);
  expect(labels(['plan', 'later'])).toHaveLength(3);
});

it('makes the one Production board, or opens the one the project has (decision 0123)', async () => {
  vi.mocked(loadBoards).mockResolvedValue([board('s', 'storyboard')]);
  vi.mocked(createBoard).mockResolvedValue(board('p', 'production'));
  await expect(addBoard(project, 'production', t)).resolves.toBe('/p/p1/b/p');
  expect(createBoard).toHaveBeenCalledWith('p1', 'root', 'film.views.production', 'production');
  vi.mocked(createBoard).mockClear();
  vi.mocked(loadBoards).mockResolvedValue([board('s', 'storyboard'), board('p', 'production')]);
  await expect(addBoard(project, 'production', t)).resolves.toBe('/p/p1/b/p');
  expect(createBoard).not.toHaveBeenCalled();
  const owner = { ...project, myRole: 'owner' } as Project;
  expect(addBoardItems(owner, t, vi.fn(), [], undefined, [board('p', 'production')]).at(-1)?.label)
    .toBe('film.views.production · board.canvasMenu.present');
});
