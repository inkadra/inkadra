// SPDX-License-Identifier: AGPL-3.0-only
import type { Schedule, ShootingDay } from '@inkadra/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.ts';
import { whileVisible } from '../film/schedule.ts';

/** A shooting day the sun's date can follow: its id, its number in the shoot and its date. */
export interface SunDay {
  id: string;
  n: number;
  date: string;
}

type Day = Pick<ShootingDay, 'id' | 'date' | 'blocks'>;

/**
 * The days the sun's date can be (decision 0119): the shooting days of the board's schedule,
 * numbered as ScheduleView numbers them (by date, from 1). When `shots` (the frames of the plan's
 * scenes) is not empty, only the days that shoot one of them; all of them when it is, or when no
 * day shoots them yet.
 */
export function sunDays(days: readonly Day[], shots: ReadonlySet<string>): SunDay[] {
  const all = [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d, i) => ({ id: d.id, n: i + 1, date: d.date, blocks: d.blocks }));
  const ofScenes = all.filter((d) => d.blocks.some((b) => b.shotId && shots.has(b.shotId)));
  return (ofScenes.length ? ofScenes : all).map(({ id, n, date }) => ({ id, n, date }));
}

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
 * picker.
 */
export function useScheduleDays(boardId: string | undefined): readonly Day[] | null {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!boardId) return;
    const update = () => rerender((n) => n + 1);
    let entry = boards.get(boardId);
    if (!entry) {
      const fresh = { days: null as readonly Day[] | null, readers: new Set<() => void>(), stop: () => {} };
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
  return boardId ? (boards.get(boardId)?.days ?? null) : null;
}

/**
 * The days offered for a plan, and every day numbered (to find a linked day the plan's scenes no
 * longer shoot): derived from the days read and the plan's shots, a key that only changes when
 * the shots do, not on every edit of the board.
 */
export function useSunDays(
  days: readonly Day[] | null,
  shotKey: string,
): { offered: SunDay[]; all: SunDay[] | null } {
  return useMemo(() => {
    if (!days) return { offered: [], all: null };
    const shots = new Set(shotKey.split(' ').filter(Boolean));
    return { offered: sunDays(days, shots), all: sunDays(days, new Set()) };
  }, [days, shotKey]);
}

/** Eight ways north can point, from the top of the drawing clockwise, for "Up, 0°". */
export const NORTH_WAYS = [
  'up',
  'upRight',
  'right',
  'downRight',
  'down',
  'downLeft',
  'left',
  'upLeft',
] as const;

/** The way north points at `degrees`: the nearest of NORTH_WAYS. */
export function northWay(degrees: number): (typeof NORTH_WAYS)[number] {
  return NORTH_WAYS[
    Math.round((((degrees % 360) + 360) % 360) / 45) % 8
  ] as (typeof NORTH_WAYS)[number];
}
