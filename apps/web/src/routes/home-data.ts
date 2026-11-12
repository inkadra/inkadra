import type {
  MySchedule,
  Notification,
  PlannedShootingDay,
  Project,
  RecentBoard,
  UnsortedBoard,
  UnsortedSummary,
} from '@inkadra/shared';
import { useEffect, useState } from 'react';
import type { Page } from '../board/review-model.ts';
import { api } from '../lib/api.ts';
import { type ProjectOverview, projectOverviews } from './projects-overview.ts';

/** Loaded items, or what the section shows instead: never placeholder content. */
export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; items: T[] };

export const RECENT_BOARDS = 4;
export const ACTIVITY_ITEMS = 5;
export const HOME_PROJECTS = 5;
/** Rows of the Home's task list; See all opens the rest in the Inbox. */
export const HOME_TASKS = 6;
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

function useList<T>(path: string | null, pick: (body: unknown) => T[]): Loadable<T> {
  const [value, setValue] = useState<Loadable<T>>({ state: 'loading' });
  // biome-ignore lint/correctness/useExhaustiveDependencies: pick is a pure accessor.
  useEffect(() => {
    if (path === null) return;
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

/** Unsorted cards of every board the person can edit; nothing is requested while `enabled` is off. */
export function useUnsorted(enabled: boolean): Loadable<UnsortedBoard> {
  return useList(enabled ? '/me/unsorted' : null, (body) => (body as UnsortedSummary).items);
}

/** The phone Home's project list: pinned first, then the last changed, at most HOME_PROJECTS. */
export function homeProjects(projects: Project[] | null): Project[] | null {
  if (!projects) return null;
  return [...projects]
    .filter((p) => !p.archivedAt)
    .sort(
      (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, HOME_PROJECTS);
}

/** Board counts and last activity of `projects`; null while the project list itself loads. */
export function useProjectRows(projects: Project[] | null): Loadable<ProjectOverview> {
  const [value, setValue] = useState<Loadable<ProjectOverview>>({ state: 'loading' });
  const key = projects?.map((p) => `${p.id}:${p.updatedAt}`).join(',') ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the projects.
  useEffect(() => {
    if (key === null || !projects) {
      setValue({ state: 'loading' });
      return;
    }
    let alive = true;
    projectOverviews(projects)
      .then((items) => alive && setValue({ state: 'ready', items }))
      .catch(() => alive && setValue({ state: 'error' }));
    return () => {
      alive = false;
    };
  }, [key]);
  return value;
}
