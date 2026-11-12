import type { Board } from '@inkadra/shared';
import { expect, it } from 'vitest';
import { childBoards } from './boards.ts';

const board = (id: string, parentBoardId: string | null, kind: Board['kind'] = 'board') =>
  ({ id, parentBoardId, kind, title: id, position: id }) as Board;

it('lists every child board, storyboards included, in their saved order', () => {
  expect(childBoards(null, 'root')).toEqual([]);
  const items = [board('root', null), board('b', 'root', 'storyboard'), board('a', 'root')];
  expect(childBoards(items, 'root').map((b) => b.id)).toEqual(['a', 'b']);
});
