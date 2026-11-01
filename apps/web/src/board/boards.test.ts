import type { Board } from '@inkadra/shared';
import { expect, it } from 'vitest';
import { hasListedBoards } from './boards.ts';

const board = (id: string, parentBoardId: string | null, kind: Board['kind'] = 'board') =>
  ({ id, parentBoardId, kind, title: id, position: id }) as Board;

it('lists no boards under a root that has none, or only the storyboard module', () => {
  expect(hasListedBoards(null, 'root', null)).toBe(false);
  expect(hasListedBoards([board('root', null)], 'root', null)).toBe(false);
  const items = [board('root', null), board('s', 'root', 'storyboard')];
  expect(hasListedBoards(items, 'root', 's')).toBe(false);
});

it('lists a board, or a sub-board of the storyboard that takes its place', () => {
  const items = [board('root', null), board('a', 'root')];
  expect(hasListedBoards(items, 'root', null)).toBe(true);
  const nested = [board('root', null), board('s', 'root', 'storyboard'), board('c', 's')];
  expect(hasListedBoards(nested, 'root', 's')).toBe(true);
  expect(hasListedBoards(nested, 'root', null)).toBe(true);
});
