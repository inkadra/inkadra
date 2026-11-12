// SPDX-License-Identifier: AGPL-3.0-only
import {
  daysForBoard,
  type Schedule,
  type ShootingDay,
  type SunDay,
  sunDays,
} from '@inkadra/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useBoardsWith } from '../boards.ts';
import { scheduleBoardFor } from '../film/production-days.ts';
import { whileVisible } from '../film/schedule.ts';

/** The shooting days the sun can follow and the ways north points live in @inkadra/shared (0116). */
export { NORTH_WAYS, northWay, type SunDay, sunDays } from '@inkadra/shared';

type Day = Pick<ShootingDay, 'id' | 'date' | 'blocks' | 'boardId'>;

/** The days read for each board, shared by every reader on the page, and who is reading. */
const boards = new Map<
  string,
  { days: readonly Day[] | null; readers: Set<() => void>; stop: () => void }
>();

/**
 * The board's shooting days for the sun (decision 0119): read once per board, however many parts
 * of the editor ask, from the endpoint ScheduleView reads, and again the way it refreshes them
 * (`whileVisible`: when the tab comes back and every minute while it is in view), never on an
 * edit of the board. Null until they arrive, and for a guest or offline, who keep the date
 * picker. The Production board's days when the project has one, with this board's frames and
 * scenes only (decision 0123).
 */
export function useScheduleDays(board: string | undefined): readonly Day[] | null {
  const [, rerender] = useState(0);
  const project = useBoardsWith(board);
  const boardId = board && scheduleBoardFor(board, project);
  useEffect(() => {
    if (!boardId) return;
    const update = () => rerender((n) => n + 1);
    let entry = boards.get(boardId);
    if (!entry) {
      const fresh = {
        days: null as readonly Day[] | null,
        readers: new Set<() => void>(),
        stop: () => {},
      };
      const read = () =>
        api.get<Schedule>(`/boards/${boardId}/schedule`).then(
          (r) => {
            fresh.days = r.items;
            for (const reader of fresh.readers) reader();
          },
          () => {},
        );
      void read();
      fresh.stop = whileVisible(() => void read());
      boards.set(boardId, fresh);
      entry = fresh;
    }
    entry.readers.add(update);
    const kept = entry;
    return () => {
      kept.readers.delete(update);
      if (kept.readers.size === 0) {
        kept.stop();
        boards.delete(boardId);
      }
    };
  }, [boardId]);
  const days = boardId ? (boards.get(boardId)?.days ?? null) : null;
  return useMemo(
    () => (days && board && boardId !== board ? daysForBoard(days, board) : days),
    [days, board, boardId],
  );
}

/**
 * The days offered for a plan, and every day numbered (to find a linked day the plan's scenes no
 * longer shoot): derived from the days read and the plan's shots, a key that only changes when
 * the shots do, not on every edit of the board.
 */
export function useSunDays(
  days: readonly Day[] | null,
  shotKey: string,
  sceneKey = '',
): { offered: SunDay[]; all: SunDay[] | null } {
  return useMemo(() => {
    if (!days) return { offered: [], all: null };
    const shots = new Set(shotKey.split(' ').filter(Boolean));
    const scenes = new Set(sceneKey.split(' ').filter(Boolean));
    return { offered: sunDays(days, shots, scenes), all: sunDays(days, new Set()) };
  }, [days, shotKey, sceneKey]);
}
