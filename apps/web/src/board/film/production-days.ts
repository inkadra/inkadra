// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Board,
  blockTarget,
  daysForBoard,
  type Schedule,
  type ShootingDay,
} from '@inkadra/shared';
import { useEffect, useState } from 'react';
import { api, RequestError } from '../../lib/api.ts';
import { boardsWith, productionOf } from '../boards.ts';

/**
 * The board whose days a board reads (decision 0123): the Production board's, when the project
 * has one the person can see, else its own. A grant on a storyboard alone does not see it, and
 * so reads no days once they have moved there (answer 1).
 */
export function scheduleBoardFor(boardId: string, boards: readonly Board[] | null | undefined) {
  return productionOf(boards)?.id ?? boardId;
}

/**
 * The days a board reads, by date: the Production board's with only this board's frames and
 * scenes left in the blocks, or its own while the project has none. Out of reach, there are none.
 * Without `boards` (a set plan's sheet), the project's loaded boards tell.
 */
export async function loadBoardDays(
  boardId: string,
  boards: readonly Board[] | null | undefined,
): Promise<ShootingDay[]> {
  const from = scheduleBoardFor(boardId, boards ?? boardsWith(boardId));
  const items = await api.get<Schedule>(`/boards/${from}/schedule`).then(
    (r) => r.items,
    (error) => {
      if (error instanceof RequestError && [403, 404].includes(error.status)) return [];
      throw error;
    },
  );
  const days = from === boardId ? items : daysForBoard(items, boardId);
  return [...days].sort((a, b) => a.date.localeCompare(b.date));
}

/** How many days plan a frame or a scene of `boardId`. */
export function daysPointingAt(
  days: readonly Pick<ShootingDay, 'boardId' | 'blocks'>[],
  boardId: string,
): number {
  return days.filter((d) => d.blocks.some((b) => blockTarget(b, d.boardId)?.boardId === boardId))
    .length;
}

/**
 * The Production board's days that plan a frame or a scene of a storyboard, for its ⋯ menu
 * (decision 0123); null without a Production board, while loading or out of reach.
 */
export function useDaysPointingAt(boardId: string, productionId: string | undefined) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (!productionId) return;
    let live = true;
    api.get<Schedule>(`/boards/${productionId}/schedule`).then(
      (r) => live && setCount(daysPointingAt(r.items, boardId)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [boardId, productionId]);
  return count;
}
