import { sceneDay } from '@inkadra/canvas-core';
import type { Board, ShootingDay } from '@inkadra/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api.ts';
import { loadBoards } from '../boards.ts';
import { daysPointingAt, loadBoardDays, scheduleBoardFor } from './production-days.ts';

const board = (id: string, kind: Board['kind']) => ({ id, kind }) as Board;
const day = (id: string, date: string, boardId: string, blocks: object[]) =>
  ({ id, date, boardId, blocks }) as ShootingDay;

describe("a storyboard's days (decision 0123)", () => {
  const days = [
    day('d2', '2026-03-02', 'prod', [
      { type: 'shot', shotId: 'f1', shotBoardId: 'sbB' },
      { type: 'scene', shotId: null, sceneId: 's1', sceneBoardId: 'sbA' },
    ]),
    day('d1', '2026-03-01', 'prod', [{ type: 'shot', shotId: 'f1', shotBoardId: 'sbA' }]),
    day('d3', '2026-03-03', 'prod', [{ type: 'setup', shotId: null }]),
  ];
  beforeEach(() => vi.restoreAllMocks());

  it("reads the Production board's days, with this storyboard's frames and scenes only", async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ items: days, nextCursor: null });
    const boards = [board('sbA', 'storyboard'), board('prod', 'production')];
    const read = await loadBoardDays('sbA', boards);
    expect(get).toHaveBeenCalledWith('/boards/prod/schedule');
    // Every day stays, so Day N counts the Production board's days.
    expect(read.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
    expect(read[1]?.blocks.map((b) => b.shotId)).toEqual([null, null]);
    expect(read[1]?.blocks[1]?.sceneId).toBe('s1');
    // sceneDay counts the scene block of this storyboard, not the frame f1 of the other one.
    const byId = new Map([['f1', { id: 'f1', type: 'frame', parent: 's9' }]]);
    expect(sceneDay(read, 's1', byId as never)).toBe(2);
    expect(sceneDay(read, 's9', byId as never)).toBe(1);
  });

  it('reads its own days while the project has no Production board, none out of reach', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ items: [], nextCursor: null });
    expect(scheduleBoardFor('sbA', [board('sbA', 'storyboard')])).toBe('sbA');
    await loadBoardDays('sbA', [board('sbA', 'storyboard')]);
    expect(get).toHaveBeenCalledWith('/boards/sbA/schedule');
  });

  it("reads the project's loaded boards when the caller has none (a set plan's sheet)", async () => {
    const boards = [board('root', 'board'), board('prod', 'production')];
    const get = vi.spyOn(api, 'get').mockImplementation((async (path: string) =>
      path === '/projects/p1/boards' ? { items: boards } : { items: days, nextCursor: null }) as never);
    await loadBoards('p1');
    await loadBoardDays('root', null);
    expect(get).toHaveBeenLastCalledWith('/boards/prod/schedule');
  });

  it('counts the days that plan a frame or a scene of a storyboard', () => {
    expect(daysPointingAt(days, 'sbA')).toBe(2);
    expect(daysPointingAt(days, 'sbB')).toBe(1);
    expect(daysPointingAt(days, 'sbC')).toBe(0);
  });
});
