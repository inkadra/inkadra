import type {
  MySchedule,
  Notification,
  PlannedShootingDay,
  Project,
  RecentBoard,
} from '@inkadra/shared';
import { useEffect, useState } from 'react';
import type { Page } from '../board/review-model.ts';
import { api } from '../lib/api.ts';

/** Loaded items, or what the section shows instead: never placeholder content. */
export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; items: T[] };

export const RECENT_BOARDS = 6;
export const ACTIVITY_ITEMS = 5;
const DAY_MS = 86_400_000;

/** The calendar date where the person is: shooting days have no timezone (decision 0022). */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Notifications of the last 24 hours, newest first, at most `max`. */
export function lastDay<T extends Pick<Notification, 'createdAt'>>(
  items: T[],
  now: Date,
  max = ACTIVITY_ITEMS,
): T[] {
  const since = now.getTime() - DAY_MS;
  return items
    .filter((n) => Date.parse(n.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

/** Projects where a new board can go: the root board needs editor (decision 0011). */
export function editableProjects(projects: Project[] | null): Project[] {
  return [...(projects ?? [])]
    .filter((p) => p.myRole === 'owner' || p.myRole === 'editor')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function useList<T>(path: string, pick: (body: unknown) => T[]): Loadable<T> {
  const [value, setValue] = useState<Loadable<T>>({ state: 'loading' });
  // biome-ignore lint/correctness/useExhaustiveDependencies: pick is a pure accessor.
  useEffect(() => {
    let alive = true;
    setValue({ state: 'loading' });
    api
      .get<unknown>(path)
      .then((body) => alive && setValue({ state: 'ready', items: pick(body) }))
      .catch(() => alive && setValue({ state: 'error' }));
    return () => {
      alive = false;
    };
  }, [path]);
  return value;
}

export function useRecentBoards(): Loadable<RecentBoard> {
  return useList(
    `/me/recent-boards?limit=${RECENT_BOARDS}`,
    (body) => (body as { items: RecentBoard[] }).items,
  );
}

export function useShootingDays(date: string): Loadable<PlannedShootingDay> {
  return useList(`/me/shooting-days?from=${date}&to=${date}`, (body) => (body as MySchedule).items);
}

/** The first page is newest first; 24 hours rarely need more than one. */
export function useActivity(now: Date): Loadable<Notification> {
  const list = useList('/me/notifications?limit=30', (body) => (body as Page<Notification>).items);
  return list.state === 'ready' ? { state: 'ready', items: lastDay(list.items, now) } : list;
}
