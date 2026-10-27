import type { Board, Project } from '@inkadra/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { createBoard } from '../board/boards.ts';
import { type CreatedSetupBoard, createSetupBoards, setupBoards } from './project-setup.ts';

vi.mock('../board/boards.ts', () => ({ createBoard: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it('creates six boards including root and shares frames between storyboard and shot list', () => {
  const specs = setupBoards('production');
  expect(specs.length + 1).toBe(6);
  expect(specs.filter((s) => s.kind === 'storyboard')).toHaveLength(1);
  expect(setupBoards('shotlist')).toEqual([
    { key: 'shotlist', kind: 'storyboard', seed: 'storyboard' },
  ]);
  expect(setupBoards('blank')).toEqual([]);
});
it('retains successful board creation when a later step fails, then resumes', async () => {
  const project = { id: 'project', rootBoardId: 'root' } as Project;
  const created: CreatedSetupBoard[] = [];
  vi.mocked(createBoard)
    .mockResolvedValueOnce({ id: 'brief' } as Board)
    .mockRejectedValueOnce(new Error('offline'));
  await expect(createSetupBoards(project, 'production', created, (key) => key)).rejects.toThrow(
    'offline',
  );
  expect(created.map((c) => c.board.id)).toEqual(['brief']);
  vi.mocked(createBoard).mockImplementation(
    async (_project, _parent, title) => ({ id: title }) as Board,
  );
  await createSetupBoards(project, 'production', created, (key) => key);
  expect(created.map((c) => c.board.id)).toEqual([
    'brief',
    'locations',
    'casting',
    'moodboard',
    'storyboard',
  ]);
  expect(vi.mocked(createBoard).mock.calls.filter((call) => call[2] === 'brief')).toHaveLength(1);
});
