import type { Board, Project } from '@inkadra/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { loadBoards } from '../board/boards.ts';
import { createCanvasBoards } from '../board/canvas-templates.ts';
import { addStoryboard, addStoryboardItem } from './add-storyboard.ts';
import { queueSeeds } from './seed-queue.tsx';

vi.mock('../board/boards.ts', async (original) => ({
  ...(await original<typeof import('../board/boards.ts')>()),
  loadBoards: vi.fn(),
}));
vi.mock('../board/canvas-templates.ts', () => ({ createCanvasBoards: vi.fn() }));
vi.mock('./seed-queue.tsx', () => ({ queueSeeds: vi.fn() }));

const project = { id: 'p1', rootBoardId: 'root' };
const t = (key: string) => key;
const board = (id: string, kind: Board['kind']) =>
  ({ id, kind, parentBoardId: 'root', title: id, position: id }) as Board;
beforeEach(() => vi.clearAllMocks());

it('makes a storyboard under the root the way the Canvas menu does, and returns its address', async () => {
  vi.mocked(loadBoards).mockResolvedValue([board('a', 'board')]);
  vi.mocked(createCanvasBoards).mockResolvedValue({
    board: board('s', 'storyboard'),
    jobs: [{ boardId: 's', userId: 'u' }],
  });
  await expect(addStoryboard(project, t, 'u')).resolves.toBe('/p/p1/b/s');
  expect(createCanvasBoards).toHaveBeenCalledWith('p1', 'root', 'storyboard', t, 'u');
  expect(queueSeeds).toHaveBeenCalledWith([{ boardId: 's', userId: 'u' }]);
});

it('opens the storyboard the project already has instead of adding a second one', async () => {
  vi.mocked(loadBoards).mockResolvedValue([board('s', 'storyboard')]);
  await expect(addStoryboard(project, t, 'u')).resolves.toBe('/p/p1/b/s');
  expect(createCanvasBoards).not.toHaveBeenCalled();
});

it('fails when the boards cannot be loaded, and is offered to editors only', async () => {
  vi.mocked(loadBoards).mockResolvedValue(null);
  await expect(addStoryboard(project, t, 'u')).rejects.toThrow();
  const menu = (myRole: Project['myRole']) =>
    addStoryboardItem({ ...project, myRole } as Project, t, 'u', vi.fn());
  expect(menu('editor')).toHaveLength(1);
  expect(menu('owner')).toHaveLength(1);
  expect(menu('viewer')).toHaveLength(0);
});
