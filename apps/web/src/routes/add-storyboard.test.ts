import type { Board, Project } from '@inkadra/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { createBoard, loadBoards } from '../board/boards.ts';
import { addStoryboard, addStoryboardItem } from './add-storyboard.ts';

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
  await expect(addStoryboard(project, t)).resolves.toBe('/p/p1/b/s');
  expect(createBoard).toHaveBeenCalledWith('p1', 'root', 'film.views.storyboard', 'storyboard');
});

it('opens the storyboard the project already has instead of adding a second one', async () => {
  vi.mocked(loadBoards).mockResolvedValue([board('s', 'storyboard')]);
  await expect(addStoryboard(project, t)).resolves.toBe('/p/p1/b/s');
  expect(createBoard).not.toHaveBeenCalled();
});

it('fails when the boards cannot be loaded, and is offered to editors only', async () => {
  vi.mocked(loadBoards).mockResolvedValue(null);
  await expect(addStoryboard(project, t)).rejects.toThrow();
  const menu = (myRole: Project['myRole']) =>
    addStoryboardItem({ ...project, myRole } as Project, t, vi.fn());
  expect(menu('editor')).toHaveLength(1);
  expect(menu('owner')).toHaveLength(1);
  expect(menu('viewer')).toHaveLength(0);
});
