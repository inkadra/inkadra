// @vitest-environment happy-dom
import type { Board } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { BOARDS_STALE_MS, childBoards, useProjectBoards } from './boards.ts';

const board = (id: string, parentBoardId: string | null, kind: Board['kind'] = 'board') =>
  ({ id, parentBoardId, kind, title: id, position: id }) as Board;

it('lists every child board, storyboards included, in their saved order', () => {
  expect(childBoards(null, 'root')).toEqual([]);
  const items = [board('root', null), board('b', 'root', 'storyboard'), board('a', 'root')];
  expect(childBoards(items, 'root').map((b) => b.id)).toEqual(['a', 'b']);
});

it('reads a project’s board list again once it is a minute old (#824)', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const get = vi.spyOn(api, 'get').mockResolvedValue({ items: [] });
  function Reader() {
    useProjectBoards('p-stale');
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Reader />));
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(BOARDS_STALE_MS));
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith('/projects/p-stale/boards');
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
